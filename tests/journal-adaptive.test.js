import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRun, packReading, MANUAL_JOURNAL_DEADLINE_MS } from '../run/actions.js';
import { MemoryStorage, Settings } from '../screen/src/core/store.js';
import { ReadingStore, JournalStore, journalKey, afterAttempt, sameSentences, withHistory, withLog, emptyJournal, HISTORY_MAX, LOG_MAX } from '../screen/src/core/readings.js';
import { adaptiveWaitMinutes, retryWaitMinutes, pickDue, adaptiveLine, ADAPTIVE_MAX_FACTOR } from '../screen/src/core/auto.js';

const T0 = new Date('2026-11-20T12:00:00Z');
const plus = (min) => new Date(T0.getTime() + min * 60000);
const ANSWER = '{"location":"in the kitchen","pose":"standing","action":"cooking","topwear":["a shirt"],"hair":"a messy bun","makeup":"red lipstick"}';
const manual = { trigger: 'action', action: 'read_outfit', input: { kin: 'k-isa', name: 'Isa' } };

// ---------------------------------------------------------------- the full reading reaches the screen
test('the end line says when the reading was stored, and carries hair and makeup', async () => {
  const storage = new MemoryStorage();
  const out = await handleRun({ event: manual, provider: { extract: async () => ANSWER }, storage, clock: () => T0 });
  const o = JSON.parse(out.message);
  assert.deepEqual(o, { at: T0.toISOString(), location: 'In the kitchen.', doing: 'Standing, cooking.', outfit: 'Wearing a shirt.', hair: 'A messy bun.', makeup: 'Red lipstick.' });
  const stored = await new ReadingStore(storage).get('k-isa');
  assert.equal(stored.at, o.at, 'the screen can match the line to the stored copy');
  assert.equal(stored.hair, 'A messy bun.');
});

test('hair and makeup are left out of the line when nothing was said, to leave room for the outfit', () => {
  const o = JSON.parse(packReading({ location: 'In A.', doing: 'D.', outfit: 'Wearing o.', hair: 'No hair described in the recent chat.', makeup: 'No makeup described in the recent chat.' }));
  assert.deepEqual(Object.keys(o), ['location', 'doing', 'outfit']);
});

test('a long reading is cut in the line, marked as cut, and stored whole', async () => {
  const storage = new MemoryStorage();
  const big = JSON.stringify({ location: 'in the kitchen', topwear: Array.from({ length: 8 }, (_, i) => `a very long descriptive jacket number ${i}`), 'neck-accessory': Array.from({ length: 8 }, (_, i) => `a long necklace number ${i}`), hair: 'long wavy auburn hair with a few loose strands framing her face and a ribbon', makeup: 'smoky eyeshadow, winged eyeliner, mascara and a deep red lipstick with gloss' });
  const out = await handleRun({ event: manual, provider: { extract: async () => big }, storage, clock: () => T0 });
  assert.ok(out.message.length <= 500, String(out.message.length));
  const o = JSON.parse(out.message);
  assert.equal(o.cut, true);
  assert.equal(o.location, 'In the kitchen.');
  assert.ok(o.outfit.endsWith('…'));
  const stored = await new ReadingStore(storage).get('k-isa');
  assert.ok(stored.outfit.length > o.outfit.length && !stored.outfit.endsWith('…'), 'the stored copy is whole');
  assert.ok(stored.outfit.startsWith(o.outfit.slice(0, -1).replace(/[,\s]+$/, '')));
});

test('packReading always fits, whatever is long', () => {
  for (const n of [0, 10, 40, 200]) {
    const long = (w) => `${w} ${'x'.repeat(n)} `.repeat(Math.max(1, n / 4)).trim();
    const p = packReading({ location: 'At the hospital.', doing: 'Sitting, waiting.', outfit: `Wearing ${long('piece')}.`, hair: `${long('hair')}.`, makeup: `${long('lip')}.` }, { at: T0.toISOString() });
    assert.ok(p.length <= 500, `${n}: ${p.length}`);
    const o = JSON.parse(p);
    assert.equal(o.location, 'At the hospital.');
    assert.equal(o.at, T0.toISOString());
  }
});

// ---------------------------------------------------------------- history and diagnostics
test('a manual reading adds to the history and to the diagnostics log; nothing of the answer text is kept', async () => {
  const storage = new MemoryStorage();
  await handleRun({ event: manual, provider: { extract: async () => ANSWER }, storage, clock: () => T0 });
  const j = await new JournalStore(storage).get('k-isa');
  assert.equal(j.history.length, 1);
  assert.deepEqual(j.history[0], { at: T0.toISOString(), source: 'manual', location: 'In the kitchen.', doing: 'Standing, cooking.', outfit: 'Wearing a shirt.', hair: 'A messy bun.', makeup: 'Red lipstick.' });
  assert.equal(j.log.length, 1);
  assert.deepEqual({ ...j.log[0], ms: 0 }, { at: T0.toISOString(), source: 'manual', ok: true, kind: null, ms: 0, tries: 1, chars: ANSWER.length, cut: false, unchanged: false, error: null });
  assert.ok(!(await storage.get(journalKey('k-isa'))).includes('"pose"'), 'the raw answer is not stored');
});

test('a failed manual reading is logged with its kind and tries, and adds nothing to the history', async () => {
  const storage = new MemoryStorage();
  const busy = { extract: async () => { throw Object.assign(new Error('Kindroid is limiting requests right now.'), { kind: 'rate-limit', retrySoon: true }); } };
  const out = await handleRun({ event: manual, provider: busy, storage, clock: () => T0, sleep: async () => {} });
  assert.equal(out.ok, false);
  const j = await new JournalStore(storage).get('k-isa');
  assert.equal(j.history.length, 0);
  assert.deepEqual([j.log[0].ok, j.log[0].kind, j.log[0].tries], [false, 'rate-limit', 2]);
  assert.match(j.log[0].error, /limiting/);
});

test('a manual run that is already late skips the journal, so the screen gets its answer in time', async () => {
  const storage = new MemoryStorage();
  let now = T0.getTime();
  const slow = { extract: async () => { now += MANUAL_JOURNAL_DEADLINE_MS + 1000; return ANSWER; } };
  const out = await handleRun({ event: manual, provider: slow, storage, clock: () => new Date(now) });
  assert.equal(out.ok, true);
  assert.equal(await storage.get(journalKey('k-isa')), null, 'no journal written');
  assert.ok(await new ReadingStore(storage).get('k-isa'), 'the reading itself is still stored');
});

test('the journal is written to its own storage, and a journal that cannot be read is never overwritten', async () => {
  const storage = new MemoryStorage();
  const journalStorage = new MemoryStorage();
  await handleRun({ event: manual, provider: { extract: async () => ANSWER }, storage, journalStorage, clock: () => T0 });
  assert.equal(await storage.get(journalKey('k-isa')), null);
  assert.ok(await journalStorage.get(journalKey('k-isa')));
  const before = await journalStorage.get(journalKey('k-isa'));
  const flaky = { get: async () => { throw new Error('files get timed out'); }, set: async () => { throw new Error('must not write'); } };
  const out = await handleRun({ event: manual, provider: { extract: async () => ANSWER }, storage, journalStorage: flaky, clock: () => plus(1) });
  assert.equal(out.ok, true, 'a journal problem never fails the reading');
  assert.equal(await journalStorage.get(journalKey('k-isa')), before);
});

test('history and log are bounded, newest first, and tolerate corrupt files', async () => {
  let j = emptyJournal();
  for (let i = 0; i < 30; i += 1) {
    j = withHistory(j, { at: plus(i).toISOString(), source: 'auto', location: `In room ${i}.`, doing: 'd', outfit: 'o' });
    j = withLog(j, { at: plus(i).toISOString(), source: 'auto', ok: true, ms: 1000 });
  }
  assert.equal(j.history.length, HISTORY_MAX);
  assert.equal(j.log.length, LOG_MAX);
  assert.equal(j.history[0].location, 'In room 29.');
  const storage = new MemoryStorage();
  const store = new JournalStore(storage);
  for (const bad of ['not json', '[]', '{"history":"x","log":[1,null,{"at":5}]}']) {
    await storage.set(journalKey('k'), bad);
    assert.deepEqual(await store.get('k'), emptyJournal(), bad);
  }
});

// ---------------------------------------------------------------- adaptive interval
test('sameSentences ignores case, punctuation and accents, and counts any other difference as a change', () => {
  const a = { location: 'In the café.', doing: 'Sitting.', outfit: 'Wearing jeans.', hair: 'A bun.', makeup: null };
  assert.equal(sameSentences(a, { ...a, location: 'in the cafe' }), true);
  assert.equal(sameSentences(a, { ...a, outfit: 'Wearing blue jeans.' }), false);
  assert.equal(sameSentences(null, a), false);
  assert.equal(sameSentences({ ...a, location: null }, a), false, 'no earlier reading is not "the same"');
});

test('afterAttempt counts unchanged automatic checks; a change, a manual reading or a failure stops the stretch', () => {
  const s = { location: 'In A.', doing: 'D.', outfit: 'O.', hair: 'H.', makeup: 'M.' };
  let r = afterAttempt(null, { now: T0, source: 'auto', sentences: s });
  assert.equal(r.stableCount, 0);
  r = afterAttempt(r, { now: plus(15), source: 'auto', sentences: s });
  r = afterAttempt(r, { now: plus(30), source: 'auto', sentences: s });
  assert.equal(r.stableCount, 2);
  assert.equal(afterAttempt(r, { now: plus(45), source: 'auto', sentences: { ...s, outfit: 'P.' } }).stableCount, 0);
  assert.equal(afterAttempt(r, { now: plus(45), source: 'manual', sentences: s }).stableCount, 0);
  const failed = afterAttempt(r, { now: plus(45), source: 'auto', error: 'x', kind: 'network' });
  assert.equal(retryWaitMinutes(failed, 15, { adaptive: true }), 5, 'a failure uses the short retry, not the stretch');
});

test('adaptive wait doubles per unchanged check, up to 4× the interval and never past 24 hours', () => {
  const at = (n) => ({ stableCount: n, error: null, failures: 0 });
  assert.deepEqual([0, 1, 2, 3, 9].map((n) => adaptiveWaitMinutes(at(n), 15)), [15, 30, 60, 60, 60]);
  assert.equal(ADAPTIVE_MAX_FACTOR, 4);
  assert.equal(adaptiveWaitMinutes(at(5), 720), 1440);
  assert.equal(adaptiveWaitMinutes(at(5), 1440), 1440);
  assert.equal(retryWaitMinutes(at(2), 15), 15, 'off unless asked for');
  assert.equal(adaptiveLine(at(0), 15), null);
  assert.match(adaptiveLine(at(2), 15), /last 2 checks, so the next one waits about 60 minutes instead of 15/);
});

test('the beat stretches the wait while nothing changes and goes back to the interval on the first change', async () => {
  const storage = new MemoryStorage();
  const s = new Settings(storage);
  await s.load();
  await s.save({ autoUpdate: true, autoIntervalMinutes: 15, autoKins: [{ id: 'k-isa', name: 'Isa' }] });
  let answer = ANSWER;
  const asked = [];
  const provider = { extract: async () => { asked.push(1); return answer; } };
  const beat = (m) => handleRun({ event: { trigger: 'schedule' }, provider, storage, clock: () => plus(m) });
  const askedAt = [];
  for (let m = 0; m <= 240; m += 5) { const n = asked.length; await beat(m); if (asked.length > n) askedAt.push(m); if (m === 150) answer = ANSWER.replace('kitchen', 'garden'); }
  // 0 (new), 15 (same, x1), 45 (same, x2), 105 (same, cap 60), 165 (changed at 150 → back to 15), 180, 210…
  assert.deepEqual(askedAt.slice(0, 6), [0, 15, 45, 105, 165, 180]);
  const j = await new JournalStore(storage).get('k-isa');
  assert.deepEqual(j.history.map((h) => h.location).reverse(), ['In the kitchen.', 'In the garden.'], 'unchanged checks do not repeat in the history');
  assert.ok(j.log.some((l) => l.unchanged), 'but the log shows them');
});

test('with the setting off, the beat keeps the plain interval', async () => {
  const storage = new MemoryStorage();
  const s = new Settings(storage);
  await s.load();
  await s.save({ autoUpdate: true, autoIntervalMinutes: 15, autoAdaptive: false, autoKins: [{ id: 'k-isa', name: 'Isa' }] });
  const asked = [];
  const provider = { extract: async () => { asked.push(1); return ANSWER; } };
  for (let m = 0; m <= 60; m += 5) await handleRun({ event: { trigger: 'schedule' }, provider, storage, clock: () => plus(m) });
  assert.equal(asked.length, 5); // 0, 15, 30, 45, 60
  assert.deepEqual(pickDue({ now: plus(15), kins: [{ id: 'a' }], readings: { a: { attemptedAt: T0.toISOString(), stableCount: 3 } }, intervalMinutes: 15 }).length, 1);
});
