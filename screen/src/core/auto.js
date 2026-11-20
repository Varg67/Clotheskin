import { PERMANENT_KINDS } from './errors.js';

// Automatic updates. The Workshop can only fire a schedule at a fixed beat (kin.json is not editable at run time),
// so the program is woken every SCHEDULE_TICK_MINUTES and each run decides who is due, from the interval the person set.
export const SCHEDULE_TICK_MINUTES = 5;
export const AUTO_MIN_MINUTES = 5;
export const AUTO_MAX_MINUTES = 1440; // 24 hours
export const AUTO_DEFAULT_MINUTES = 15;
export const AUTO_MAX_KINS_PER_RUN = 3; // each reading is one question to a Kin; a run has a time limit
const TOLERANCE_MS = 60 * 1000; // schedule jitter: a 5 minute interval must not skip every other beat

/** What the person typed, as a whole number of minutes within the allowed range. Anything else gives the default. */
export function normalizeInterval(v) {
  // null, '' and [] would all become 0 (and then 5 minutes): only a number or a non-empty text is an answer
  if (!(typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''))) return AUTO_DEFAULT_MINUTES;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return AUTO_DEFAULT_MINUTES;
  return Math.min(AUTO_MAX_MINUTES, Math.max(AUTO_MIN_MINUTES, n));
}

/**
 * How long to wait after the last attempt. Normally the interval. After failures the wait starts at one beat and
 * doubles (5, 10, 20, 40 minutes…) up to the interval, so a short outage is noticed soon without hammering the Kin.
 * A permanent failure (a missing permission) waits the whole interval: asking sooner cannot help.
 */
export function retryWaitMinutes(reading, intervalMinutes, { adaptive = false } = {}) {
  const interval = normalizeInterval(intervalMinutes);
  const failures = Math.max(0, Math.floor(Number(reading?.failures) || 0));
  if (failures && reading?.error && !PERMANENT_KINDS.has(reading.errorKind)) return Math.min(interval, SCHEDULE_TICK_MINUTES * 2 ** Math.min(failures - 1, 12));
  return adaptive ? adaptiveWaitMinutes(reading, interval) : interval;
}

// Adaptive interval: a scene that has not changed for a while is checked less often. Each check that finds the same
// sentences doubles the wait, up to ADAPTIVE_MAX_FACTOR times the interval (never more than 24 hours). The first
// change, a failure, or a manual reading goes back to the interval the person set.
export const ADAPTIVE_MAX_FACTOR = 4;

export function adaptiveWaitMinutes(reading, intervalMinutes) {
  const interval = normalizeInterval(intervalMinutes);
  const stable = Math.max(0, Math.floor(Number(reading?.stableCount) || 0));
  if (!stable || reading?.error) return interval;
  const cap = Math.max(interval, Math.min(AUTO_MAX_MINUTES, interval * ADAPTIVE_MAX_FACTOR));
  return Math.min(cap, interval * 2 ** Math.min(stable, 10));
}

/** What really happens: checks only happen on the schedule beat, so the interval rounds up to a multiple of it. */
export function effectiveMinutes(v) {
  return Math.ceil(normalizeInterval(v) / SCHEDULE_TICK_MINUTES) * SCHEDULE_TICK_MINUTES;
}

const ms = (t) => { const x = Date.parse(t); return Number.isFinite(x) ? x : null; };

/**
 * Is this Kin due? Failed attempts count (attemptedAt), so a failing Kin is not hammered on every beat.
 * A timestamp in the future (clock skew, corrupted file) is treated as due, so a bad value cannot silence a Kin forever.
 */
export function isDue({ now, attemptedAt, intervalMinutes }) {
  const last = ms(attemptedAt);
  if (last === null) return true;
  const elapsed = now.getTime() - last;
  if (elapsed < 0) return elapsed < -intervalMinutes * 60000;
  return elapsed >= normalizeInterval(intervalMinutes) * 60000 - TOLERANCE_MS;
}

/** The Kins to ask now: valid, unique, due, the longest-waiting first, at most `max`. */
export function pickDue({ now, kins, readings, intervalMinutes, max = AUTO_MAX_KINS_PER_RUN, adaptive = false }) {
  const seen = new Set();
  const due = [];
  for (const k of Array.isArray(kins) ? kins : []) {
    if (!k || typeof k.id !== 'string' || !k.id || seen.has(k.id)) continue;
    seen.add(k.id);
    const attemptedAt = readings?.[k.id]?.attemptedAt ?? null;
    if (isDue({ now, attemptedAt, intervalMinutes: retryWaitMinutes(readings?.[k.id], intervalMinutes, { adaptive }) })) due.push({ kin: { id: k.id, name: String(k.name || k.id) }, waited: ms(attemptedAt) ?? 0 });
  }
  return due.sort((a, b) => a.waited - b.waited).slice(0, max).map((d) => d.kin);
}

/**
 * What the card says under an automatic failure: the reason, how many in a row, and what happens next. One line each.
 * No clocks are compared: the screen and the run may disagree about the time.
 */
export function autoFailureLines(stored, intervalMinutes) {
  const wait = retryWaitMinutes(stored, intervalMinutes);
  const lines = [`The last automatic check failed: ${stored.error}`];
  if (stored.failures > 1) lines.push(`${stored.failures} checks in a row have failed.`);
  lines.push(PERMANENT_KINDS.has(stored.errorKind)
    ? 'Retrying sooner will not help: fix the cause, then press Try again.'
    : `Trying again about ${wait} minutes after the last attempt.`);
  return lines;
}

/** The line under the automatic settings when the adaptive interval is stretching the wait; null when it is not. */
export function adaptiveLine(stored, intervalMinutes) {
  const interval = normalizeInterval(intervalMinutes);
  const wait = adaptiveWaitMinutes(stored, interval);
  if (wait <= interval) return null;
  const n = stored.stableCount;
  return `Nothing changed in the last ${n === 1 ? 'check' : `${n} checks`}, so the next one waits about ${effectiveMinutes(wait)} minutes instead of ${effectiveMinutes(interval)}.`;
}
