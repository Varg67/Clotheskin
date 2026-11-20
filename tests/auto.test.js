import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInterval, effectiveMinutes, isDue, pickDue, SCHEDULE_TICK_MINUTES, AUTO_MIN_MINUTES, AUTO_MAX_MINUTES, AUTO_DEFAULT_MINUTES, AUTO_MAX_KINS_PER_RUN } from '../screen/src/core/auto.js';
import { ReadingStore, afterAttempt, readingKey } from '../screen/src/core/readings.js';
import { MemoryStorage, Settings, DEFAULT_SETTINGS } from '../screen/src/core/store.js';
import { buildManifest } from '../scripts/build-manifest.mjs';

const T0 = new Date('2026-11-19T12:00:00Z');
const plus = (min) => new Date(T0.getTime() + min * 60000);

test('the interval is a whole number of minutes within 5 minutes and 24 hours; garbage gives the default', () => {
  assert.equal(normalizeInterval(15), 15);
  assert.equal(normalizeInterval('30'), 30);
  assert.equal(normalizeInterval(7.6), 8);
  assert.equal(normalizeInterval(1), AUTO_MIN_MINUTES);
  assert.equal(normalizeInterval(0), AUTO_MIN_MINUTES);
  assert.equal(normalizeInterval(-20), AUTO_MIN_MINUTES);
  assert.equal(normalizeInterval(999999), AUTO_MAX_MINUTES);
  for (const bad of ['', 'abc', null, undefined, NaN, Infinity, {}, []]) assert.equal(normalizeInterval(bad), AUTO_DEFAULT_MINUTES, String(bad));
});

test('the effective interval rounds up to the schedule beat, which is what really happens', () => {
  assert.equal(SCHEDULE_TICK_MINUTES, 5);
  assert.equal(effectiveMinutes(5), 5);
  assert.equal(effectiveMinutes(7), 10);
  assert.equal(effectiveMinutes(15), 15);
  assert.equal(effectiveMinutes(16), 20);
  assert.equal(effectiveMinutes(1440), 1440);
});

test('due: never asked is due; after the interval is due; before it is not; schedule jitter is tolerated', () => {
  assert.equal(isDue({ now: T0, attemptedAt: null, intervalMinutes: 15 }), true);
  assert.equal(isDue({ now: T0, attemptedAt: undefined, intervalMinutes: 15 }), true);
  const last = T0.toISOString();
  assert.equal(isDue({ now: plus(5), attemptedAt: last, intervalMinutes: 15 }), false);
  assert.equal(isDue({ now: plus(13.9), attemptedAt: last, intervalMinutes: 15 }), false);
  assert.equal(isDue({ now: plus(14.05), attemptedAt: last, intervalMinutes: 15 }), true, 'a beat that arrives a minute early still counts');
  assert.equal(isDue({ now: plus(15), attemptedAt: last, intervalMinutes: 15 }), true);
  assert.equal(isDue({ now: plus(4.1), attemptedAt: last, intervalMinutes: 5 }), true, 'a 5 minute interval does not skip every other beat');
  assert.equal(isDue({ now: plus(1440), attemptedAt: last, intervalMinutes: 1440 }), true);
});

test('due: unreadable or future timestamps cannot silence a Kin forever', () => {
  assert.equal(isDue({ now: T0, attemptedAt: 'not a date', intervalMinutes: 15 }), true);
  assert.equal(isDue({ now: T0, attemptedAt: plus(3).toISOString(), intervalMinutes: 15 }), false, 'slight clock skew: wait');
  assert.equal(isDue({ now: T0, attemptedAt: plus(60 * 24 * 30).toISOString(), intervalMinutes: 15 }), true, 'absurdly far in the future: ask');
});

test('pickDue: only valid, unique, due Kins; longest-waiting first; at most the per-run cap', () => {
  const kins = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'a', name: 'dup' }, { id: '', name: 'x' }, null, { name: 'no id' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }, { id: 'e' }];
  const readings = {
    a: { attemptedAt: plus(-30).toISOString() }, // waited 30
    b: { attemptedAt: plus(-5).toISOString() },  // not due at 15
    c: { attemptedAt: plus(-60).toISOString() }, // waited 60
    d: null,                                     // never
  };
  const picked = pickDue({ now: T0, kins, readings, intervalMinutes: 15 });
  assert.deepEqual(picked.map((k) => k.id), ['d', 'e', 'c'], 'never-asked first (d and e), then the longest wait, capped at three');
  assert.equal(AUTO_MAX_KINS_PER_RUN, 3);
  assert.deepEqual(pickDue({ now: T0, kins: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], readings: {}, intervalMinutes: 15, max: 1 }).length, 1);
  assert.deepEqual(pickDue({ now: T0, kins: 'nope', readings: {}, intervalMinutes: 15 }), []);
  assert.equal(pickDue({ now: T0, kins: [{ id: 'e' }], readings: {}, intervalMinutes: 15 })[0].name, 'e', 'a missing name falls back to the id');
});

test('a stored reading keeps only sentences and times; a failure keeps the last good sentences', async () => {
  const store = new ReadingStore(new MemoryStorage());
  assert.equal(await store.get('k'), null);
  const good = afterAttempt(null, { now: T0, source: 'auto', sentences: { location: 'In the kitchen.', doing: 'Standing.', outfit: 'Wearing jeans.' } });
  await store.put('k', good);
  const got = await store.get('k');
  assert.deepEqual(got, { at: T0.toISOString(), attemptedAt: T0.toISOString(), source: 'auto', location: 'In the kitchen.', doing: 'Standing.', outfit: 'Wearing jeans.', hair: null, makeup: null, error: null, failures: 0, errorKind: null, stableCount: 0 });
  assert.deepEqual(Object.keys(got).sort(), ['at', 'attemptedAt', 'doing', 'error', 'errorKind', 'failures', 'hair', 'location', 'makeup', 'outfit', 'source', 'stableCount']);
  const failed = afterAttempt(got, { now: plus(15), source: 'auto', error: 'The Kin could not be asked', kind: 'unavailable' });
  assert.deepEqual([failed.failures, failed.errorKind], [1, 'unavailable']);
  assert.equal(failed.location, 'In the kitchen.');
  assert.equal(failed.at, T0.toISOString(), 'the time of the last GOOD reading is kept');
  assert.equal(failed.attemptedAt, plus(15).toISOString());
  assert.match(failed.error, /could not be asked/);
  const firstFail = afterAttempt(null, { now: T0, source: 'auto', error: 'boom' });
  assert.deepEqual([firstFail.at, firstFail.location], [null, null]);
});

test('reading storage is per Kin id, tolerant of corrupt data, and bounded', async () => {
  const storage = new MemoryStorage();
  const store = new ReadingStore(storage);
  await store.put('alex-1', { at: T0.toISOString(), source: 'manual', location: 'In A.', doing: 'a', outfit: 'o' });
  assert.equal(await store.get('alex-2'), null);
  await storage.set(readingKey('bad'), '{ not json');
  assert.equal(await store.get('bad'), null);
  await storage.set(readingKey('weird'), JSON.stringify({ location: 5, outfit: { x: 1 }, source: 'hacked', error: 'x'.repeat(5000) }));
  const w = await store.get('weird');
  assert.deepEqual([w.location, w.outfit, w.source], [null, null, 'manual']);
  assert.ok(w.error.length <= 600);
});

test('the schedule settings are part of the saved preferences, with safe defaults (off)', async () => {
  assert.equal(DEFAULT_SETTINGS.autoUpdate, false);
  assert.equal(DEFAULT_SETTINGS.autoIntervalMinutes, 15);
  assert.deepEqual(DEFAULT_SETTINGS.autoKins, []);
  const storage = new MemoryStorage();
  const a = new Settings(storage);
  await a.load();
  await a.save({ autoUpdate: true, autoIntervalMinutes: 30, autoKins: [{ id: 'k1', name: 'Isa' }] });
  const b = new Settings(storage);
  await b.load();
  assert.deepEqual([b.value.autoUpdate, b.value.autoIntervalMinutes, b.value.autoKins], [true, 30, [{ id: 'k1', name: 'Isa' }]]);
});

test('the manifest wakes the app on one fixed beat and gives the run enough time for the per-run cap', () => {
  const m = buildManifest();
  assert.deepEqual(m.triggers, [{ on: 'schedule', cron: `*/${SCHEDULE_TICK_MINUTES} * * * *`, tz: 'user' }]);
  assert.equal(m.run.timeout, '4m');
  assert.ok(m.purpose.length <= 200);
});
