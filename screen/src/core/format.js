// All user-visible dates are English, in the user's own time zone, regardless of browser locale.
const LOCALE = 'en-US';

let zone;
export function userTimeZone() {
  if (zone) return zone;
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { zone = 'UTC'; }
  return zone;
}

// Creating an Intl formatter costs ~0.07 ms; the screen formats dozens of times per render (history, diagnostics).
// Formatters are made once per time zone and kind, then reused (~0.001 ms per call).
const cache = new Map();
const fmt = (kind, timeZone, options) => {
  const key = `${kind}|${timeZone}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(LOCALE, { ...options, timeZone }));
  return cache.get(key);
};
let rtf;

const valid = (iso) => typeof iso === 'string' && Number.isFinite(Date.parse(iso));

/** A broken date (corrupt file) shows as "unknown time": the screen never crashes on it. */
export function formatClock(iso, { timeZone = userTimeZone(), now = new Date() } = {}) {
  if (!valid(iso)) return 'unknown time';
  const d = new Date(iso);
  const time = fmt('time', timeZone, { hour: 'numeric', minute: '2-digit' }).format(d);
  const dayKey = (x) => fmt('day', timeZone, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(x);
  if (dayKey(d) === dayKey(now)) return time;
  const date = fmt('date', timeZone, { month: 'short', day: 'numeric' }).format(d);
  return `${date}, ${time}`;
}

export function formatRelative(iso, now = new Date()) {
  if (!valid(iso)) return 'at an unknown time';
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  rtf ??= new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
