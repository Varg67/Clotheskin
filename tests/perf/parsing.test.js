// Performance budgets (npm run test:perf). They are generous on purpose (several times what a laptop measures) so
// they never flake on a slow machine; they exist to catch what is orders of magnitude off: a regular expression that
// backtracks catastrophically on what a model writes, or work that grows with the square of the answer.
// Measured on the baseline (docs/plano-de-refatoracao.md, 1.7): parseReading 28-65 us, a program run 0.2 ms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, describeReading } from '../../src/core/outfit.js';
import { parseJsonObject, MAX_ANSWER_CHARS } from '../../src/core/json.js';
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

// Adversarial answers as long as an answer may be (MAX_ANSWER_CHARS): the worst a model can make the parser do.
// Measured at 20,000 characters: thousands of small {...} ~50 ms (each is one more parse), everything else < 10 ms.
const fill = (unit, before = '', after = '') => before + unit.repeat(Math.floor((MAX_ANSWER_CHARS - before.length - after.length) / unit.length)) + after;
const ADVERSARIAL = {
  'bare words': fill('ab, ', '{'),
  'many small objects': fill('x {a} '),
  'unbalanced braces': fill('{'),
  'an open quote': fill('x', '{"location":"'),
  'nested brackets': fill('{"a":['),
  'a very long key': fill('k', '{', ': 1}'),
};
for (const [name, text] of Object.entries(ADVERSARIAL)) {
  test(`perf: an adversarial answer at the length limit (${name}) is handled in under 150 ms`, () => {
    assert.ok(text.length <= MAX_ANSWER_CHARS && text.length > MAX_ANSWER_CHARS - 10);
    const ms = once(() => parseJsonObject(text));
    assert.ok(ms < 150, `${ms.toFixed(0)} ms`);
  });
}

test('perf: an answer over the length limit that is not strict JSON is refused at once, without quoting it', () => {
  const text = `{location: '${'secret scene '.repeat(20000)}'}`;
  let r;
  const ms = once(() => { r = parseJsonObject(text); });
  assert.ok(ms < 5, `${ms.toFixed(1)} ms`);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /secret/);
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
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms for 3,650 wake-up times`); // ~200 ms since the zone check is cached (was ~2 s)
});
