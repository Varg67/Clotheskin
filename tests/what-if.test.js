// "What if" scenarios and fuzzing for reading the Kin's answer (from the parallel line of work, ported to the
// new architecture: what tested its stores and run is covered by tests/program.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, describeReading } from '../src/core/outfit.js';
import { buildOutfitPrompt } from '../src/core/prompt.js';
import { formatClock, formatRelative } from '../src/core/format.js';
import { runProgram, ACTION } from '../run/program.js';
import { fakeKindroid } from './support/fake-kindroid.js';
const T0 = new Date('2026-11-20T12:00:00Z');
const plus = (min) => new Date(T0.getTime() + min * 60000);
/** The whole run with a stand-in Kin that gives `answer`: { out, reading } (reading as stored in status.json). */
async function run(answer) {
  const k = fakeKindroid({ now: T0.toISOString() });
  k.answers.reading.push(answer);
  const out = await runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: 'k1' } }, kin: k.kin, clock: k.clock });
  return { out, reading: k.entry().reading };
}
const read = (o) => { const p = parseReading(typeof o === 'string' ? o : JSON.stringify(o)); return p.ok ? describeReading(p) : p; };

test('what if the Kin uses a key that is a built-in name of JavaScript objects (constructor, toString…)?', () => {
  for (const k of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'prototype']) {
    const r = read(`{"location":"in the kitchen","${k}":1,"topwear":["a shirt"]}`);
    assert.ok(!r.error, `${k}: ${r.error}`);
    assert.equal(r.outfit, 'Wearing a shirt.', k);
  }
});

test('what if the Kin wraps its JSON in a list, [ {...} ]?', () => {
  const r = read('[{"location":"in the kitchen","topwear":["a shirt"]}]');
  assert.ok(!r.error, r.error);
  assert.equal(r.location, 'In the kitchen.');
});

test('what if the answer starts with an invisible byte-order mark or zero-width characters?', () => {
  const r = read('\uFEFF{"location":"in the\u200B kitchen","topwear":["a\u2060 shirt"]}');
  assert.ok(!r.error, r.error);
  assert.equal(r.location, 'In the kitchen.');
  assert.equal(r.outfit, 'Wearing a shirt.');
  assert.match(read({ hair: 'a bow 👩\u200D👩\u200D👧' }).hair, /👩\u200D👩\u200D👧/, 'the joiner inside emoji sequences is kept');
});

test('what if the Kin writes a key twice? The last one wins, like JSON says, and nothing breaks', () => {
  assert.equal(read('{"location":"in the bedroom","location":"in the kitchen"}').location, 'In the kitchen.');
});

test('what if the Kin answers with emojis, accents and right-to-left text?', () => {
  const r = read({ location: 'no café ☕ em São Paulo', hair: 'cabelo preso 🎀', topwear: ['a 👗 dress'], makeup: 'كحل' });
  assert.ok(!r.error);
  assert.match(r.hair, /🎀/);
});

test('what if the Kin answers with a giant text (1 MB)? It is handled in well under a second', () => {
  const big = JSON.stringify({ location: 'in the hall', topwear: Array.from({ length: 5000 }, (_, i) => `a shirt number ${i} `.repeat(10)) });
  const t = Date.now();
  const r = read(big);
  assert.ok(Date.now() - t < 1000, `${Date.now() - t} ms`);
  assert.ok(!r.error);
  assert.ok(r.outfit.length < 2000, 'at most 8 pieces of 80 characters');
});

test('what if the Kin answers with text that looks like HTML or a script? It stays text', () => {
  const r = read({ location: '<img src=x onerror=alert(1)>', hair: '<script>alert(1)</script>' });
  assert.ok(!r.error);
  assert.match(r.hair, /<script>/, 'kept as plain text; the screen never uses innerHTML for it');
});

test('what if the Kin name contains template markers or $ signs? They are not expanded', () => {
  const p = buildOutfitPrompt({ name: '{{recent_chat}} $& $1 {{name}}' });
  assert.match(p, /^Task: you are \{\{recent_chat\}\} \$& \$1 \{\{name\}\}\./m);
  assert.ok(!p.includes('RECENT CHAT'));
});

// ================================================================ 2. corrupt files

test('what if a stored file has a date that is not a date? The screen must never crash formatting it', () => {
  for (const bad of ['yesterday', '', 'NaN', '2026-13-45T99:99:99Z']) {
    assert.doesNotThrow(() => formatClock(bad), bad);
    assert.doesNotThrow(() => formatRelative(bad), bad);
  }
});

test('what if a real messy answer has everything at maximum length? The whole run still fits and parses', async () => {
  const long = (w) => `${w} `.repeat(60).trim();
  const answer = JSON.stringify({ location: `in ${long('somewhere')}`, pose: long('sitting'), action: long('reading'), hair: long('long'), makeup: long('red'), topwear: Array.from({ length: 8 }, () => long('silk')), 'neck-accessory': Array.from({ length: 8 }, (_, i) => `${i} ${long('gold')}`) });
  const { out, reading } = await run(answer);
  assert.equal(out.ok, true);
  assert.ok(out.message.length <= 500, 'the kin end line fits');
  assert.ok(reading.location.length > 20 && reading.outfit.startsWith('Wearing') && reading.hair && reading.makeup, 'all five sentences are stored');
});

// ================================================================ 6. fuzzing: thousands of random answers
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const R = rng(20261120);
const pick = (a) => a[Math.floor(R() * a.length)];
const KEYS = ['location', 'pose', 'action', 'hair', 'makeup', 'topwear', 'bottomwear', 'footwear', 'bags', 'neck-accessory', 'clothing', 'accessories', 'place', 'position', 'activity', 'hairstyle', 'random', 'constructor', '__proto__', ''];
const BITS = ['in the kitchen', 'sitting', 'a shirt', '"', '\\', '\n', '\u0000', '👗', 'é', '…', ',', '.', '  ', 'no makeup', 'none', 'unknown', 'I am reading', 'later', 'wearing', '{', '}', '[', ']', '<b>', 'x'.repeat(90), 'وشاح', '​'];
const str = () => Array.from({ length: Math.floor(R() * 6) }, () => pick(BITS)).join(pick(['', ' ', ', ']));
const val = (d = 0) => { const t = R(); if (t < 0.5) return str(); if (t < 0.75) return Array.from({ length: Math.floor(R() * 10) }, () => (R() < 0.9 ? str() : val(d + 1))); if (t < 0.85) return d < 2 ? { a: val(d + 1) } : 1; return pick([null, 3, true, false, '', []]); };

test('fuzzing: 3,000 random answers never crash the parser, and every good one becomes five sentences', () => {
  let good = 0;
  for (let i = 0; i < 3000; i += 1) {
    const o = {};
    for (let k = Math.floor(R() * 8); k > 0; k -= 1) o[pick(KEYS)] = val();
    let text = JSON.stringify(o);
    if (R() < 0.15) text = pick(['```json\n', 'Sure! ', '*smiles* ', '']) + text + pick(['', '```', ' 😊', ',']);
    let p;
    assert.doesNotThrow(() => { p = parseReading(text); }, text);
    if (!p.ok) { assert.equal(typeof p.error, 'string'); continue; }
    good += 1;
    const d = describeReading(p);
    for (const k of ['location', 'doing', 'outfit', 'hair', 'makeup']) {
      assert.equal(typeof d[k], 'string', `${k} of ${text}`);
      assert.ok(d[k].length > 0 && d[k].length < 1500, `${k} length ${d[k].length}`);
      assert.ok(!/undefined|null|\[object Object\]|NaN/.test(d[k]), `${k}: ${d[k]} from ${text}`);
    }
  }
  assert.ok(good > 300, `only ${good} good answers: the fuzzer is not reaching the describe step`);
});
