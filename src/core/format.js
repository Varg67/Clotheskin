// All user-visible dates are English, in the user's own time zone, regardless of browser locale.
const LOCALE = 'en-US';

export function userTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function formatClock(iso, { timeZone = userTimeZone(), now = new Date() } = {}) {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone }).format(d);
  const dayKey = (x) => new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).format(x);
  if (dayKey(d) === dayKey(now)) return time;
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
