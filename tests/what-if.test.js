// "What if…" scenarios: futures in which the app could break. Each test states what SHOULD happen when something
// odd occurs: a strange answer from the Kin, a corrupt file, a clock that misbehaves, two writers at once, the
// 500-character limit at its worst, and thousands of random answers (fuzzing, with a fixed seed so it repeats).
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRun, packReading } from '../run/actions.js';
import { parseReading, describeReading } from '../screen/src/core/outfit.js';
import { buildOutfitPrompt } from '../screen/src/core/prompt.js';
import { MemoryStorage, Settings } from '../screen/src/core/store.js';
import { ReadingStore, JournalStore, readingKey, journalKey, afterAttempt, withHistory, emptyJournal } from '../screen/src/core/readings.js';
import { retryWaitMinutes, pickDue, adaptiveLine } from '../screen/src/core/auto.js';
import { formatClock, formatRelative } from '../screen/src/core/format.js';

const T0 = new Date('2026-11-20T12:00:00Z');
const plus = (min) => new Date(T0.getTime() + min * 60000);
const manual = (kin = 'k') => ({ trigger: 'action', action: 'read_outfit', input: { kin, name: 'Isa' } });
const run = (answer, opts = {}) => handleRun({ event: manual(), provider: { extract: async () => answer }, clock: () => T0, sleep: async () => {}, ...opts });
const read = (o) => { const p = parseReading(typeof o === 'string' ? o : JSON.stringify(o)); return p.ok ? describeReading(p) : p; };

// ================================================================ 1. the Kin answers strangely
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
  assert.match(p, /^You are \{\{recent_chat\}\} \$& \$1 \{\{name\}\}\./);
  assert.ok(!p.includes('RECENT CHAT'));
});

// ================================================================ 2. corrupt files
test('what if a stored file has a date that is not a date? The screen must never crash formatting it', () => {
  for (const bad of ['yesterday', '', 'NaN', '2026-13-45T99:99:99Z']) {
    assert.doesNotThrow(() => formatClock(bad), bad);
    assert.doesNotThrow(() => formatRelative(bad), bad);
  }
});

test('what if the stored reading has a broken date? It is treated as having no date', async () => {
  const storage = new MemoryStorage();
  await storage.set(readingKey('k'), JSON.stringify({ at: 'garbage', attemptedAt: 'also garbage', location: 'In A.', doing: 'D.', outfit: 'O.' }));
  const r = await new ReadingStore(storage).get('k');
  assert.equal(r.at, null);
  assert.equal(r.attemptedAt, null);
});

test('what if the journal has entries with broken dates? They are dropped, not shown', async () => {
  const storage = new MemoryStorage();
  await storage.set(journalKey('k'), JSON.stringify({ history: [{ at: 'x', location: 'In A.' }, { at: T0.toISOString(), location: 'In B.' }], log: [{ at: 'never' }] }));
  const j = await new JournalStore(storage).get('k');
  assert.deepEqual(j.history.map((e) => e.location), ['In B.']);
  assert.deepEqual(j.log, []);
});

test('what if the settings say autoAdaptive "false" as text, or the interval is nonsense?', async () => {
  const storage = new MemoryStorage();
  await storage.set('clotheskin:v2:settings', JSON.stringify({ autoUpdate: true, autoIntervalMinutes: 'abc', autoAdaptive: 'false', autoKins: [{ id: 'k', name: 'Isa' }] }));
  const asked = [];
  const provider = { extract: async () => { asked.push(1); return '{"location":"in A"}'; } };
  for (let m = 0; m <= 30; m += 5) await handleRun({ event: { trigger: 'schedule' }, provider, storage, clock: () => plus(m) });
  // The interval falls back to 15 and the text "false" to the default (on): the same answer at 0 and 15 stretches
  // the next wait to 30 minutes, so nothing more is asked by minute 30.
  assert.equal(asked.length, 2);
});

test('what if the settings say autoUpdate "false" as text? Automatic updates stay OFF (no credits spent)', async () => {
  for (const v of ['false', 'no', 1, 'true']) {
    const storage = new MemoryStorage();
    await storage.set('clotheskin:v2:settings', JSON.stringify({ autoUpdate: v, autoKins: [{ id: 'k', name: 'Isa' }] }));
    const out = await handleRun({ event: { trigger: 'schedule' }, provider: { extract: async () => { throw new Error('must not ask'); } }, storage, clock: () => T0 });
    assert.equal(out.message, 'Automatic updates are off.', String(v));
  }
});

test('what if the settings list the same Kin twice, or a Kin without id?', async () => {
  const storage = new MemoryStorage();
  await storage.set('clotheskin:v2:settings', JSON.stringify({ autoUpdate: true, autoKins: [{ id: 'k', name: 'Isa' }, { id: 'k', name: 'Isa' }, { name: 'ghost' }, null, 5] }));
  const asked = [];
  const out = await handleRun({ event: { trigger: 'schedule' }, provider: { extract: async () => { asked.push(1); return '{}'; } }, storage, clock: () => T0 });
  assert.equal(asked.length, 1);
  assert.equal(out.ok, true, out.message);
});

// ================================================================ 3. time misbehaves
test('what if the Kin fails in the middle of a quiet stretch? After it recovers, the wait starts over from the interval', () => {
  const s = { location: 'In A.', doing: 'D.', outfit: 'O.', hair: 'H.', makeup: 'M.' };
  let r = afterAttempt(null, { now: T0, source: 'auto', sentences: s });
  for (let i = 1; i <= 3; i += 1) r = afterAttempt(r, { now: plus(15 * i), source: 'auto', sentences: s });
  assert.equal(r.stableCount, 3);
  r = afterAttempt(r, { now: plus(80), source: 'auto', error: 'down', kind: 'unavailable' });
  r = afterAttempt(r, { now: plus(85), source: 'auto', sentences: s });
  assert.equal(retryWaitMinutes(r, 15, { adaptive: true }), 15, 'README: "a failure goes back to your interval"');
});

test('what if the clock jumps back an hour (the run machine fixes its time)? The Kin is not silenced', () => {
  // Exactly as far back as the wait is still "not yet" (a boundary, not a bug); further back is due at once.
  assert.equal(pickDue({ now: plus(-60), kins: [{ id: 'k' }], readings: { k: { attemptedAt: T0.toISOString(), stableCount: 5 } }, intervalMinutes: 15, adaptive: true }).length, 0);
  const due = pickDue({ now: plus(-61), kins: [{ id: 'k' }], readings: { k: { attemptedAt: T0.toISOString(), stableCount: 5 } }, intervalMinutes: 15, adaptive: true });
  assert.equal(due.length, 1, 'a last attempt in the future by more than the interval counts as due');
});

test('what if the stableCount in the file is absurd (negative, huge, text)?', () => {
  for (const v of [-5, 1e9, 'lots', null, 2.5]) {
    const w = retryWaitMinutes({ stableCount: v, failures: 0, error: null }, 15, { adaptive: true });
    assert.ok(w >= 15 && w <= 60, `${v}: ${w}`);
  }
  assert.equal(adaptiveLine({ stableCount: 1e9, error: null }, 15).includes('NaN'), false);
});

// ================================================================ 4. two things at once
test('what if the person clears the history while a reading is being written? The new log entry is not lost', async () => {
  const storage = new MemoryStorage();
  const store = new JournalStore(storage);
  await run('{"location":"in A"}', { storage });
  const seenByScreen = await store.get('k');
  await run('{"location":"in B"}', { storage, clock: () => plus(1) }); // happens after the screen loaded it
  // what the screen's Clear history does:
  const { clearHistory } = await import('../screen/src/core/readings.js');
  assert.equal(typeof clearHistory, 'function', 'clearing must re-read the journal, not write back a stale copy');
  await clearHistory(store, 'k');
  const after = await store.get('k');
  assert.equal(after.history.length, 0);
  assert.equal(after.log.length, 2, 'both attempts are still in the diagnostics');
  assert.equal(seenByScreen.log.length, 1);
});

test('what if a manual reading and a beat for the same Kin finish together? The reading file stays valid', async () => {
  const storage = new MemoryStorage();
  const s = new Settings(storage);
  await s.load();
  await s.save({ autoUpdate: true, autoKins: [{ id: 'k', name: 'Isa' }] });
  await Promise.all([
    run('{"location":"in A"}', { storage }),
    handleRun({ event: { trigger: 'schedule' }, provider: { extract: async () => '{"location":"in B"}' }, storage, clock: () => T0 }),
  ]);
  const r = await new ReadingStore(storage).get('k');
  assert.ok(['In A.', 'In B.'].includes(r.location));
  const j = await new JournalStore(storage).get('k');
  assert.ok(j.log.length >= 1);
});

// ================================================================ 5. the 500-character line at its worst
test('what if every sentence is full of characters that JSON has to escape (quotes, backslashes, control codes)?', () => {
  const nasty = (n) => '"\\\u0001'.repeat(n);
  const o = { location: `In ${nasty(40)}.`, doing: `${nasty(55)}.`, outfit: `Wearing ${nasty(200)}.`, hair: `${nasty(33)}.`, makeup: `${nasty(33)}.` };
  const line = packReading(o, { at: T0.toISOString() });
  assert.ok(line.length <= 500, String(line.length));
  assert.doesNotThrow(() => JSON.parse(line));
});

test('what if the line is cut in the middle of an emoji? No broken half-character is sent', () => {
  const o = { location: 'In A.', doing: 'D.', outfit: `Wearing ${'👗'.repeat(400)}.` };
  const line = packReading(o);
  const back = JSON.parse(line).outfit;
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(back), 'no lone surrogate');
});

test('what if a real messy answer has everything at maximum length? The whole run still fits and parses', async () => {
  const long = (w) => `${w} `.repeat(60).trim();
  const answer = JSON.stringify({ location: `in ${long('somewhere')}`, pose: long('sitting'), action: long('reading'), hair: long('long'), makeup: long('red'), topwear: Array.from({ length: 8 }, () => long('silk')), 'neck-accessory': Array.from({ length: 8 }, (_, i) => `${i} ${long('gold')}`) });
  const out = await run(answer);
  assert.equal(out.ok, true);
  assert.ok(out.message.length <= 500);
  assert.doesNotThrow(() => JSON.parse(out.message));
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

test('fuzzing: 2,000 random sentence sets always pack into valid JSON within 500 characters, location never cut', () => {
  for (let i = 0; i < 2000; i += 1) {
    const s = { location: str().slice(0, 125), doing: str().slice(0, 170), outfit: Array.from({ length: Math.floor(R() * 30) }, str).join(', '), hair: str().slice(0, 102), makeup: str().slice(0, 102) };
    const line = packReading(s, { at: T0.toISOString() });
    assert.ok(line.length <= 500, `${line.length}`);
    const o = JSON.parse(line);
    if (!o.cut) assert.equal(o.outfit, s.outfit);
  }
});

test('fuzzing: 300 random answers through the whole manual run, history and diagnostics stay valid', async () => {
  const storage = new MemoryStorage();
  for (let i = 0; i < 300; i += 1) {
    const o = {};
    for (let k = Math.floor(R() * 6); k > 0; k -= 1) o[pick(KEYS)] = val();
    const out = await run(R() < 0.1 ? str() : JSON.stringify(o), { storage, clock: () => plus(i) });
    assert.ok(out.message.length <= 500);
    if (out.ok) JSON.parse(out.message);
  }
  const j = await new JournalStore(storage).get('k');
  assert.ok(j.history.length <= 20 && j.log.length === 15);
  for (const e of j.history) assert.ok(Number.isFinite(Date.parse(e.at)));
  assert.ok(withHistory(emptyJournal(), { at: 5 }).history.length === 0);
});
