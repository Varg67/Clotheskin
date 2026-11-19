import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIOS, expected, FAILURES, expectedFailure } from '../scripts/real-kin-scenarios.mjs';
import { HOST_NO_ANSWER } from '../screen/src/core/errors.js';
import { autoFailureLines } from '../screen/src/core/auto.js';
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

test('the provoked-failure steps are complete and show BOTH outcomes when the real error text is unknown', () => {
  assert.deepEqual(FAILURES.map((f) => f.id), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
  for (const f of FAILURES) assert.ok(f.title && f.provoke && f.checks.length && f.record, f.id);

  const f4 = expectedFailure(FAILURES.find((f) => f.id === 'F4'));
  assert.equal(f4.length, 2, 'recognised as a permission problem, and not recognised');
  const [permission, unknown] = f4;
  assert.equal(permission.kind, 'permission');
  assert.equal(unknown.kind, 'unknown');
  assert.ok(permission.auto[0].lines.at(-1).startsWith('Retrying sooner will not help'), 'a permission problem is not retried sooner');
  assert.equal(unknown.auto[0].lines.at(-1), 'Trying again about 5 minutes after the last attempt.');
  assert.match(unknown.auto[1].lines.join(' '), /3 checks in a row have failed\. Trying again about 15 minutes/, 'the backoff is capped by the interval (15 minutes here)');
});

test('the script quotes the strings the card really shows, not copies of them', () => {
  const doc = readFileSync(new URL('../docs/real-kin-test-script.md', import.meta.url), 'utf8');
  assert.ok(doc.includes(HOST_NO_ANSWER), 'the "Kindroid did not answer" message comes from errors.js');
  const lines = autoFailureLines({ error: 'The Kin could not be asked.', failures: 2, errorKind: 'unknown' }, 15);
  assert.equal(lines.length, 3);
  const f6 = expectedFailure(FAILURES.find((f) => f.id === 'F6'));
  assert.match(f6[0].manual, /not valid JSON/);
  for (const l of doc.split('\n').filter((x) => x.startsWith('**Se o texto real'))) assert.equal(l.split('**').length - 1, 2, `no nested bold in: ${l}`);
  assert.match(doc, /Regra de ouro para a automação: ela roda \*\*na nuvem do Kindroid\*\*/);
});
