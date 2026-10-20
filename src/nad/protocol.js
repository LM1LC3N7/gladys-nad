// -----------------------------------------------------------------------------
// The NAD ASCII control protocol, as nad_receiver (MIT, see
// THIRD_PARTY_NOTICES.md) speaks it over telnet: a command is a line
// `<Domain>.<Function><operator>[value]` written as `\n<command>\r`; `?` asks
// a value, `=` sets it; the device answers `<Domain>.<Function>=<value>` and
// also writes such a line by itself on every change (knob, remote, app).
//
// Everything here is pure and bounded: the telnet negotiation is refused
// (as Python's telnetlib does), lines are cut at LIMITS.line, every line is
// matched once by an anchored expression, values are parsed strictly.
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';

export const KEYS = Object.freeze({
  POWER: 'Main.Power',
  VOLUME: 'Main.Volume',
  MUTE: 'Main.Mute',
  SOURCE: 'Main.Source',
  MODEL: 'Main.Model',
});

/** `Source<n>.Name`: the name of an input, on the models that know it. */
export const sourceNameKey = (slot) => `Source${slot}.Name`;
const SOURCE_NAME = /^source(\d{1,2})\.name$/;

/** A value that may be written into a command: never a line break nor a space. */
const SAFE_VALUE = /^[A-Za-z0-9+-][A-Za-z0-9._+-]{0,31}$/;
export const isSafeValue = (value) => typeof value === 'string' && SAFE_VALUE.test(value);

/** The bytes of one command: `\n<key>?` or `\n<key>=<value>`, then `\r`. */
export function encode(key, operator, value) {
  if (!Object.values(KEYS).includes(key) && !SOURCE_NAME.test(key.toLowerCase())) {
    throw new Error(`Unknown NAD key "${String(key).slice(0, 32)}"`);
  }
  if (operator === '?') {
    return Buffer.from(`\n${key}?\r`, 'latin1');
  }
  if (operator === '=' && isSafeValue(value)) {
    return Buffer.from(`\n${key}=${value}\r`, 'latin1');
  }
  throw new Error(`Invalid NAD command for ${key}`);
}

// Control characters are refused in a value, on purpose.
// eslint-disable-next-line no-control-regex
const LINE = /^([A-Za-z][A-Za-z0-9]{0,15}(?:\.[A-Za-z0-9]{1,24}){1,3})=([^\x00-\x1f\x7f]{0,128})$/;

/** One line of the device -> `{ key, value }` (key lowercased for matching), or undefined. */
export function parseLine(text) {
  const match = LINE.exec(String(text).trim());
  if (!match) {
    return undefined;
  }
  return { key: match[1].toLowerCase(), value: match[2].trim() };
}

export function parseOnOff(value) {
  if (/^on$/i.test(value)) {
    return true;
  }
  if (/^off$/i.test(value)) {
    return false;
  }
  return undefined;
}

/**
 * A volume in dB. Some models append "dB" or other text: only the leading
 * number counts (as nad_receiver). Out of -120..+30: unknown.
 */
export function parseDb(value) {
  const match = /^([+-]?\d{1,3}(?:\.\d{1,2})?)(?:\s*[A-Za-z]{0,4})$/.exec(String(value).trim());
  if (!match) {
    return undefined;
  }
  const db = Number(match[1]);
  return Number.isFinite(db) && db >= -120 && db <= 30 ? db : undefined;
}

/**
 * Whether a line of `key` answering a `key=sent` command confirms it: the
 * value asked (On/Off, dB within 0.5, a source without case). Any other
 * value (a late answer, a refusal, a pushed change) is a state, not a
 * confirmation.
 */
export function confirmsSet(key, sent, answered) {
  switch (key.toLowerCase()) {
    case 'main.power':
    case 'main.mute': {
      const asked = parseOnOff(sent);
      return asked !== undefined && parseOnOff(answered) === asked;
    }
    case 'main.volume': {
      const asked = parseDb(sent);
      const got = parseDb(answered);
      return asked !== undefined && got !== undefined && Math.abs(got - asked) <= 0.5;
    }
    default:
      return String(answered).toLowerCase() === String(sent).toLowerCase();
  }
}

/** A source value (a number on most models, a name on some): kept only when safe to send back. */
export function parseSource(value) {
  return isSafeValue(value) ? value : undefined;
}

// Control characters (C0, DEL, C1) and bidirectional overrides.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** A display text from the device: cleaned, trimmed, cut; undefined when empty. */
export function cleanText(value, max = LIMITS.name) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.replace(UNSAFE, '').trim().slice(0, max).trim();
  return text === '' ? undefined : text;
}

/**
 * Applies one parsed line to a state object (a copy is returned when
 * something changed, the same object otherwise). Only the known keys are
 * read; `sourceNames` has no prototype.
 */
export function applyLine(state, { key, value }) {
  const next = { ...state };
  switch (key) {
    case 'main.power':
      next.power = parseOnOff(value);
      break;
    case 'main.mute':
      next.mute = parseOnOff(value);
      break;
    case 'main.volume':
      next.volume = parseDb(value);
      break;
    case 'main.source':
      next.source = parseSource(value);
      break;
    case 'main.model':
      next.model = cleanText(value) ?? state.model;
      break;
    default: {
      const slot = SOURCE_NAME.exec(key);
      const n = slot ? Number(slot[1]) : 0;
      if (n < 1 || n > LIMITS.sourceSlots) {
        return state;
      }
      const name = cleanText(value);
      const names = Object.assign(Object.create(null), state.sourceNames);
      if (name === undefined) {
        delete names[n];
      } else {
        names[n] = name;
      }
      next.sourceNames = names;
    }
  }
  const changed = Object.keys(next).some((k) =>
    k === 'sourceNames'
      ? JSON.stringify(next[k]) !== JSON.stringify(state[k])
      : next[k] !== state[k],
  );
  return changed ? next : state;
}

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

/**
 * Removes the telnet commands from the bytes of the device and refuses every
 * option (DO -> WONT, WILL -> DONT), once per option: a device repeating its
 * negotiation never makes this side loop. Sub-negotiations are skipped.
 */
export class TelnetFilter {
  constructor() {
    this.state = 'data';
    this.verb = 0;
    this.answered = new Set();
  }

  /** @returns {{ data: Buffer, replies: Buffer[] }} */
  feed(chunk) {
    const out = Buffer.allocUnsafe(chunk.length);
    let length = 0;
    const replies = [];
    for (const byte of chunk) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) {
            this.state = 'iac';
          } else {
            out[length] = byte;
            length += 1;
          }
          break;
        case 'iac':
          if (byte >= WILL && byte <= DONT) {
            this.verb = byte;
            this.state = 'option';
          } else if (byte === SB) {
            this.state = 'sb';
          } else {
            // IAC IAC (a literal 255, not ASCII) and the other commands: dropped.
            this.state = 'data';
          }
          break;
        case 'option': {
          const id = this.verb * 256 + byte;
          // Never an LF, CR or 255 byte written back (outside the `\n<command>\r`
          // framing): those options are left unanswered.
          const writable = byte !== 10 && byte !== 13 && byte !== IAC;
          if ((this.verb === DO || this.verb === WILL) && writable && !this.answered.has(id)) {
            if (this.answered.size < 64) {
              this.answered.add(id);
              replies.push(Buffer.from([IAC, this.verb === DO ? WONT : DONT, byte]));
            }
          }
          this.state = 'data';
          break;
        }
        case 'sb':
          if (byte === IAC) {
            this.state = 'sb-iac';
          }
          break;
        case 'sb-iac':
          this.state = byte === SE ? 'data' : 'sb';
          break;
        default:
          this.state = 'data';
      }
    }
    return { data: out.subarray(0, length), replies };
  }
}

/**
 * Splits the text of the device into lines (`\r` or `\n`). A line longer than
 * `max` is dropped whole, up to its end, never kept growing.
 */
export class LineSplitter {
  constructor(max = LIMITS.line) {
    this.max = max;
    this.buffer = '';
    this.overflow = false;
  }

  /** @returns {string[]} the complete, non-empty lines */
  push(text) {
    const lines = [];
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (c === 10 || c === 13) {
        this.add(text.slice(start, i));
        if (!this.overflow && this.buffer.trim() !== '') {
          lines.push(this.buffer);
        }
        this.buffer = '';
        this.overflow = false;
        start = i + 1;
      }
    }
    this.add(text.slice(start));
    return lines;
  }

  add(part) {
    if (this.overflow) {
      return;
    }
    if (this.buffer.length + part.length > this.max) {
      this.overflow = true;
      this.buffer = '';
      return;
    }
    this.buffer += part;
  }
}
