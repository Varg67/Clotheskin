// When the automatic update reads the Kin. Kindroid starts the program every 15 minutes (kin.json: a schedule
// trigger, cron "*/15 * * * *"); each start checks whether a reading is due. Everything is in seconds; only the labels
// speak in minutes and hours. Shared by the run (which decides) and the screen (which shows the next time).

export const TICK_S = 900; // the schedule trigger fires every 15 minutes
const DUE_SLACK_S = 450; // half a start: a reading due at 10:30:04 is done by the 10:30 start, and a start a few minutes late does not push the next one back
/** The ruler's stops, in seconds: from one start of the program (15 min) to every 16th (4 h). */
export const INTERVAL_STEPS = [900, 1800, 2700, 3600, 5400, 7200, 10800, 14400];
export const DEFAULT_INTERVAL_S = 1800;
export const MAX_RETRY_S = 3600; // after many errors in a row, readings slow down to at most one an hour
const ERRORS_BEFORE_SLOWING = 2; // the first error is retried at the normal interval
export const ERRORS_BEFORE_WARNING = 3;
export const MAINTENANCE_RETRY_S = 1800;

/** 900 -> "15 min", 5400 -> "1 h 30 min". */
export function formatInterval(seconds) {
  const s = snapInterval(seconds);
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** The stop nearest to a saved value (an old or hand-edited setting still lands on the ruler); nothing usable -> default. */
export function snapInterval(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return DEFAULT_INTERVAL_S;
  return INTERVAL_STEPS.reduce((best, x) => (Math.abs(x - s) < Math.abs(best - s) ? x : best));
}

/**
 * Seconds until the next try. Errors in a row double the wait (after the first one), up to an hour, never below the
 * interval. When Kindroid says it is under maintenance, the next try is at least half an hour away.
 */
export function retryDelay(intervalS, failures, kind) {
  let d = intervalS;
  if (failures >= ERRORS_BEFORE_SLOWING) d = Math.max(intervalS, Math.min(MAX_RETRY_S, intervalS * 2 ** (failures - ERRORS_BEFORE_SLOWING + 1)));
  if (kind === 'maintenance') d = Math.max(d, MAINTENANCE_RETRY_S);
  return d;
}

// Words that say Kindroid is down on purpose. A bare 502/503 is a hiccup: it is tried again, not waited out.
const MAINTENANCE = /\b(maintenance|scheduled downtime|outage)\b/i;
/** 'maintenance' when a Kindroid error says so, otherwise the kind given. A Kin's own words are never checked. */
export function errorKind(message, kind = 'server') {
  if (kind === 'answer') return 'answer';
  return MAINTENANCE.test(String(message ?? '')) ? 'maintenance' : kind;
}

/** Whether a start of the program at `now` should do what was planned for `at` (an ISO time or null: at once). */
export function isDue(at, now) {
  if (!at) return true;
  return now.getTime() >= new Date(at).getTime() - DUE_SLACK_S * 1000;
}

/** The first start of the program (a quarter hour) at which something planned for `at` is due. */
export function startDueFor(at, now) {
  const from = Math.max(now.getTime(), at ? new Date(at).getTime() - DUE_SLACK_S * 1000 : 0);
  const q = TICK_S * 1000;
  return new Date(Math.ceil(from / q) * q);
}
