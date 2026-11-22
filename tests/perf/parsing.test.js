// Performance budgets (npm run test:perf). They are generous on purpose (several times what a laptop measures) so
// they never flake on a slow machine; they exist to catch what is orders of magnitude off: a regular expression that
// backtracks catastrophically on what a model writes, or work that grows with the square of the answer.
// Measured on the baseline (docs/plano-de-refatoracao.md, 1.7): parseReading 28-65 us, a program run 0.2 ms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, describeReading } from '../../src/core/outfit.js';
import { parseJsonObject } from '../../src/core/json.js';
import { nextWallTime } from '../../src/core/time.js';
import { runProgram } from '../../run/program.js';
import { fakeKindroid, READING } from '../support/fake-kindroid.js';

/** Average milliseconds of fn over n calls, after one warm-up call. */
async function averageMs(fn, n) {
  await fn();
  const t = performance.now();
  for (let i = 0; i < n; i += 1) await fn();
  return (performance.now() - t) / n;
}
const once = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

const ANSWERS = [
  '{"location":"in the kitchen","pose":"standing at the counter","action":"making coffee","hair":"a messy bun","topwear":["a red sweater"],"bottomwear":["blue jeans"]}',
  '*She smiles* Sure! {location: \'na cozinha\', "pose": “sentada”, action: \'tomando café\', // note\n topwear: [\'uma camiseta\',], hair: None} Hope that helps {wink}',
  '```json\n{"Location":"At the hospital","Top Wear":["a white coat","a blue scrub top"],"footwear":"white clogs","makeup":"no makeup"}\n```',
  '{"Isa":{"where":"on the bus to college","doing":"listening to music","outfit":{"topwear":["a hoodie"],"bags":["a backpack"]}}}',
  'I\'m not sure what you mean.',
];

test('perf: reading an answer, clean or messy, takes well under a millisecond', async () => {
  const ms = await averageMs(() => { for (const a of ANSWERS) { const p = parseReading(a); if (p.ok) describeReading(p); } }, 400) / ANSWERS.length;
  assert.ok(ms < 0.5, `${ms.toFixed(3)} ms per answer`);
});

const ADVERSARIAL = {
  'unbalanced braces': '{'.repeat(50000),
  'an open quote': `{"location":"${'x'.repeat(100000)}`,
  'nested brackets': `${'{"a":['.repeat(5000)}1${']}'.repeat(5000)}`,
  'many small objects': 'x {a} '.repeat(10000),
  'a very long key': `{${'k'.repeat(100000)}: 1}`,
};
// Every candidate {...} is parsed in turn: thousands of them cost ~3.5 us per character today (60 KB: ~210 ms).
const TODO = { 'many small objects': 'refactoring plan, phase 1.4 (B4): no size limit on the answer yet' };
for (const [name, text] of Object.entries(ADVERSARIAL)) {
  test(`perf: an adversarial answer (${name}, ${Math.round(text.length / 1000)} KB) is handled in under 250 ms`, { todo: TODO[name] }, () => {
    const ms = once(() => parseJsonObject(text));
    assert.ok(ms < 250, `${ms.toFixed(0)} ms`);
  });
}

test('perf: 200 KB of bare words is handled in under 100 ms', { todo: 'refactoring plan, phase 1.4 (B4): grows faster than linear today' }, () => {
  const ms = once(() => parseJsonObject(`{${'ab, '.repeat(50000)}`));
  assert.ok(ms < 100, `${ms.toFixed(0)} ms`);
});

test('perf: a whole run with an instant Kin takes a few milliseconds of the run\'s own time', async () => {
  const ms = await averageMs(async () => {
    const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
    k.answers.reading.push(READING('sitting on the bed', 'reading a book'));
    await runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });
  }, 100);
  assert.ok(ms < 5, `${ms.toFixed(2)} ms per run`);
});

test('perf: wake-up times for a year in 10 time zones (daylight-saving changes included)', () => {
  const zones = ['UTC', 'America/Sao_Paulo', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles'];
  const ms = once(() => {
    for (const z of zones) for (let d = 0; d < 365; d += 1) nextWallTime({ h: 7, m: 30 }, new Date(Date.UTC(2026, 0, 1) + d * 864e5), z);
  });
  assert.ok(ms < 8000, `${ms.toFixed(0)} ms for 3,650 wake-up times`);
});
