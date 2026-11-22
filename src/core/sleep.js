// The sleep cycle: is the Kin asleep, when does it wake up, what did it dream. Pure functions shared by the run (which
// asks) and the screen (which shows).
import { cleanString, toSentence } from './text.js';
import { parseJsonObject } from './json.js';
import { nextWallTime, clockText } from './time.js';
/** @import { Failure } from './json.js' */

export const WAKE_LEAD_S = 600; // the dream question is due this long before the wake-up time
const MIN_SLEEP_S = 15 * 60; // waking up sooner than this: no hibernation, the readings just go on
const MAX_SLEEP_S = 14 * 3600; // a wake-up time further away than this is not believed (an old chat, a typo)
export const DREAM_TTL_HOURS = 24; // the Kin is told its dream for a day (kin tell --ttl), and the screen shows it as long

const ASLEEP = /\b(sleeping|asleep|napping|dozing|slumbering|snoozing)\b(?!\s+(bag|pill|pills|mask|pad|pod|car|quarters|area|beauty)\b)/i;
const NOT_ASLEEP = /\b(not|never|no longer|unable to|can['’]?t|cannot|trying to|about to|going to|half)\s+(quite\s+|yet\s+|really\s+)?(be\s+|fall\s+|get\s+)?(sleeping|asleep|napping|dozing)\b|\bawake\b/i;
/**
 * A short fingerprint of a sentence (FNV-1a, hex). The sleep cycle remembers which "asleep" sentence it already asked
 * about without writing the sentence itself (nothing about the scene is stored).
 */
export function sentenceMark(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Whether the pose and action sentence says the Kin is asleep ("Lying in bed, sleeping."). */
export function looksAsleep(doing) {
  const s = String(doing ?? '');
  return ASLEEP.test(s) && !NOT_ASLEEP.test(s);
}

/** "07:30", "07:30:00", "0730", "7:30", "7.30", "7h30", "7 am", "7:30 PM", "19:00" -> { h, m }; anything else -> null. */
export function parseClockTime(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{4}$/.test(s)) return parseClockTime(`${s.slice(0, 2)}:${s.slice(2)}`); // "0730" (military style)
  const m = s.match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{2})(?::\d{2})?)?\s*(a\.?m\.?|p\.?m\.?)?$/);
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

/**
 * From the Kin's wake-up time (on the person's clock, zone `tz`) to a plan: { wakeAt, until } (until = when the dream question is asked), or null when
 * there is nothing to wait for (waking up within MIN_SLEEP_S) or the time is not believable (beyond MAX_SLEEP_S).
 */
export function planSleep(wakeText, now, tz) {
  const t = parseClockTime(wakeText);
  if (!t) return null;
  const wakeAt = nextWallTime(t, now, tz);
  const s = (wakeAt.getTime() - now.getTime()) / 1000;
  if (s < MIN_SLEEP_S || s > MAX_SLEEP_S) return null;
  return { wakeAt, until: new Date(wakeAt.getTime() - WAKE_LEAD_S * 1000) };
}

const truthy = (v) => v === true || /^(true|yes|y|asleep|sleeping)$/i.test(String(v).trim());
const falsy = (v) => v === false || /^(false|no|n|awake|not sleeping)$/i.test(String(v).trim());

/**
 * The answer to the sleep question: {"sleeping":true,"wake_at":"07:30"} or {"sleeping":false}.
 * Returns { ok, sleeping, wakeAt } or { ok: false, error }. A sleeping Kin without a usable time is an error.
 */
/** @returns {{ ok: true, sleeping: boolean, wakeAt: string|null } | Failure} */
export function parseSleepAnswer(text) {
  const p = parseJsonObject(text);
  if (p.ok === false) return p;
  const o = p.value;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'The answer must be a JSON object.' };
  const key = Object.keys(o).find((k) => /^(sleeping|asleep|is_?sleeping)$/i.test(k));
  if (!key) return { ok: false, error: 'The answer does not say whether the Kin is asleep.' };
  if (falsy(o[key])) return { ok: true, sleeping: false, wakeAt: null };
  if (!truthy(o[key])) return { ok: false, error: '"sleeping" must be true or false.' };
  const wakeKey = Object.keys(o).find((k) => /^(wake_?at|wake_?up_?at|wake_?time|wake_?up|until)$/i.test(k));
  const t = wakeKey ? parseClockTime(o[wakeKey]) : null;
  if (!t) return { ok: false, error: 'The answer does not give a wake-up time as HH:MM.' };
  return { ok: true, sleeping: true, wakeAt: clockText(t.h, t.m) };
}

export const REMEMBERED = ['all', 'most', 'some', 'little', 'nothing'];
const REMEMBERED_TEXT = { all: 'Remembers all of it.', most: 'Remembers most of it.', some: 'Remembers some of it.', little: 'Remembers little of it.', nothing: 'Remembers nothing of it.' };
const NO_DREAM = /^(none|nothing|no dream|n\/?a|unknown|-+)?$/i;

/** @typedef {{ ok?: true, dream: string|null, remembered: string }} Dream */

/** The answer to the dream question: {"dream":"…","remembered":"all|most|some|little|nothing"}. */
/** @returns {Dream | Failure} */
export function parseDreamAnswer(text) {
  const p = parseJsonObject(text);
  if (p.ok === false) return p;
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

/**
 * The dream as shown on the card: "Flying over the sea with my sister. Remembers most of it."
 * @param {Partial<Dream>} [d]
 */
export function describeDream({ dream, remembered } = {}) {
  if (!dream) return 'No dream remembered.';
  return `${toSentence(dream)} ${REMEMBERED_TEXT[remembered] || ''}`.trim();
}

/**
 * What the Kin is told about its dream (`kin tell --key dream`), so it can remember it in the chat during the day.
 * A plain fact, in the second person, never an instruction.
 */
/** @param {Partial<Dream>} [d] */
export function dreamFact({ dream, remembered } = {}) {
  if (!dream) return null;
  const amount = { all: 'all', most: 'most', some: 'some', little: 'a little', nothing: 'almost nothing' }[remembered] || 'some';
  const text = cleanString(dream, 240).replace(/["“”]/g, "'");
  return `While you slept, you dreamt: "${text}". Now that you are awake you remember ${amount} of it.`;
}
