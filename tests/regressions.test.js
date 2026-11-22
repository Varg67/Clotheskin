// Bugs found while planning the refactoring (docs/plano-de-refatoracao.md, section 1.2). Each test is marked todo
// until its fix lands; the fix removes the mark, so the bug cannot come back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram, ACTION } from '../run/program.js';
import { describeReading } from '../src/core/outfit.js';
import { fakeKindroid, READING } from './support/fake-kindroid.js';

const tick = (k) => runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });

test('B1: when Kindroid cannot list the Kins, the run says so (not "[object Object]")', { todo: 'refactoring plan, phase 1.1' }, async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.kin.kins = async () => { throw new Error('kin kins failed: 503 Service Unavailable'); };
  const r = await tick(k);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /object Object/);
  assert.match(r.message, /Could not list the Kins/);
});

test('B2: running out of the run\'s own time is not counted as a Kindroid failure', { todo: 'refactoring plan, phase 1.2' }, async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(READING('lying in bed', 'sleeping'));
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  await tick(k);
  // Wake now with less time left than one question needs (the run's budget, not Kindroid, is short).
  const r = await runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: 'k1', op: 'wake' } }, kin: k.kin, clock: k.clock, retryAfterMs: 0, budgetMs: 20000 });
  assert.equal(r.ok, true, r.message);
  const e = k.entry();
  assert.equal(e.failures, 0);
  assert.equal(e.serverFailures, 0);
  assert.ok(e.sleep, 'the night goes on');
});

test('B3: describing a reading never throws on a partial result', { todo: 'refactoring plan, phase 1.3' }, () => {
  for (const partial of [{}, { ok: false, error: 'x' }, { outfit: null }]) {
    const d = describeReading(partial);
    assert.equal(d.outfit, 'No outfit described in the recent chat.');
  }
});
