import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedParts, zonedTime, nextWallTime, describeNow, safeTimeZone } from '../src/core/time.js';
import { INTERVAL_STEPS, formatInterval, snapInterval, retryDelay, errorKind, isDue, startDueFor, MAX_RETRY_S, MAINTENANCE_RETRY_S } from '../src/core/schedule.js';
import { normalizeSettings, normalizeStatus, normalizeEntry, warningOf, DEFAULT_SETTINGS } from '../src/core/state.js';
import { planSleep, dreamFact, WAKE_LEAD_S } from '../src/core/sleep.js';

test('time zones: wall clock parts, wall time to moment, the next 07:30, also on daylight-saving nights', () => {
  const sp = 'America/Sao_Paulo';
  assert.deepEqual(zonedParts(new Date('2026-11-21T02:10:00Z'), sp), { y: 2026, m: 11, d: 20, h: 23, min: 10, s: 0, weekday: 'Friday' });
  assert.equal(zonedTime({ y: 2026, m: 11, d: 21, h: 7, min: 30 }, sp).toISOString(), '2026-11-21T10:30:00.000Z');
  assert.equal(nextWallTime({ h: 7, m: 30 }, new Date('2026-11-21T02:10:00Z'), sp).toISOString(), '2026-11-21T10:30:00.000Z');
  assert.equal(nextWallTime({ h: 23, m: 30 }, new Date('2026-11-21T02:10:00Z'), sp).toISOString(), '2026-11-21T02:30:00.000Z', 'later the same evening');
  const ny = 'America/New_York';
  // the night the clocks go back (Nov 1 2026): 07:30 EST is 12:30 UTC, not 11:30
  assert.equal(nextWallTime({ h: 7, m: 30 }, new Date('2026-11-01T03:00:00Z'), ny).toISOString(), '2026-11-01T12:30:00.000Z');
  // the night the clocks go forward (Mar 8 2026): 07:30 EDT is 11:30 UTC
  assert.equal(nextWallTime({ h: 7, m: 30 }, new Date('2026-03-08T04:00:00Z'), ny).toISOString(), '2026-03-08T11:30:00.000Z');
  // a time that does not exist (02:30 on Mar 8 in New York) moves forward, never back
  assert.ok(zonedTime({ y: 2026, m: 3, d: 8, h: 2, min: 30 }, ny) > new Date('2026-03-08T06:59:00Z'));
  assert.equal(describeNow(new Date('2026-11-21T02:10:00Z'), sp), '23:10 on Friday');
  assert.equal(safeTimeZone('Mars/Olympus'), 'UTC');
  assert.equal(safeTimeZone(undefined), 'UTC');
});

test('sleep plans are made on the person\'s clock, not the container\'s', () => {
  const now = new Date('2026-11-21T02:10:00Z'); // 23:10 in São Paulo, 02:10 UTC
  const plan = planSleep('07:30', now, 'America/Sao_Paulo');
  assert.equal(plan.wakeAt.toISOString(), '2026-11-21T10:30:00.000Z');
  assert.equal(plan.until.getTime(), plan.wakeAt.getTime() - WAKE_LEAD_S * 1000);
  assert.equal(planSleep('07:30', now, 'UTC').wakeAt.toISOString(), '2026-11-21T07:30:00.000Z', 'the zone matters');
  assert.equal(planSleep('23:20', now, 'America/Sao_Paulo'), null, '10 minutes away: nothing to wait for');
});

test('the ruler: 15 min to 4 h, seconds inside, minutes and hours on the label', () => {
  assert.deepEqual(INTERVAL_STEPS.map(formatInterval), ['15 min', '30 min', '45 min', '1 h', '1 h 30 min', '2 h', '3 h', '4 h']);
  assert.equal(snapInterval(60), 900, 'nothing below the program\'s 15-minute start');
  assert.equal(snapInterval('x'), 1800);
  assert.equal(snapInterval(99999), 14400);
});

test('slowing down after errors, and maintenance; a Kin\'s words are never Kindroid maintenance', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => retryDelay(900, n)), [900, 900, 1800, 3600, 3600]);
  assert.equal(retryDelay(14400, 9), 14400, 'never shorter than the interval');
  assert.equal(retryDelay(900, 1, 'maintenance'), MAINTENANCE_RETRY_S);
  assert.equal(MAX_RETRY_S, 3600);
  assert.equal(errorKind('kin ask failed: 503 Service Unavailable'), 'maintenance');
  assert.equal(errorKind('under maintenance', 'answer'), 'answer');
});

test('due: a reading planned for 10:30:04 is done by the 10:30 start; the screen knows which start that is', () => {
  const at = '2026-11-20T13:30:04Z';
  assert.equal(isDue(null, new Date()), true);
  assert.equal(isDue(at, new Date('2026-11-20T13:30:00Z')), true);
  assert.equal(isDue(at, new Date('2026-11-20T13:15:00Z')), false);
  assert.equal(startDueFor(at, new Date('2026-11-20T13:02:00Z')).toISOString(), '2026-11-20T13:30:00.000Z');
  assert.equal(startDueFor(null, new Date('2026-11-20T13:02:00Z')).toISOString(), '2026-11-20T13:15:00.000Z');
  assert.equal(startDueFor('2026-11-20T10:00:00Z', new Date('2026-11-20T13:02:00Z')).toISOString(), '2026-11-20T13:15:00.000Z', 'overdue: the next start');
});

test('settings and status files: anything damaged falls back to defaults, nothing throws', () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings('not json'), { ...DEFAULT_SETTINGS });
  const s = normalizeSettings({ kinId: ' k1 ', autoState: 'running', intervalS: 600, tz: 'Europe/Lisbon', theme: 'sage', tellDream: false, reachOut: 'yes', extra: 1 });
  assert.deepEqual(s, { v: 1, kinId: 'k1', autoState: 'running', intervalS: 900, tz: 'Europe/Lisbon', theme: 'sage', tellDream: false, reachOut: false });
  assert.deepEqual(normalizeStatus('[]'), { v: 1, kins: {} });
  const st = normalizeStatus({ kins: { k1: { reading: { outfit: 'Wearing jeans.', location: 5, at: 'nope' }, sleep: { wakeAt: 'x' }, sleptOn: 'Lying in bed, sleeping.', failures: -3, errorKind: 'weird' } } });
  assert.deepEqual(st.kins.k1.reading, { location: '', doing: '', outfit: 'Wearing jeans.', at: null });
  assert.equal(st.kins.k1.sleep, null);
  assert.equal(st.kins.k1.sleptOn, null, 'only a fingerprint is accepted, never a sentence');
  assert.equal(st.kins.k1.failures, 0);
  assert.equal(st.kins.k1.errorKind, null);
  assert.deepEqual(normalizeEntry(), normalizeEntry({}));
});

test('the warning: maintenance at once, server errors from the third in a row', () => {
  assert.equal(warningOf(null), null);
  assert.deepEqual(warningOf({ errorKind: 'maintenance', serverFailures: 1 }), { kind: 'maintenance' });
  assert.equal(warningOf({ errorKind: 'server', serverFailures: 2 }), null);
  assert.deepEqual(warningOf({ errorKind: 'server', serverFailures: 3 }), { kind: 'server', failures: 3 });
  assert.equal(warningOf({ errorKind: 'answer', serverFailures: 5 }), null);
});

test('the dream fact told to the Kin: plain, second person, no quotes that could break it', () => {
  assert.equal(dreamFact({ dream: 'I was flying over "the" sea', remembered: 'most' }), 'While you slept, you dreamt: "I was flying over \'the\' sea". Now that you are awake you remember most of it.');
  assert.equal(dreamFact({ dream: null, remembered: 'nothing' }), null);
});
