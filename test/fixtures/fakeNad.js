// -----------------------------------------------------------------------------
// A fake NAD device on 127.0.0.1 (a random port): the ASCII control protocol
// of the network port. `Key?` is answered `Key=value`, `Key=value` sets it and
// is echoed; an unknown key is not answered (as the real devices). In
// standby, only Main.Power is answered (option `answerWhenOff`).
// -----------------------------------------------------------------------------

import { createServer } from 'node:net';

export const MODEL = 'C338';

export async function startFakeNad(options = {}) {
  const state = {
    'Main.Power': 'On',
    'Main.Volume': '-30',
    'Main.Mute': 'Off',
    'Main.Source': '1',
    'Main.Model': options.model ?? MODEL,
    ...(options.names === false
      ? {}
      : { 'Source1.Name': 'CD', 'Source2.Name': 'Tuner', 'Source3.Name': 'TV' }),
    ...options.state,
  };
  const fake = {
    state,
    received: [],
    /** Bytes of the telnet replies of the client (IAC ...). */
    negotiation: [],
    sockets: new Set(),
    connections: 0,
    /** Keys never answered. */
    unanswered: new Set(options.unanswered ?? []),
    /** key -> ms before the answer. */
    delays: { ...options.delays },
    silent: Boolean(options.silent),
    /** What Main.Volume becomes on Main.Power=On (a device waking up at its old volume). */
    wakeVolume: options.wakeVolume,
    /** Keys whose `=` is not applied: the current value is answered. */
    ignoreSet: new Set(options.ignoreSet ?? []),
    commands() {
      return this.received.filter((line) => line.includes('='));
    },
    push(line) {
      for (const socket of this.sockets) {
        socket.write(`\n${line}\r`);
      }
    },
    write(data) {
      for (const socket of this.sockets) {
        socket.write(data);
      }
    },
    dropAll() {
      for (const socket of this.sockets) {
        socket.destroy();
      }
    },
  };

  const answer = (socket, key) => {
    if (fake.unanswered.has(key) || fake.silent) {
      return;
    }
    if (state['Main.Power'] === 'Off' && key !== 'Main.Power' && !options.answerWhenOff) {
      return;
    }
    const reply = () => {
      if (!socket.destroyed) {
        socket.write(`\n${key}=${state[key]}\r`);
      }
    };
    const delay = fake.delays[key];
    if (delay) {
      setTimeout(reply, delay);
    } else {
      reply();
    }
  };

  const handle = (socket, line) => {
    fake.received.push(line);
    const match = /^([A-Za-z0-9.]+)([?=])(.*)$/.exec(line);
    if (!match) {
      return;
    }
    const key = Object.keys(state).find((k) => k.toLowerCase() === match[1].toLowerCase());
    if (!key) {
      return;
    }
    if (match[2] === '=') {
      if (fake.unanswered.has(key) || fake.silent) {
        return;
      }
      if (state['Main.Power'] === 'Off' && key !== 'Main.Power' && !options.answerWhenOff) {
        return;
      }
      // `ignoreSet`: the device keeps its value and answers it (a refusal).
      if (!fake.ignoreSet.has(key)) {
        state[key] = match[3];
      }
      if (key === 'Main.Power' && match[3] === 'On' && fake.wakeVolume !== undefined) {
        state['Main.Volume'] = fake.wakeVolume;
      }
    }
    answer(socket, key);
  };

  const server = createServer((socket) => {
    fake.connections += 1;
    fake.sockets.add(socket);
    socket.on('close', () => fake.sockets.delete(socket));
    socket.on('error', () => {});
    if (options.negotiate) {
      // IAC DO ECHO, IAC WILL SUPPRESS-GO-AHEAD, twice: refused once each.
      socket.write(Buffer.from([255, 253, 1, 255, 251, 3, 255, 253, 1]));
    }
    if (options.banner) {
      socket.write(`\rMain.Model=${state['Main.Model']}\r\n`);
    }
    let text = '';
    let skip = 0;
    socket.on('data', (chunk) => {
      for (const byte of chunk) {
        if (skip > 0) {
          fake.negotiation.push(byte);
          skip -= 1;
        } else if (byte === 255) {
          fake.negotiation.push(byte);
          skip = 2;
        } else if (byte === 10 || byte === 13) {
          if (text.trim() !== '') {
            handle(socket, text.trim());
          }
          text = '';
        } else {
          text += String.fromCharCode(byte);
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.port = server.address().port;
  fake.close = () =>
    new Promise((resolve) => {
      fake.dropAll();
      server.close(() => resolve());
    });
  return fake;
}

/** A port on 127.0.0.1 where nothing listens (opened, then closed). */
export async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
