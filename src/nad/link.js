// -----------------------------------------------------------------------------
// The persistent link with the NAD device at one address: one TCP connection
// (telnet, port 23 by default; never the RS-232 serial port), the snapshot
// read on connection (`Main.Power?` must be answered, then the model, volume,
// mute, source and source names), the lines the device pushes merged into
// the state, a poll every minute, and the reconnection spaced out (10 s, then
// doubled up to 5 minutes; the count is only reset by a connection that
// stayed up a minute).
//
// One exchange at a time on the connection (a FIFO): the device answers a
// query with a line of the same key, so two queries in flight could not be
// told apart. Each exchange has a deadline counted from its request, the
// wait included: one that cannot be written in time is never written late.
//
// The link knows nothing of Gladys: it reports to the app through `onEvent`
// ('up', 'update', 'down', 'failed').
// -----------------------------------------------------------------------------

import { createConnection } from 'node:net';
import { DEFAULT_PORT, LIMITS, TIMINGS } from '../constants.js';
import {
  KEYS,
  LineSplitter,
  TelnetFilter,
  applyLine,
  confirmsSet,
  encode,
  parseLine,
  sourceNameKey,
} from './protocol.js';

export const ERROR_KINDS = Object.freeze({
  /** No connection: nothing was sent. */
  UNREACHABLE: 'unreachable',
  /** Written, no answer in time: the device may have done it. */
  TIMEOUT: 'timeout',
  /** The connection closed while the answer was awaited: the device may have done it. */
  CLOSED: 'closed',
  /** Something answers, but not as a NAD device. */
  PROTOCOL: 'protocol',
  /** No time left: nothing was sent. */
  BUDGET: 'budget',
  /** Dropped before it was written (a Standby asked after it): nothing was sent. */
  CANCELLED: 'cancelled',
});

export class DeviceError extends Error {
  constructor(kind, message, { sent = false } = {}) {
    super(message);
    this.name = 'DeviceError';
    this.kind = kind;
    this.sent = sent;
  }
}

export class NadLink {
  constructor({
    address,
    onEvent = () => {},
    logger,
    timings = TIMINGS,
    timers = globalThis,
    now = Date.now,
    connect = createConnection,
  }) {
    this.host = address.host;
    this.port = address.port ?? DEFAULT_PORT;
    this.onEvent = onEvent;
    this.logger = logger;
    this.timings = timings;
    this.timers = timers;
    this.now = now;
    this.connectSocket = connect;
    this.socket = undefined;
    this.connecting = false;
    this.stopped = false;
    this.identified = false;
    this.failures = 0;
    this.connectedAt = undefined;
    this.lastAttempt = -Infinity;
    this.retryTimer = undefined;
    this.pollTimer = undefined;
    this.polling = false;
    this.missedPolls = 0;
    this.lines = [];
    /** The last error of a connection attempt (shown by "Check"). */
    this.lastError = undefined;
    this.state = {};
    /** The exchange written, waiting for its answer: { key, resolve, reject, timer }. */
    this.current = undefined;
    /** The exchanges waiting for their turn (priority ones first). */
    this.queue = [];
  }

  get key() {
    return this.port === DEFAULT_PORT ? this.host : `${this.host}:${this.port}`;
  }

  get open() {
    return Boolean(this.socket) && !this.socket.destroyed;
  }

  /** Connected and identified as a NAD device (its snapshot read). */
  get connected() {
    return this.open && this.identified;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.identified = false;
    socket?.destroy();
    this.failCurrent();
  }

  /**
   * A reconnection asked now (configuration saved, Discovery scan): skips the
   * backoff, never the base interval since the last attempt.
   */
  retrySoon() {
    if (this.stopped || this.open || this.connecting) {
      return;
    }
    this.schedule(Math.max(0, this.lastAttempt + this.timings.reconnectBase - this.now()));
  }

  schedule(ms) {
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, ms);
  }

  backoff() {
    if (
      this.connectedAt !== undefined &&
      this.now() - this.connectedAt >= this.timings.stableAfter
    ) {
      this.failures = 0;
    }
    this.connectedAt = undefined;
    this.failures += 1;
    return Math.min(
      this.timings.reconnectMax,
      this.timings.reconnectBase * 2 ** Math.min(this.failures - 1, 16),
    );
  }

  /** Opens the TCP connection; rejects UNREACHABLE when nothing accepts it in time. */
  openSocket() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const timer = this.timers.setTimeout(() => {
        if (!settled) {
          settled = true;
          socket?.destroy();
          reject(new DeviceError(ERROR_KINDS.UNREACHABLE, 'No connection (timeout)'));
        }
      }, this.timings.connectTimeout);
      try {
        socket = this.connectSocket({ host: this.host, port: this.port });
      } catch (err) {
        this.timers.clearTimeout(timer);
        settled = true;
        reject(new DeviceError(ERROR_KINDS.UNREACHABLE, `Cannot connect: ${err.message}`));
        return;
      }
      socket.once('error', (err) => {
        if (!settled) {
          settled = true;
          this.timers.clearTimeout(timer);
          socket.destroy();
          reject(
            new DeviceError(ERROR_KINDS.UNREACHABLE, `No connection (${err.code ?? 'error'})`),
          );
        }
      });
      socket.once('connect', () => {
        if (settled) {
          socket.destroy();
          return;
        }
        settled = true;
        this.timers.clearTimeout(timer);
        resolve(socket);
      });
    });
  }

  async connect() {
    if (this.stopped || this.connecting || this.socket) {
      return;
    }
    this.connecting = true;
    this.lastAttempt = this.now();
    let socket;
    try {
      socket = await this.openSocket();
      if (this.stopped) {
        socket.destroy();
        return;
      }
      this.attach(socket);
      await this.readSnapshot();
      if (!this.open || this.socket !== socket) {
        throw new DeviceError(ERROR_KINDS.UNREACHABLE, 'Connection closed while connecting');
      }
      this.identified = true;
      this.connectedAt = this.now();
      this.lastError = undefined;
      this.missedPolls = 0;
      this.startPolling();
      this.onEvent('up', this);
    } catch (err) {
      this.lastError = err;
      if (socket && this.socket === socket) {
        // Opened, then not a usable NAD device: closed, spaced out.
        this.socket = undefined;
        this.identified = false;
        socket.destroy();
        this.failCurrent();
      }
      if (!this.stopped) {
        const delay = this.backoff();
        this.logger?.debug?.(`${this.key}: ${err.message}, next attempt in ${delay / 1000} s`);
        this.schedule(delay);
        this.onEvent('failed', this, err);
      }
    } finally {
      this.connecting = false;
    }
  }

  attach(socket) {
    this.socket = socket;
    this.identified = false;
    this.state = {};
    const filter = new TelnetFilter();
    const splitter = new LineSplitter();
    socket.setNoDelay?.(true);
    socket.setKeepAlive?.(true, 30_000);
    socket.on('data', (chunk) => {
      if (this.socket !== socket) {
        return;
      }
      const { data, replies } = filter.feed(chunk);
      for (const reply of replies) {
        socket.write(reply);
      }
      for (const line of splitter.push(data.toString('latin1'))) {
        if (this.socket !== socket || socket.destroyed) {
          return;
        }
        this.receive(line);
      }
    });
    socket.on('error', () => {
      // 'close' follows: handled there.
    });
    socket.on('close', () => this.closed(socket));
  }

  /**
   * Every line, counted before it is parsed: a device flooding the connection
   * (junk included) is closed, then asked again spaced out.
   */
  receive(text) {
    const now = this.now();
    this.lines.push(now);
    while (this.lines.length > 0 && now - this.lines[0] > this.timings.floodWindow) {
      this.lines.shift();
    }
    if (this.lines.length > this.timings.floodLines) {
      this.logger?.warn?.(`${this.key}: too many lines, connection closed`);
      this.lines = [];
      this.socket?.destroy();
      return;
    }
    const line = parseLine(text);
    if (!line) {
      return;
    }
    // A line always carries the state of the device when it wrote it: the
    // late answer of a query that timed out is a fresh state, never dropped.
    // It answers a query (?) of its key; a command (=) only when it carries
    // the value asked: any other line of the key (a late answer, a refusal)
    // is a state, and the command ends at its deadline, "sent, without
    // confirmation".
    const before = this.state;
    this.state = applyLine(this.state, line);
    const current = this.current;
    if (current && current.key === line.key && (!current.confirm || current.confirm(line.value))) {
      this.current = undefined;
      this.timers.clearTimeout(current.timer);
      current.resolve(line.value);
      this.pump();
    }
    if (this.identified && this.state !== before) {
      this.onEvent('update', this, line.key);
    }
  }

  /** The connection is gone: the exchange written may have acted, the waiting ones did not. */
  failCurrent() {
    const current = this.current;
    this.current = undefined;
    if (current) {
      this.timers.clearTimeout(current.timer);
      current.reject(
        new DeviceError(ERROR_KINDS.CLOSED, 'Connection closed before the answer', { sent: true }),
      );
    }
    const waiting = this.queue;
    this.queue = [];
    for (const item of waiting) {
      item.reject(new DeviceError(ERROR_KINDS.UNREACHABLE, 'Not connected: nothing sent'));
    }
  }

  closed(socket) {
    if (socket !== this.socket) {
      return;
    }
    const wasIdentified = this.identified;
    this.socket = undefined;
    this.identified = false;
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.failCurrent();
    if (this.stopped || !wasIdentified) {
      // Closed while connecting: connect() fails and spaces the next attempt.
      return;
    }
    const delay = this.backoff();
    this.schedule(delay);
    this.logger?.info?.(`${this.key}: connection lost, next attempt in ${delay / 1000} s`);
    this.onEvent('down', this);
  }

  /**
   * One exchange: writes `key<operator>[value]` and resolves with the value
   * of the first line of the same key (for `=`, the first one carrying the
   * value asked). `timeoutMs` counts from now, the wait for the turn
   * included. `shouldSend` is asked again right before the write: false drops
   * the exchange (CANCELLED, nothing sent). `onSent` is called right before
   * the bytes leave.
   * Before that, every failure is "nothing sent" (UNREACHABLE, BUDGET);
   * after, TIMEOUT and CLOSED (`sent: true`).
   */
  exchange(key, operator, value, timeoutMs, { onSent, shouldSend, priority = false } = {}) {
    if (!this.open) {
      return Promise.reject(
        new DeviceError(ERROR_KINDS.UNREACHABLE, 'Not connected: nothing sent'),
      );
    }
    if (this.queue.length >= LIMITS.pending) {
      return Promise.reject(
        new DeviceError(ERROR_KINDS.BUDGET, 'Too many commands waiting: nothing sent'),
      );
    }
    if (!(timeoutMs > 0)) {
      return Promise.reject(new DeviceError(ERROR_KINDS.BUDGET, 'No time left: nothing sent'));
    }
    let bytes;
    try {
      bytes = encode(key, operator, value);
    } catch (err) {
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      const item = {
        key: key.toLowerCase(),
        bytes,
        socket: this.socket,
        deadline: this.now() + timeoutMs,
        onSent,
        shouldSend,
        confirm: operator === '=' ? (answered) => confirmsSet(key, value, answered) : undefined,
        priority,
        resolve,
        reject,
      };
      if (priority) {
        // Before the exchanges waiting (after the other priority ones), never
        // before the one already written.
        const index = this.queue.findIndex((q) => !q.priority);
        this.queue.splice(index === -1 ? this.queue.length : index, 0, item);
      } else {
        this.queue.push(item);
      }
      this.pump();
    });
  }

  /** Writes the next exchange when none waits for its answer. */
  pump() {
    while (!this.current && this.queue.length > 0) {
      const item = this.queue.shift();
      const remaining = item.deadline - this.now();
      if (remaining <= 0) {
        item.reject(new DeviceError(ERROR_KINDS.BUDGET, 'No time left: nothing sent'));
        continue;
      }
      if (!this.open || this.socket !== item.socket) {
        item.reject(new DeviceError(ERROR_KINDS.UNREACHABLE, 'Not connected: nothing sent'));
        continue;
      }
      if (item.shouldSend && !item.shouldSend()) {
        item.reject(new DeviceError(ERROR_KINDS.CANCELLED, 'Cancelled by Standby, nothing sent'));
        continue;
      }
      const entry = {
        key: item.key,
        confirm: item.confirm,
        resolve: item.resolve,
        reject: item.reject,
        timer: undefined,
      };
      entry.timer = this.timers.setTimeout(() => {
        if (this.current !== entry) {
          return;
        }
        this.current = undefined;
        entry.reject(
          new DeviceError(ERROR_KINDS.TIMEOUT, 'Sent, without answer from the device', {
            sent: true,
          }),
        );
        this.pump();
      }, remaining);
      this.current = entry;
      try {
        item.onSent?.();
        item.socket.write(item.bytes);
      } catch (err) {
        this.current = undefined;
        this.timers.clearTimeout(entry.timer);
        item.reject(new DeviceError(ERROR_KINDS.UNREACHABLE, `Not sent: ${err.message}`));
      }
    }
  }

  /** A query; resolves with the raw value. */
  query(key, timeoutMs = this.timings.requestTimeout) {
    return this.exchange(key, '?', undefined, timeoutMs);
  }

  async readSnapshot() {
    try {
      await this.query(KEYS.POWER);
    } catch (err) {
      throw new DeviceError(
        ERROR_KINDS.PROTOCOL,
        `Not a NAD device (no answer to Main.Power?: ${err.message})`,
      );
    }
    for (const key of [KEYS.MODEL, KEYS.VOLUME, KEYS.MUTE, KEYS.SOURCE]) {
      // A key a model does not know (or in standby): its state stays unknown.
      await this.query(key).catch(() => undefined);
    }
    // Source names, on the models that have them: stopped at the first miss.
    for (let slot = 1; slot <= LIMITS.sourceSlots; slot += 1) {
      const name = await this.query(sourceNameKey(slot), this.timings.nameTimeout).catch(
        () => undefined,
      );
      if (name === undefined) {
        break;
      }
    }
  }

  startPolling() {
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = this.timers.setInterval(() => this.poll(), this.timings.pollInterval);
  }

  /**
   * The states read again (the device pushes its changes, this catches what
   * was missed). `deadPolls` polls in a row without an answer to
   * `Main.Power?` close the connection, then reconnect spaced out.
   */
  async poll() {
    if (!this.connected || this.polling) {
      return;
    }
    this.polling = true;
    try {
      const power = await this.query(KEYS.POWER).then(
        () => true,
        () => false,
      );
      if (!power) {
        this.missedPolls += 1;
        if (this.missedPolls >= this.timings.deadPolls) {
          this.logger?.info?.(`${this.key}: no answer to the poll, connection closed`);
          this.missedPolls = 0;
          this.socket?.destroy();
        }
        return;
      }
      this.missedPolls = 0;
      for (const key of [KEYS.VOLUME, KEYS.MUTE, KEYS.SOURCE]) {
        await this.query(key).catch(() => undefined);
      }
    } finally {
      this.polling = false;
    }
  }
}
