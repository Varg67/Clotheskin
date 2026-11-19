import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIOS, expected } from '../scripts/real-kin-scenarios.mjs';
import { renderScript } from '../scripts/build-test-script.mjs';

test('the real-Kin test script is generated from the code and is up to date', () => {
  assert.equal(readFileSync(new URL('../docs/real-kin-test-script.md', import.meta.url), 'utf8'), renderScript());
});

test('every scenario has a valid ideal answer, its checks, and the plan/finished/hypothetical cases are covered', () => {
  assert.ok(SCENARIOS.length >= 12);
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
  assert.equal(byId.S5b.location, 'At the hospital.');
  assert.equal(byId.S8.outfit, 'Wearing a leather jacket, a perfumed white shirt and blue jeans.');
  assert.equal(byId.S13.location, 'No location described in the recent chat.');
});
