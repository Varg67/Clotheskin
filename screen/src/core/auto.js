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
export function pickDue({ now, kins, readings, intervalMinutes, max = AUTO_MAX_KINS_PER_RUN }) {
  const seen = new Set();
  const due = [];
  for (const k of Array.isArray(kins) ? kins : []) {
    if (!k || typeof k.id !== 'string' || !k.id || seen.has(k.id)) continue;
    seen.add(k.id);
    const attemptedAt = readings?.[k.id]?.attemptedAt ?? null;
    if (isDue({ now, attemptedAt, intervalMinutes })) due.push({ kin: { id: k.id, name: String(k.name || k.id) }, waited: ms(attemptedAt) ?? 0 });
  }
  return due.sort((a, b) => a.waited - b.waited).slice(0, max).map((d) => d.kin);
}
