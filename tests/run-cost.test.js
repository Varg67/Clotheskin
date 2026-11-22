// What a run costs: every `kin` call is running time, and running time is the person's credits. Kindroid starts the
// program every 15 minutes (96 times a day), even while it is stopped, so the calls of each kind of start are checked
// exactly: a new call anywhere shows up here first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../run/program.js';
import { fakeKindroid, READING } from './support/fake-kindroid.js';
import { ACTION } from '../src/core/state.js';

const tick = (k) => runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });
const calls = (k) => k.calls.map((c) => c.slice(0, 2).join(' '));
const fresh = (k) => { k.calls.length = 0; };

const READ = ['get settings.json', 'get status.json', 'kins', 'ask reading', 'get status.json', 'put status.json'];

test('cost: a reading of an awake Kin is 6 calls, one of them a question', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(READING('sitting on the bed', 'reading a book'));
  await tick(k);
  assert.deepEqual(calls(k), READ);
});

test('cost: a start with nothing due reads the two files and nothing else', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(READING('sitting on the bed', 'reading a book'));
  await tick(k);
  fresh(k);
  await tick(k);
  assert.deepEqual(calls(k), ['get settings.json', 'get status.json']);
});

test('cost: falling asleep adds the sleep question and one more save', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(READING('lying in bed', 'sleeping'));
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  await tick(k);
  assert.deepEqual(calls(k), [...READ, 'ask sleep', 'get status.json', 'put status.json']);
});

test('cost: the morning is the dream question, kin tell and one save', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(READING('lying in bed', 'sleeping'));
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  k.answers.dream.push('{"dream":"I was flying over the sea","remembered":"most"}');
  await tick(k);
  k.at('2026-11-21T07:25:00-03:00');
  fresh(k);
  await tick(k);
  assert.deepEqual(calls(k).map((c) => (c.startsWith('tell') ? 'tell' : c)),
    ['get settings.json', 'get status.json', 'kins', 'ask dream', 'tell', 'get status.json', 'put status.json']);
});

for (const [name, settings] of [['stopped', { autoState: 'stopped', kinId: 'k1' }], ['paused', { autoState: 'paused', kinId: 'k1' }], ['with no Kin', { autoState: 'running' }]]) {
  test(`cost: a start while ${name} reads settings.json only`, async () => {
    const k = fakeKindroid({ settings });
    await tick(k);
    assert.deepEqual(calls(k), ['get settings.json']);
  });
}

test('time: Update status reads its two files at once, not one after the other', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(READING('sitting on the bed', 'reading a book'));
  const get = k.kin.get;
  let inFlight = 0;
  let most = 0;
  k.kin.get = async (path) => {
    inFlight += 1; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 20)); // a kin call takes a while
    inFlight -= 1;
    return get(path);
  };
  await runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: 'k1' } }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });
  assert.equal(most, 2, 'settings.json and status.json are read together');
  assert.deepEqual(calls(k).slice(0, 2), ['get settings.json', 'get status.json']);
});
