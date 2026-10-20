import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS,
  LineSplitter,
  TelnetFilter,
  applyLine,
  cleanText,
  encode,
  isSafeValue,
  parseDb,
  parseLine,
  parseOnOff,
  sourceNameKey,
} from '../src/nad/protocol.js';

test('commands: `\\n<key>?\\r` and `\\n<key>=<value>\\r`, never another line', () => {
  assert.equal(encode(KEYS.POWER, '?').toString('latin1'), '\nMain.Power?\r');
  assert.equal(encode(KEYS.VOLUME, '=', '-40').toString('latin1'), '\nMain.Volume=-40\r');
  assert.equal(encode(sourceNameKey(3), '?').toString('latin1'), '\nSource3.Name?\r');
  for (const bad of ['1\rMain.Power=Off', '', 'a b', '1\n', undefined, 'x'.repeat(40)]) {
    assert.throws(() => encode(KEYS.SOURCE, '=', bad), /Invalid/, String(bad));
  }
  assert.throws(() => encode('Main.Speaker', '?'), /Unknown NAD key/);
  assert.throws(() => encode(KEYS.POWER, '+'), /Invalid/);
});

test('lines: anchored, bounded, key lowercased', () => {
  assert.deepEqual(parseLine('Main.Power=On'), { key: 'main.power', value: 'On' });
  assert.deepEqual(parseLine('  Main.Volume=-35.5 dB '), { key: 'main.volume', value: '-35.5 dB' });
  assert.deepEqual(parseLine('Tuner.FM.Frequency=101.5'), {
    key: 'tuner.fm.frequency',
    value: '101.5',
  });
  for (const bad of [
    '',
    'Main.Power',
    '=On',
    'Main=On',
    'Main.Power=\u0007',
    `Main.X=${'a'.repeat(200)}`,
  ]) {
    assert.equal(parseLine(bad), undefined, JSON.stringify(bad).slice(0, 40));
  }
});

test('values', () => {
  assert.equal(parseOnOff('On'), true);
  assert.equal(parseOnOff('OFF'), false);
  assert.equal(parseOnOff('Standby'), undefined);
  assert.equal(parseDb('-30'), -30);
  assert.equal(parseDb('-35.5dB'), -35.5);
  assert.equal(parseDb('+6 dB'), 6);
  for (const bad of ['', 'abc', '-1000', '--3', '1e2', 'NaN', '-30 decibels']) {
    assert.equal(parseDb(bad), undefined, bad);
  }
  assert.equal(isSafeValue('Coaxial1'), true);
  assert.equal(isSafeValue('-40'), true);
  assert.equal(isSafeValue('a\rb'), false);
  assert.equal(cleanText('‮C338\u0000 '), 'C338');
  assert.equal(cleanText('   '), undefined);
});

test('applyLine: known keys only, the same object when nothing changed, no prototype', () => {
  const s0 = {};
  const s1 = applyLine(s0, { key: 'main.power', value: 'On' });
  assert.equal(s1.power, true);
  assert.equal(applyLine(s1, { key: 'main.power', value: 'On' }), s1);
  assert.equal(applyLine(s1, { key: 'main.speakera', value: 'On' }), s1);
  const s2 = applyLine(s1, { key: 'source2.name', value: 'Tuner' });
  assert.equal(s2.sourceNames[2], 'Tuner');
  assert.equal(Object.getPrototypeOf(s2.sourceNames), null);
  assert.equal(applyLine(s2, { key: 'source99.name', value: 'X' }), s2);
  assert.equal(applyLine(s2, { key: 'source0.name', value: 'X' }), s2);
  assert.equal(applyLine(s2, { key: 'main.volume', value: '-20' }).volume, -20);
  assert.equal(applyLine(s2, { key: 'main.source', value: 'a b' }).source, undefined);
  assert.equal({}.polluted, undefined);
});

test('telnet: commands removed, every option refused once', () => {
  const filter = new TelnetFilter();
  const { data, replies } = filter.feed(
    Buffer.from([
      255, 253, 1, 77, 255, 251, 3, 255, 250, 24, 1, 255, 240, 10, 255, 255, 255, 253, 1,
    ]),
  );
  assert.deepEqual([...data], [77, 10]);
  assert.deepEqual(
    replies.map((r) => [...r]),
    [
      [255, 252, 1],
      [255, 254, 3],
    ],
  );
  // Split across chunks.
  const split = new TelnetFilter();
  assert.deepEqual(split.feed(Buffer.from([255])).replies, []);
  assert.deepEqual([...split.feed(Buffer.from([253, 24, 65])).replies[0]], [255, 252, 24]);
});

test('lines split on CR or LF; an endless line is dropped up to its end', () => {
  const splitter = new LineSplitter(20);
  assert.deepEqual(splitter.push('\nMain.Power=On\r\nMain.'), ['Main.Power=On']);
  assert.deepEqual(splitter.push('Mute=Off\r'), ['Main.Mute=Off']);
  assert.deepEqual(splitter.push('x'.repeat(15)), []);
  assert.deepEqual(splitter.push('y'.repeat(15)), []);
  assert.deepEqual(splitter.push('zz\rMain.Power=Off\r'), ['Main.Power=Off']);
});
