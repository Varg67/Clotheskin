// All user-visible dates are English, in the user's own time zone, regardless of browser locale.
import { deviceTimeZone as userTimeZone, zonedParts, dayAfter } from './time.js';

const LOCALE = 'en-US';

// Creating an Intl formatter is slow next to using one, and the screen formats several dates per render: formatters
// are made once per time zone and kind, then reused.
const cache = new Map();
const fmt = (kind, timeZone, options) => {
  const key = `${kind}|${timeZone}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(LOCALE, { ...options, timeZone }));
  return cache.get(key);
};
let rtf;

const valid = (iso) => typeof iso === 'string' && Number.isFinite(Date.parse(iso));

const sameDay = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;

/** "10:05 PM" today, "Nov 20, 10:05 PM" another day. A broken date (corrupt file) is "unknown time", never a crash. */
export function formatClock(iso, { timeZone = userTimeZone(), now = new Date() } = {}) {
  if (!valid(iso)) return 'unknown time';
  const d = new Date(iso);
  const time = fmt('time', timeZone, { hour: 'numeric', minute: '2-digit' }).format(d);
  if (sameDay(zonedParts(d, timeZone), zonedParts(now, timeZone))) return time;
  return `${fmt('date', timeZone, { month: 'short', day: 'numeric' }).format(d)}, ${time}`;
}

export function formatRelative(iso, now = new Date()) {
  if (!valid(iso)) return 'at an unknown time';
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (!rtf) rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/**
 * Like formatClock, but a time tomorrow reads "7:30 AM tomorrow" (wake-up times are usually the next morning).
 * "Tomorrow" is the next calendar day in the time zone, so a night with a daylight-saving change is right too.
 */
export function formatWhen(iso, { timeZone = userTimeZone(), now = new Date() } = {}) {
  if (!valid(iso)) return 'unknown time';
  if (sameDay(zonedParts(new Date(iso), timeZone), dayAfter(zonedParts(now, timeZone)))) return `${formatClock(iso, { timeZone, now: new Date(iso) })} tomorrow`;
  return formatClock(iso, { timeZone, now });
}
