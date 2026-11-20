// All user-visible dates are English, in the user's own time zone, regardless of browser locale.
const LOCALE = 'en-US';

export function userTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** The calendar day of a moment in a time zone, as [year, month, day]. */
function calendarDay(x, timeZone) {
  const parts = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(x);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return [get('year'), get('month'), get('day')];
}
const sameDay = (a, b) => a.every((v, i) => v === b[i]);

export function formatClock(iso, { timeZone = userTimeZone(), now = new Date() } = {}) {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone }).format(d);
  if (sameDay(calendarDay(d, timeZone), calendarDay(now, timeZone))) return time;
  const date = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone }).format(d);
  return `${date}, ${time}`;
}

export function formatRelative(iso, now = new Date()) {
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/**
 * Like formatClock, but a time tomorrow reads "7:30 AM tomorrow" (wake-up times are usually the next morning).
 * "Tomorrow" is the next calendar day in the time zone, so a night with a daylight-saving change is right too.
 */
export function formatWhen(iso, { timeZone = userTimeZone(), now = new Date() } = {}) {
  const [y, m, d] = calendarDay(now, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const tomorrow = [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()];
  if (sameDay(calendarDay(new Date(iso), timeZone), tomorrow)) return `${formatClock(iso, { timeZone, now: new Date(iso) })} tomorrow`;
  return formatClock(iso, { timeZone, now });
}
