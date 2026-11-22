import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIOS, expected, STEPS, IN_CHARACTER_ERROR } from '../scripts/real-kin-scenarios.mjs';
import { renderScript } from '../scripts/build-test-script.mjs';
import { runProgram } from '../run/program.js';
import { ACTION } from '../src/core/state.js';
import { fakeKindroid } from './support/fake-kindroid.js';

test('the real-Kin test script is generated from the code and is up to date (npm run build)', () => {
  assert.equal(readFileSync(new URL('../docs/real-kin-test-script.md', import.meta.url), 'utf8'), renderScript());
});

test('every scenario has a valid ideal answer and its checks; plans, finished actions and hypotheticals are covered', () => {
  assert.ok(SCENARIOS.length >= 14);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  for (const s of SCENARIOS) {
    assert.doesNotThrow(() => expected(s), s.id);
    assert.ok(s.say && s.kinSays && s.checks.length && s.ifWrong, s.id);
  }
  const byId = Object.fromEntries(SCENARIOS.map((s) => [s.id, expected(s)]));
  assert.equal(byId.S1.outfit, 'Wearing a leather jacket, a white shirt and blue jeans.');
  assert.equal(byId.S2.outfit, 'Wearing a white shirt and blue jeans.', 'the taken-off jacket is gone');
  assert.equal(byId.S3.location, 'In the living room.', 'a plan does not move the Kin');
  assert.equal(byId.S3.doing, 'Sitting on the sofa.', 'a plan is not an action');
  assert.equal(byId.S5a.location, 'On the bus to the hospital.');
  assert.equal(byId.S8.outfit, 'Wearing a leather jacket, a perfumed white shirt and blue jeans.');
  assert.equal(byId.S13.location, 'No location described in the recent chat.');
  assert.deepEqual([byId.S14.hair, byId.S14.makeup], ['Long black hair in a ponytail.', 'Red lipstick.']);
  assert.equal(byId.S1.hair, null, 'no hair described: no Hair row on the card');
});

test('the steps cover the night, the automation with the panel closed, Pause/Stop and the failures', () => {
  assert.deepEqual(STEPS.map((f) => f.id), ['N1', 'A1', 'A2', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']);
  for (const f of STEPS) assert.ok(f.title && f.provoke && f.expectText && f.checks.length && f.record, f.id);
});

test('the error the script quotes for an answer in character is the one the run really stores', async () => {
  const k = fakeKindroid({ settings: { autoState: 'stopped', kinId: 'k1' } });
  k.answers.reading.push('*giggles* Not today!');
  await runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: 'k1' } }, kin: k.kin, clock: k.clock });
  assert.equal(k.entry().error, IN_CHARACTER_ERROR);
  assert.match(readFileSync(new URL('../docs/real-kin-test-script.md', import.meta.url), 'utf8'), /answer could not be read: The answer is not valid JSON\. Nothing was changed\./);
});
