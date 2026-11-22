// Wall-clock time in the person's time zone. The run executes in Kindroid's container, whose clock zone is not the
// person's, so every wall time (a wake-up at 07:30, "23:10 on Friday") goes through an explicit IANA zone that the
// screen saved in settings.json. Plain Intl: no dependency, and the same code runs in Node and in the screen.

const LOCALE = 'en-US';
const partFormats = new Map();

/** A valid IANA zone, or 'UTC'. */
export function safeTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return 'UTC';
  try { new Intl.DateTimeFormat(LOCALE, { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

/** The person's zone as the browser knows it (the screen saves it for the run). */
export function deviceTimeZone() {
  try { return safeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return 'UTC'; }
}

/** { y, m, d, h, min, weekday } of a moment on the wall clock of a zone. */
export function zonedParts(date, tz) {
  const zone = safeTimeZone(tz);
  let f = partFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'long' });
    partFormats.set(zone, f);
  }
  const p = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second), weekday: p.weekday };
}

/**
 * The moment when the wall clock of a zone shows y-m-d h:min. Around a daylight-saving change there are two offsets:
 * both are tried. A time shown twice (clocks go back) is its first moment; a time that is skipped (clocks go forward)
 * moves forward, in every zone (London, Berlin and Sydney as well as New York).
 */
export function zonedTime({ y, m, d, h, min }, tz) {
  const want = Date.UTC(y, m - 1, d, h, min);
  const shown = (t) => { const p = zonedParts(new Date(t), tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min); };
  const offsetAt = (t) => shown(t) - t;
  const candidates = [...new Set([offsetAt(want - 864e5 / 2), offsetAt(want + 864e5 / 2), offsetAt(want)].map((o) => want - o))];
  const exact = candidates.filter((t) => shown(t) === want);
  return new Date(exact.length ? Math.min(...exact) : Math.max(...candidates));
}

/** The next moment, after `now`, when the wall clock of the zone shows h:m. */
export function nextWallTime({ h, m }, now, tz) {
  const today = zonedParts(now, tz);
  let at = zonedTime({ y: today.y, m: today.m, d: today.d, h, min: m }, tz);
  if (at <= now) {
    const next = new Date(Date.UTC(today.y, today.m - 1, today.d + 1)); // the next calendar day, whatever its length
    at = zonedTime({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate(), h, min: m }, tz);
  }
  return at;
}

/** 7, 5 -> "07:05": a 24-hour clock time. */
export const clockText = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** "23:10 on Friday" on the person's clock, for the Kin. */
export function describeNow(now, tz) {
  const p = zonedParts(now, tz);
  return `${clockText(p.h, p.min)} on ${p.weekday}`;
}
