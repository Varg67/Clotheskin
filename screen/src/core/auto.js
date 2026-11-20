// Automatic readings: the interval ruler, slowing down after errors, and the sleep cycle (ask when the Kin will wake
// up, hibernate, then ask about the dream). Everything is in seconds; only the labels speak in minutes and hours.
import { cleanString } from './text.js';
import { parseJsonObject } from './json.js';

/** The ruler's stops, in seconds. 0 is "off". Shown to the person as minutes and hours. */
export const INTERVAL_STEPS = [0, 60, 120, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200];
export const WAKE_LEAD_S = 600; // the dream question is asked this long before the wake-up time
export const MIN_SLEEP_S = 15 * 60; // waking up sooner than this: no hibernation, the readings just go on
export const MAX_SLEEP_S = 14 * 3600; // a wake-up time further away than this is not believed (an old chat, a typo)
export const MAX_RETRY_S = 3600; // after many errors in a row, readings slow down to at most one an hour
export const ERRORS_BEFORE_SLOWING = 2; // the first error is retried at the normal interval
export const ERRORS_BEFORE_WARNING = 3;
export const MAINTENANCE_RETRY_S = 1800;

/** 0 -> "Off", 60 -> "1 min", 5400 -> "1 h 30 min". */
export function formatInterval(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0) return 'Off';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** The stop nearest to a saved value (an old or hand-edited setting still lands on the ruler). */
export function snapInterval(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return INTERVAL_STEPS.slice(1).reduce((best, x) => (Math.abs(x - s) < Math.abs(best - s) ? x : best)); // on is at least a minute
}

/**
 * Seconds until the next try. Errors in a row double the wait (after the first one), up to an hour.
 * When Kindroid says it is under maintenance, the next try is at least half an hour away.
 */
export function retryDelay(intervalS, failures, kind) {
  let d = intervalS;
  if (failures >= ERRORS_BEFORE_SLOWING) d = Math.max(intervalS, Math.min(MAX_RETRY_S, intervalS * 2 ** (failures - ERRORS_BEFORE_SLOWING + 1)));
  if (kind === 'maintenance') d = Math.max(d, MAINTENANCE_RETRY_S);
  return d;
}

const MAINTENANCE = /\b(maintenance|scheduled downtime|service unavailable|temporarily unavailable|outage|503|502)\b/i;
/** 'maintenance' when the error text says so, otherwise the kind given (server / answer). */
export function errorKind(message, kind = 'server') {
  return MAINTENANCE.test(String(message ?? '')) ? 'maintenance' : kind;
}

// ---- sleep
const ASLEEP = /\b(sleeping|asleep|napping|dozing|slumbering|snoozing)\b/i;
const NOT_ASLEEP = /\b(not|never|no longer|unable to|can['’]?t|cannot|trying to|about to|going to|half)\s+(be\s+|fall\s+|get\s+)?(sleeping|asleep|napping|dozing)\b|\bawake\b/i;
/** Whether the pose and action sentence says the Kin is asleep ("Lying in bed, sleeping."). */
export function looksAsleep(doing) {
  const s = String(doing ?? '');
  return ASLEEP.test(s) && !NOT_ASLEEP.test(s);
}

/** "07:30", "7:30", "7.30", "7h30", "7 am", "7:30 PM", "19:00" -> { h, m }; anything else -> null. */
export function parseClockTime(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = s.match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const ampm = m[3]?.[0];
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  } else if (m[2] === undefined || h > 23) return null; // a bare "7" is not a time
  return { h, m: min };
}

/** The next moment, after `now`, when the local clock shows h:m. */
export function nextOccurrence({ h, m }, now) {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * From the Kin's wake-up time to a plan: { wakeAt, until } (until = when the dream question is asked), or null when
 * there is nothing to wait for (waking up within MIN_SLEEP_S) or the time is not believable (beyond MAX_SLEEP_S).
 */
export function planSleep(wakeText, now) {
  const t = parseClockTime(wakeText);
  if (!t) return null;
  const wakeAt = nextOccurrence(t, now);
  const s = (wakeAt - now) / 1000;
  if (s < MIN_SLEEP_S || s > MAX_SLEEP_S) return null;
  return { wakeAt, until: new Date(wakeAt.getTime() - WAKE_LEAD_S * 1000) };
}

/** "It is now 23:10 on Friday" for the Kin: its own clock is not necessarily the person's. */
export function describeNow(now) {
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  return `${time} on ${day}`;
}

const truthy = (v) => v === true || /^(true|yes|y|asleep|sleeping)$/i.test(String(v).trim());
const falsy = (v) => v === false || /^(false|no|n|awake|not sleeping)$/i.test(String(v).trim());

/**
 * The answer to the sleep question: {"sleeping":true,"wake_at":"07:30"} or {"sleeping":false}.
 * Returns { ok, sleeping, wakeAt } or { ok: false, error }. A sleeping Kin without a usable time is an error.
 */
export function parseSleepAnswer(text) {
  const p = parseJsonObject(text);
  if (!p.ok) return p;
  const o = p.value;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'The answer must be a JSON object.' };
  const key = Object.keys(o).find((k) => /^(sleeping|asleep|is_?sleeping)$/i.test(k));
  if (!key) return { ok: false, error: 'The answer does not say whether the Kin is asleep.' };
  if (falsy(o[key])) return { ok: true, sleeping: false, wakeAt: null };
  if (!truthy(o[key])) return { ok: false, error: '"sleeping" must be true or false.' };
  const wakeKey = Object.keys(o).find((k) => /^(wake_?at|wake_?up_?at|wake_?time|wake_?up|until)$/i.test(k));
  const t = wakeKey ? parseClockTime(o[wakeKey]) : null;
  if (!t) return { ok: false, error: 'The answer does not give a wake-up time as HH:MM.' };
  return { ok: true, sleeping: true, wakeAt: `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` };
}

export const REMEMBERED = ['all', 'most', 'some', 'little', 'nothing'];
const REMEMBERED_TEXT = { all: 'Remembers all of it.', most: 'Remembers most of it.', some: 'Remembers some of it.', little: 'Remembers little of it.', nothing: 'Remembers nothing of it.' };
const NO_DREAM = /^(none|nothing|no dream|n\/?a|unknown|-+)?$/i;

/** The answer to the dream question: {"dream":"…","remembered":"all|most|some|little|nothing"}. */
export function parseDreamAnswer(text) {
  const p = parseJsonObject(text);
  if (!p.ok) return p;
  const o = p.value;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'The answer must be a JSON object.' };
  const dream = o.dream ?? o.summary ?? '';
  if (typeof dream !== 'string') return { ok: false, error: '"dream" must be a text.' };
  const rememberedRaw = String(o.remembered ?? o.remember ?? '').trim().toLowerCase();
  const remembered = REMEMBERED.includes(rememberedRaw) ? rememberedRaw : null;
  const summary = cleanString(dream, 240).replace(/^["“]|["”]$/g, '');
  if (NO_DREAM.test(summary)) return { ok: true, dream: null, remembered: 'nothing' };
  return { ok: true, dream: summary, remembered: remembered ?? 'some' };
}

/** The dream as shown on the card: "Flying over the sea with my sister. Remembers most of it." */
export function describeDream({ dream, remembered } = {}) {
  if (!dream) return 'No dream remembered.';
  const text = /[.!?…]$/.test(dream) ? dream : `${dream}.`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${REMEMBERED_TEXT[remembered] || ''}`.trim();
}
