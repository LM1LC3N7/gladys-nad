import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  addressId,
  dbToPercent,
  normalizeConfig,
  parseAddress,
  parseMaxDb,
  parseMinDb,
  parseSourceNames,
  percentToDb,
} from '../src/config.js';
import { MAX_VOLUME_DB, MIN_VOLUME_DB } from '../src/constants.js';
import { sanitizeData } from '../src/store.js';

test('addresses: IPv4 or host name, port 23 by default; never a serial port', () => {
  assert.deepEqual(parseAddress('192.168.1.50'), { host: '192.168.1.50', port: 23 });
  assert.deepEqual(parseAddress('telnet://192.168.1.50:2323/'), {
    host: '192.168.1.50',
    port: 2323,
  });
  assert.deepEqual(parseAddress('NAD-C338.local'), { host: 'nad-c338.local', port: 23 });
  for (const bad of [
    '',
    '999.1.1.1',
    '1.2.3',
    'a b',
    'host:0',
    'host:70000',
    '-x.local',
    'COM3',
    '/dev/ttyUSB0',
    'a_b',
    null,
  ]) {
    assert.equal(parseAddress(bad), undefined, String(bad));
  }
  assert.equal(addressId({ host: '192.168.1.50', port: 23 }), '192.168.1.50');
  assert.equal(addressId({ host: 'amp', port: 2323 }), 'amp_2323');
});

test('the volume range: the cap -80..0 dB (-20), the bottom -99..-21 dB, 10 dB apart', () => {
  assert.equal(DEFAULT_CONFIG.max_volume_db, MAX_VOLUME_DB.default);
  assert.equal(MAX_VOLUME_DB.default, -20);
  assert.equal(MIN_VOLUME_DB.default, -80);
  assert.equal(parseMaxDb(-35), -35);
  assert.equal(parseMaxDb('12'), 0);
  assert.equal(parseMaxDb(-200), -80);
  assert.equal(parseMaxDb(-20.4), -20);
  for (const bad of [null, undefined, '', ' ', 'abc', true, NaN, {}]) {
    assert.equal(parseMaxDb(bad), -20, String(bad));
  }
  assert.equal(parseMinDb(-70, -20), -70);
  assert.equal(parseMinDb(-25, -20), -30);
  assert.equal(parseMinDb(-90, -80), -90);
  assert.equal(parseMinDb(undefined, -80), -90);
  assert.equal(parseMinDb(-500, -20), -99);
});

test('percent <-> dB: 100 % is the cap, never above', () => {
  const range = { minDb: -80, maxDb: -20 };
  assert.equal(percentToDb(0, range), -80);
  assert.equal(percentToDb(50, range), -50);
  assert.equal(percentToDb(100, range), -20);
  assert.equal(percentToDb(1000, range), -20);
  assert.equal(dbToPercent(-30, range), 83);
  assert.equal(dbToPercent(-5, range), 100);
  assert.equal(dbToPercent(-95, range), 0);
});

test('source names', () => {
  assert.deepEqual(parseSourceNames('1=CD, 2 = Tuner;3=TV,1=Again'), {
    options: [
      { value: '1', label: 'CD' },
      { value: '2', label: 'Tuner' },
      { value: '3', label: 'TV' },
    ],
    invalid: [],
  });
  assert.deepEqual(parseSourceNames('CD, a b=x, 4=').invalid, ['CD', 'a b=x', '4=']);
});

test('normalizeConfig', () => {
  const config = normalizeConfig({
    addresses: '192.168.1.50, 192.168.1.50;192.168.1.51:23 nope!',
    max_volume_db: '-30',
    min_volume_db: -60,
  });
  assert.deepEqual(
    config.addresses.map((a) => a.host),
    ['192.168.1.50', '192.168.1.51'],
  );
  assert.deepEqual(config.invalid, ['nope!']);
  assert.equal(config.maxDb, -30);
  assert.equal(config.minDb, -60);
  assert.deepEqual(normalizeConfig().addresses, []);
  assert.equal(normalizeConfig().maxDb, -20);
  assert.equal(normalizeConfig({ max_volume_db: null }).maxDb, -20);
});

test('/data: only devices keyed by the id of their own address, no prototype', () => {
  const data = sanitizeData({
    devices: {
      '192.168.1.50': { id: '192.168.1.50', host: '192.168.1.50', port: 23, model: 'C338' },
      amp_2323: { id: 'amp_2323', host: 'amp', port: 2323, sourceOptions: [{ value: 'x y' }] },
      wrong: { id: 'wrong', host: '192.168.1.9', port: 23 },
      constructor: { id: 'constructor', host: 'constructor', port: 23 },
    },
  });
  assert.equal(Object.getPrototypeOf(data.devices), null);
  assert.deepEqual(Object.keys(data.devices), ['192.168.1.50', 'amp_2323', 'constructor']);
  assert.deepEqual(data.devices.amp_2323.sourceOptions, []);
  assert.deepEqual(sanitizeData('junk').devices, Object.create(null));
});
