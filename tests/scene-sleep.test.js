import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../run/program.js';
import { cleanAction } from '../src/core/phrases.js';
import { looksAsleep } from '../src/core/sleep.js';
import { ACTION } from '../src/core/state.js';
import { fakeKindroid } from './support/fake-kindroid.js';

async function read(k, fields) {
  k.answers.reading.splice(0, Infinity, JSON.stringify(fields));
  const result = await runProgram({
    event: { trigger: 'action', action: ACTION, input: { kin: 'k1', op: 'read' } },
    kin: k.kin, clock: k.clock, retryAfterMs: 0,
  });
  assert.ok(result.ok, result.message);
  k.advance(15);
  return result.message;
}

test('roleplay marks, dialogue and the object of a current action', () => {
  for (const action of ['*making coffee*', '**making coffee**', '*making coffee* "Morning!"', '“Morning!” **making coffee**'])
    assert.equal(cleanAction(action), 'making coffee', action);
  assert.equal(cleanAction('*smiles* making coffee'), 'making coffee');
  assert.equal(cleanAction('packing for tomorrow’s trip'), 'packing for tomorrow’s trip');
  assert.equal(cleanAction('packing tomorrow'), null);
  assert.equal(cleanAction('going to sing'), null);
  assert.equal(cleanAction('going to the theatre'), 'going to the theatre');
});

test('sleep belongs to the subject and can follow a posture', () => {
  for (const text of ['Watching a sleeping baby.', 'Sitting, reading about someone sleeping.', 'Lying on a sleeping bag.'])
    assert.equal(looksAsleep(text), false, text);
  for (const text of ['Fast asleep.', 'Lying in bed and sleeping.', 'Curled up on the couch fast asleep.'])
    assert.equal(looksAsleep(text), true, text);
});

test('confirmation, a compatible pose, then waking up', async () => {
  const k = fakeKindroid();
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  await read(k, { pose: 'lying in bed', action: 'sleeping' });
  const night = k.entry().sleep;
  assert.ok(night);
  assert.equal(k.entry().reading.doing, 'Lying in bed, sleeping.');
  await read(k, { pose: 'curled up on the couch' });
  assert.deepEqual(k.entry().sleep, night);
  await read(k, { pose: 'lying in bed', action: 'watching a sleeping baby' });
  assert.equal(k.entry().sleep, null);
  assert.equal(k.entry().reading.doing, 'Lying in bed, watching a sleeping baby.');
  assert.deepEqual(k.asks(), ['reading', 'sleep', 'reading', 'reading']);
});

test('a denied sleep claim keeps the posture even if the same claim returns', async () => {
  const k = fakeKindroid();
  k.answers.sleep.push('{"sleeping":false}');
  for (let i = 0; i < 2; i++) {
    const log = await read(k, { pose: 'lying in bed', action: 'sleeping' });
    assert.equal(k.entry().reading.doing, 'Lying in bed, awake.');
    assert.doesNotMatch(log, /lying in bed, sleeping/i);
    assert.equal(k.entry().sleep, null);
  }
  assert.deepEqual(k.asks(), ['reading', 'sleep', 'reading']);
});
