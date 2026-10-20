// -----------------------------------------------------------------------------
// NadApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), a memory store and the fake NAD device on the loopback
// interface. The background round and the poll never fire by themselves: the
// tests drive them.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { NadApp, parseVolumeCommand } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { MemoryStore } from '../src/store.js';
import { closedPort, startFakeNad } from './fixtures/fakeNad.js';

const SELECTOR = 'nad';

/** No background round, no poll; real (short) timeouts. */
const timers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

const FAST = {
  ...TIMINGS,
  connectTimeout: 500,
  requestTimeout: 300,
  nameTimeout: 200,
  reconnectBase: 40,
  reconnectMax: 200,
  stableAfter: 10_000,
  publishDelay: 5,
  persistDelay: 5,
  wakeCheckDelay: 30,
};

async function waitFor(predicate, what, timeout = 3_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(t, { deviceOptions, config, devices, store, timings = {} } = {}) {
  const fake = await startFakeNad(deviceOptions);
  t.after(() => fake.close());
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: config ? config(fake) : { addresses: `127.0.0.1:${fake.port}` },
    devices: devices ? devices(fake) : [],
  });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const app = new NadApp({
    gladys,
    logger,
    store: store ?? new MemoryStore(),
    timers,
    timings: { ...FAST, ...timings },
  });
  registerHandlers(gladys, app, logger);
  t.after(() => app.stop());
  await gladys.connect();
  const id = (key) => `ext:${SELECTOR}:nad:127.0.0.1_${fake.port}${key ? `:${key}` : ''}`;
  return { fake, gladys, app, logs, id };
}

async function discovered({ gladys, id }) {
  await waitFor(
    () => gladys.fake.discoveredDevices.some((d) => d.external_id === id()),
    'the device in the Discovery tab',
  );
  return gladys.fake.discoveredDevices.find((d) => d.external_id === id());
}

async function createDevice(ctx) {
  const device = await discovered(ctx);
  await ctx.gladys.fake.deviceCreated(device);
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('power')) !== undefined, 'the power state');
  return device;
}

const set = ({ gladys, id }, device, key, value = 1) =>
  gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === id(key)),
    value,
  );

test('a typed address becomes a Gladys device; its states once created', async (t) => {
  const ctx = await setup(t);
  const device = await discovered(ctx);
  assert.equal(device.name, 'NAD C338');
  assert.deepEqual(device.params, [{ name: 'IP_ADDRESS', value: '127.0.0.1' }]);
  const keys = device.features.map((f) => f.external_id.slice(ctx.id().length + 1));
  assert.deepEqual(keys, ['power', 'power_on', 'standby', 'volume', 'mute', 'source']);
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  // No switch, nothing an "everything on / off" could command; the power is read only.
  assert.ok(device.features.every((f) => f.category !== 'switch'));
  assert.ok(device.features.filter((f) => f.type === 'binary').every((f) => f.read_only));
  assert.deepEqual([byKey.power.category, byKey.power.read_only], ['unknown', true]);
  assert.deepEqual([byKey.power_on.category, byKey.power_on.type], ['button', 'push']);
  assert.deepEqual([byKey.standby.category, byKey.standby.type], ['button', 'push']);
  assert.deepEqual(
    [byKey.volume.category, byKey.volume.type, byKey.volume.min, byKey.volume.max],
    ['music', 'volume', 0, 100],
  );
  assert.deepEqual([byKey.mute.category, byKey.mute.type], ['television', 'volume-mute']);
  assert.equal(byKey.volume.unit, undefined, 'no unit for the music category');
  assert.deepEqual(byKey.source.supported_options, [
    { value: '1', label: 'CD' },
    { value: '2', label: 'Tuner' },
    { value: '3', label: 'TV' },
  ]);
  assert.equal(ctx.gladys.fake.states.length, 0, 'no state before the device is created');

  await createDevice(ctx);
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('source')) === '1', 'the source');
  const last = (key) => ctx.gladys.fake.lastState(ctx.id(key));
  assert.equal(last('power'), 1);
  // -30 dB in -80..-20 dB: 83 %.
  assert.equal(last('volume'), 83);
  assert.equal(last('mute'), 0);
  // Only queries and nothing set by the connection itself.
  assert.deepEqual(ctx.fake.commands(), []);
  assert.deepEqual(ctx.gladys.fake.connectionStatus, { connected: true });
});

test('pushed lines are published, grouped', async (t) => {
  const ctx = await setup(t);
  await createDevice(ctx);
  ctx.fake.push('Main.Volume=-50');
  ctx.fake.push('Main.Mute=On');
  ctx.fake.push('Main.Power=Off');
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('power')) === 0, 'power 0');
  assert.equal(ctx.gladys.fake.lastState(ctx.id('volume')), 50);
  assert.equal(ctx.gladys.fake.lastState(ctx.id('mute')), 1);
  // A volume above the cap shows 100 %, never more.
  ctx.fake.push('Main.Volume=-5dB');
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('volume')) === 100, 'volume 100');
});

test('volume: 100 % is the cap, read just before sending; strict validation', async (t) => {
  const ctx = await setup(t);
  const device = await createDevice(ctx);
  assert.equal((await set(ctx, device, 'volume', 100)).success, true);
  assert.equal(ctx.fake.state['Main.Volume'], '-20');
  assert.equal((await set(ctx, device, 'volume', 50)).success, true);
  assert.equal(ctx.fake.state['Main.Volume'], '-50');
  assert.equal((await set(ctx, device, 'volume', '0')).success, true);
  assert.equal(ctx.fake.state['Main.Volume'], '-80');
  await ctx.gladys.fake.configUpdated({
    addresses: `127.0.0.1:${ctx.fake.port}`,
    max_volume_db: -40,
    min_volume_db: -60,
  });
  assert.equal((await set(ctx, device, 'volume', 100)).success, true);
  assert.equal(ctx.fake.state['Main.Volume'], '-40');
  // A cap typed above the allowed range is brought back to 0 dB.
  await ctx.gladys.fake.configUpdated({
    addresses: `127.0.0.1:${ctx.fake.port}`,
    max_volume_db: 12,
  });
  assert.equal((await set(ctx, device, 'volume', 100)).success, true);
  assert.equal(ctx.fake.state['Main.Volume'], '0');
  const before = ctx.fake.commands().length;
  for (const bad of [null, '', true, 12.5, '12abc', -1, 101, NaN, '1e2']) {
    assert.equal((await set(ctx, device, 'volume', bad)).success, false, String(bad));
  }
  assert.equal(ctx.fake.commands().length, before, 'nothing sent for an invalid volume');
});

test('mute: the state read again decides; unmuting lowers a volume above the cap first', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: { state: { 'Main.Mute': 'On', 'Main.Volume': '-5' } },
  });
  const device = await createDevice(ctx);
  assert.equal((await set(ctx, device, 'mute')).success, true);
  assert.deepEqual(ctx.fake.commands(), ['Main.Volume=-20', 'Main.Mute=Off']);
  assert.equal((await set(ctx, device, 'mute')).success, true);
  assert.deepEqual(ctx.fake.commands().slice(2), ['Main.Mute=On']);
  // The device does not answer the mute query: nothing sent.
  ctx.fake.unanswered.add('Main.Mute');
  const ack = await set(ctx, device, 'mute');
  assert.equal(ack.success, false);
  assert.match(ack.error, /nothing sent/);
  assert.equal(ctx.fake.commands().length, 3);
});

test('power on brings a device waking up loud back to the cap', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: { state: { 'Main.Power': 'Off' }, wakeVolume: '-3' },
  });
  const device = await createDevice(ctx);
  assert.equal(ctx.gladys.fake.lastState(ctx.id('power')), 0);
  const ack = await set(ctx, device, 'power_on');
  assert.equal(ack.success, true, ack.error);
  await waitFor(
    () => ctx.fake.commands().includes('Main.Volume=-20'),
    `the volume capped (${ctx.fake.received.join(' ')})`,
  );
  assert.deepEqual(ctx.fake.commands(), ['Main.Power=On', 'Main.Volume=-20']);
});

test('standby goes first, and cancels a power on still waiting', async (t) => {
  const ctx = await setup(t, { deviceOptions: { state: { 'Main.Power': 'Off' } } });
  const device = await createDevice(ctx);
  ctx.fake.delays['Main.Power'] = 250;
  const first = set(ctx, device, 'power_on');
  await settle(20);
  const second = set(ctx, device, 'power_on');
  await settle(20);
  const standby = set(ctx, device, 'standby');
  const [a, b, c] = await Promise.all([first, second, standby]);
  assert.equal(c.success, true);
  assert.equal(b.success, false);
  assert.match(b.error, /Cancelled by Standby, nothing sent/);
  assert.equal(a.success, true);
  const powers = ctx.fake.commands().filter((l) => l.startsWith('Main.Power='));
  assert.deepEqual(powers, ['Main.Power=On', 'Main.Power=Off']);
});

test('source: only the options, sent as the device value', async (t) => {
  const ctx = await setup(t);
  const device = await createDevice(ctx);
  assert.equal((await set(ctx, device, 'source', '2')).success, true);
  assert.deepEqual(ctx.fake.commands(), ['Main.Source=2']);
  for (const bad of ['9', '1\rMain.Power=Off', 2, '']) {
    assert.equal((await set(ctx, device, 'source', bad)).success, false, JSON.stringify(bad));
  }
  assert.equal(ctx.fake.commands().length, 1);
  assert.equal((await set(ctx, device, 'power', 1)).success, false, 'the power is read only');
});

test('a command without answer is "sent, without confirmation", within the budget', async (t) => {
  const ctx = await setup(t, { timings: { commandBudget: 400 } });
  const device = await createDevice(ctx);
  ctx.fake.unanswered.add('Main.Source');
  const started = Date.now();
  const ack = await set(ctx, device, 'source', '3');
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, without confirmation/);
  assert.ok(Date.now() - started < 1_000);
  assert.deepEqual(ctx.fake.commands(), ['Main.Source=3']);
});

test('names typed in the configuration label the sources of a model that tells none', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: { names: false, state: { 'Main.Source': '4' } },
    config: (fake) => ({ addresses: `127.0.0.1:${fake.port}`, source_names: '1=CD, 2=Phono' }),
  });
  const device = await discovered(ctx);
  const source = device.features.find((f) => f.external_id === ctx.id('source'));
  assert.deepEqual(source.supported_options, [
    { value: '1', label: 'CD' },
    { value: '2', label: 'Phono' },
    { value: '4', label: 'Source 4' },
  ]);
});

test('a device that is not connected: nothing sent, standby included; power 0 and named', async (t) => {
  const ctx = await setup(t);
  const device = await createDevice(ctx);
  await ctx.fake.close();
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('power')) === 0, 'power 0');
  const ack = await set(ctx, device, 'standby');
  assert.equal(ack.success, false);
  assert.match(ack.error, /not connected .*nothing sent/);
  await waitFor(
    () => /Not connected/.test(ctx.gladys.fake.connectionStatus?.message?.en ?? ''),
    'the status message',
  );
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});

test('an address where nothing answers, or not a NAD device, is named in the status', async (t) => {
  const port = await closedPort();
  const ctx = await setup(t, {
    deviceOptions: { silent: true },
    config: (fake) => ({ addresses: `127.0.0.1:${port}, 127.0.0.1:${fake.port}, COM3` }),
  });
  await waitFor(
    () =>
      new RegExp(`answers yet at: .*127\\.0\\.0\\.1:${ctx.fake.port}`).test(
        ctx.gladys.fake.connectionStatus?.message?.en ?? '',
      ) && ctx.gladys.fake.connectionStatus.message.en.includes(`127.0.0.1:${port}`),
    'the status',
  );
  const { en, fr } = ctx.gladys.fake.connectionStatus.message;
  assert.match(en, new RegExp(`127\\.0\\.0\\.1:${port}`));
  assert.match(en, new RegExp(`127\\.0\\.0\\.1:${ctx.fake.port}`));
  assert.match(en, /Ignored in the configuration \(invalid\): COM3/);
  assert.match(fr, /Aucun appareil NAD ne répond/);
  assert.deepEqual(ctx.gladys.fake.discoveredDevices, []);
});

test('the telnet negotiation is refused once per option; a banner is read', async (t) => {
  const ctx = await setup(t, { deviceOptions: { negotiate: true, banner: true } });
  await discovered(ctx);
  // IAC WONT ECHO, IAC DONT SUPPRESS-GO-AHEAD; the repeated DO ECHO not answered again.
  assert.deepEqual(ctx.fake.negotiation, [255, 252, 1, 255, 254, 3]);
});

test('a flood or an endless line closes the connection, reconnected spaced out', async (t) => {
  const ctx = await setup(t);
  await createDevice(ctx);
  ctx.fake.write('x'.repeat(10_000));
  ctx.fake.write('\nMain.Volume=-40\r');
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('volume')) === 67, 'the next line read');
  const connections = ctx.fake.connections;
  ctx.fake.write('\nMain.Power=On\r'.repeat(400));
  await waitFor(() => ctx.fake.connections > connections, 'a new connection');
  assert.ok(ctx.logs.some((l) => /too many lines/.test(l)));
});

test('a created device unknown to /data is found again from its external id', async (t) => {
  let fakePort;
  const ctx = await setup(t, {
    deviceOptions: { names: false, state: { 'Main.Source': '1' } },
    config: () => ({ addresses: '' }),
    devices: (fake) => {
      fakePort = fake.port;
      const ext = `ext:${SELECTOR}:nad:127.0.0.1_${fake.port}`;
      return [
        {
          name: 'NAD C338',
          external_id: ext,
          features: [
            {
              external_id: `${ext}:source`,
              supported_options: [
                { value: '1', label: 'CD' },
                { value: '7', label: 'Turntable' },
              ],
            },
          ],
        },
      ];
    },
  });
  assert.ok(fakePort);
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('power')) === 1, 'the power state');
  const device = await discovered(ctx);
  const source = device.features.find((f) => f.external_id === ctx.id('source'));
  assert.deepEqual(source.supported_options, [
    { value: '1', label: 'CD' },
    { value: '7', label: 'Turntable' },
  ]);
});

test('a reconnection to Gladys republishes the status and the devices, never asks faster', async (t) => {
  const ctx = await setup(t);
  await createDevice(ctx);
  const statuses = ctx.gladys.fake.connectionStatuses.length;
  const discoveries = ctx.gladys.fake.bodies('POST', '/discovered_device').length;
  const connections = ctx.fake.connections;
  await ctx.app.start({ addresses: `127.0.0.1:${ctx.fake.port}` }, { connected: true });
  assert.equal(ctx.gladys.fake.connectionStatuses.length, statuses + 1);
  assert.ok(ctx.gladys.fake.bodies('POST', '/discovered_device').length > discoveries);
  await settle(60);
  assert.equal(ctx.fake.connections, connections, 'the link is kept');
});

test('the poll reads the states again; two silent polls close the connection', async (t) => {
  const ctx = await setup(t);
  await createDevice(ctx);
  const link = [...ctx.app.links.values()][0];
  ctx.fake.state['Main.Volume'] = '-80';
  await link.poll();
  await waitFor(() => ctx.gladys.fake.lastState(ctx.id('volume')) === 0, 'the polled volume');
  const connections = ctx.fake.connections;
  ctx.fake.silent = true;
  await link.poll();
  assert.equal(link.open, true);
  await link.poll();
  ctx.fake.silent = false;
  await waitFor(() => ctx.fake.connections > connections, 'a new connection');
});

test('check the devices', async (t) => {
  const ctx = await setup(t);
  await createDevice(ctx);
  const ack = await ctx.gladys.fake.action('check_devices');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /NAD C338 \(127\.0\.0\.1:\d+\): connected, on, volume -30 dB/);
  assert.match(ack.data.message.en, /-80 dB \(0 %\) to -20 dB \(100 %, the cap\)/);
  assert.match(ack.data.message.fr, /le plafond/);
});

// --- Review 1 (S1 to S5 of the hostile scenarios) ---------------------------------

test('S1: a Standby pressed after a Power on waiting behind a poll query wins', async (t) => {
  const ctx = await setup(t, { deviceOptions: { names: false, state: { 'Main.Power': 'Off' } } });
  const device = await createDevice(ctx);
  const link = [...ctx.app.links.values()][0];
  // In standby only Main.Power is answered: the poll's Main.Volume? stays in flight.
  const poll = link.poll();
  await waitFor(() => ctx.fake.received.at(-1) === 'Main.Volume?', 'the poll volume query');
  const on = set(ctx, device, 'power_on');
  await settle(20);
  const off = set(ctx, device, 'standby');
  const [a, b] = await Promise.all([on, off]);
  await poll;
  await settle(100);
  assert.equal(b.success, true);
  assert.equal(a.success, false);
  assert.match(a.error, /Cancelled by Standby, nothing sent/);
  assert.deepEqual(ctx.fake.commands(), ['Main.Power=Off']);
  assert.equal(ctx.fake.state['Main.Power'], 'Off');
});

test('S2: a late answer of another value never confirms a volume command', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: { names: false, delays: { 'Main.Volume': 400 } },
    timings: { commandBudget: 700 },
  });
  const device = await createDevice(ctx);
  const link = [...ctx.app.links.values()][0];
  const poll = link.poll();
  await waitFor(() => ctx.fake.received.at(-1) === 'Main.Volume?', 'the poll volume query');
  await settle(320);
  // The device now ignores the command; the late "Main.Volume=-30" is still on its way.
  ctx.fake.unanswered.add('Main.Volume');
  const ack = await set(ctx, device, 'volume', 50);
  await poll;
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, without confirmation/);
  assert.equal(ctx.fake.state['Main.Volume'], '-30');
});

test('S3: a contradicting answer (Main.Power=On) never confirms Standby', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: { names: false, ignoreSet: ['Main.Power'] },
    timings: { commandBudget: 600 },
  });
  const device = await createDevice(ctx);
  const ack = await set(ctx, device, 'standby');
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, without confirmation/);
  // The answer is still a state: power 1 kept.
  assert.equal(ctx.gladys.fake.lastState(ctx.id('power')), 1);
});

test('S4: unmute is refused when the device does not lower its volume to the cap', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: {
      names: false,
      state: { 'Main.Mute': 'On', 'Main.Volume': '-5' },
      ignoreSet: ['Main.Volume'],
    },
    timings: { commandBudget: 800 },
  });
  const device = await createDevice(ctx);
  const ack = await set(ctx, device, 'mute');
  assert.equal(ack.success, false);
  assert.match(ack.error, /volume not lowered to the cap .*mute kept/);
  assert.deepEqual(ctx.fake.commands(), ['Main.Volume=-20']);
  assert.equal(ctx.fake.state['Main.Mute'], 'On');
});

test('S5: after a wake-up, an unconfirmed lowering keeps the checks going', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: {
      names: false,
      state: { 'Main.Power': 'Off' },
      wakeVolume: '-3',
      ignoreSet: ['Main.Volume'],
    },
    timings: { preRead: 150, requestTimeout: 150 },
  });
  const device = await createDevice(ctx);
  assert.equal((await set(ctx, device, 'power_on')).success, true);
  await waitFor(
    () => ctx.logs.some((l) => /volume not confirmed after waking up/.test(l)),
    'the end of the checks',
    6_000,
  );
  const lowerings = ctx.fake.commands().filter((l) => l === 'Main.Volume=-20').length;
  assert.ok(lowerings >= 3, `${lowerings} lowerings`);
  assert.equal(ctx.app.wakeChecks.size, 0);
});

test('a volume pushed above the cap just after a wake-up is lowered', async (t) => {
  const ctx = await setup(t, {
    deviceOptions: { names: false, state: { 'Main.Power': 'Off' } },
    timings: { wakeCheckDelay: 200 },
  });
  const device = await createDevice(ctx);
  assert.equal((await set(ctx, device, 'power_on')).success, true);
  assert.deepEqual(ctx.fake.commands(), ['Main.Power=On']);
  ctx.fake.state['Main.Volume'] = '-4';
  ctx.fake.push('Main.Volume=-4');
  await waitFor(() => ctx.fake.commands().includes('Main.Volume=-20'), 'the volume lowered');
  assert.equal(ctx.fake.state['Main.Volume'], '-20');
});

test('the publication delay grows with the number of created devices', async (t) => {
  const ctx = await setup(t);
  await createDevice(ctx);
  const delays = [];
  const original = ctx.app.timers;
  ctx.app.timers = {
    ...original,
    setTimeout: (fn, ms) => {
      delays.push(ms);
      return original.setTimeout(fn, ms);
    },
  };
  ctx.app.created = new Set(['a', 'b', 'c']);
  ctx.app.schedulePublish('a');
  ctx.app.timers = original;
  assert.deepEqual(delays, [FAST.publishDelay * 3]);
});

test('parseVolumeCommand', () => {
  assert.equal(parseVolumeCommand(0), 0);
  assert.equal(parseVolumeCommand(' 42 '), 42);
  for (const bad of [null, undefined, '', true, 12.5, '12abc', -1, 101, NaN, {}]) {
    assert.equal(parseVolumeCommand(bad), undefined, String(bad));
  }
});
