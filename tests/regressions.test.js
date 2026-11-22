// Bugs found while planning the refactoring (docs/plano-de-refatoracao.md, section 1.2), one test each, written
// before the fix (as todo) and kept after it, so the bug cannot come back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../run/program.js';
import { ACTION } from '../src/core/state.js';
import { describeReading, parseReading } from '../src/core/outfit.js';
import { isDue, startDueFor } from '../src/core/schedule.js';
import { fakeKindroid, READING } from './support/fake-kindroid.js';

const tick = (k) => runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });

test('B1: when Kindroid cannot list the Kins, the run says so (not "[object Object]")', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.kin.kins = async () => { throw new Error('kin kins failed: 503 Service Unavailable'); };
  const r = await tick(k);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /object Object/);
  assert.match(r.message, /Could not list the Kins/);
});

test('B2: running out of the run\'s own time is not counted as a Kindroid failure', async () => {
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
  assert.equal(e.retryAt, new Date(k.clock().getTime() + 15 * 60000).toISOString(), 'the dream question waits for the next start');
  assert.match(e.note, /waits for the next start/);
});

test('B2: a reading with no time left waits for the next start, without an error and without losing the last reading', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(READING('sitting on the bed', 'reading a book'));
  await tick(k);
  const before = k.entry();
  k.advance(30);
  const r = await runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: 'k1' } }, kin: k.kin, clock: k.clock, retryAfterMs: 0, budgetMs: 20000 });
  assert.equal(r.ok, true, r.message);
  const e = k.entry();
  assert.deepEqual([e.failures, e.serverFailures, e.errorKind, e.error], [0, 0, null, null]);
  assert.deepEqual(e.reading, before.reading);
  assert.deepEqual(k.asks(), ['reading'], 'no question was started');
});

test('B3: describing a reading never throws on a partial result', () => {
  for (const partial of [{}, { ok: false, error: 'x' }, { outfit: null }]) {
    const d = describeReading(partial);
    assert.equal(d.outfit, 'No outfit described in the recent chat.');
  }
});

test('B4: an answer far longer than asked is refused before parsing, without quoting it', () => {
  const r = parseReading(`Sure! ${'*She looks around the secret garden.* '.repeat(2000)} {"location":"in the garden"}`);
  assert.equal(r.ok, false);
  assert.match(r.error, /too long/);
  assert.doesNotMatch(r.error, /garden/);
});

test('a planned time that cannot be read is due at once, and never breaks the screen\'s "next update" time', () => {
  const now = new Date('2026-11-20T22:07:00Z');
  for (const at of ['garbage', '2026-13-45T99:99:99Z', {}]) {
    assert.equal(isDue(at, now), true, String(at));
    assert.equal(startDueFor(at, now).toISOString(), '2026-11-20T22:15:00.000Z');
  }
});

test('a failure that is not an Error (a string, null) is still told in words, never "undefined"', async () => {
  for (const thrown of ['503 Service Unavailable', null]) {
    const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
    k.kin.kins = async () => { throw thrown; };
    const r = await tick(k);
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.message, /undefined/);
    assert.match(k.entry().error, new RegExp(`Could not list the Kins: ${String(thrown)}`));
  }
});
