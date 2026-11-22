// The program's two files in its Kindroid folder, shared by the run and the screen:
//   settings.json  written by the screen only: which Kin, Start/Pause/Stop, the interval, the person's time zone,
//                  the theme and the dream options.
//   status.json    written by the run only: per Kin, the last reading, when it last ran, errors (and when to retry),
//                  the night (hibernation) and the last dream.
// One writer per file, so the screen and a run never overwrite each other. Both are normalised on every read: a
// damaged or hand-edited file can never break the screen or the run, it only falls back to defaults.
import { snapInterval, retryDelay, errorKind, DEFAULT_INTERVAL_S, ERRORS_BEFORE_WARNING, ERROR, TICK_S } from './schedule.js';
import { safeTimeZone } from './time.js';
import { REMEMBERED, DREAM_TTL_HOURS, sentenceMark } from './sleep.js';
import { oneLine } from './text.js';
import { NOT_DESCRIBED, APP_VERSION, BARE_FACE_SENTENCE } from './constants.js';
/** @import { ErrorKind } from './schedule.js' */

/**
 * settings.json, as the screen writes it.
 * @typedef {object} Settings
 * @property {1} v
 * @property {string|null} kinId the Kin of the current roleplay: the only one read
 * @property {'running'|'paused'|'stopped'} autoState Start / Pause / Stop
 * @property {number} intervalS how often the automatic update reads, in seconds (15 min to 4 h)
 * @property {string} tz the person's IANA time zone (wake-up times are on their clock)
 * @property {string} theme
 * @property {boolean} tellDream tell the Kin its dream (kin tell), so it can remember it during the day
 * @property {boolean} reachOut and let it bring the dream up by itself (kin tell --reach-out)
 * @property {boolean} tellLook tell the Kin its outfit, hair and makeup when they change (kin tell)
 * @property {string|null} stoppedAt when Stop was last pressed (ISO time)
 *
 * The card's sentences of the last reading. Hair and makeup only when the Kin described them. A sentence the last
 * answer said nothing about is the last known one, and `seen` says when it was last said (see carryOver).
 * @typedef {{ location: string, doing: string, outfit: string, hair: string|null, makeup: string|null, at: string|null,
 *   seen: Object<string, string> }} StoredReading
 * @typedef {{ wakeAt: string, until: string }} Night  when the Kin wakes up, and from when the dream question is due
 * @typedef {{ dream: string|null, remembered: string, at: string }} StoredDream
 *
 * One Kin's entry in status.json, as the run writes it.
 * @typedef {object} Entry
 * @property {string|null} name
 * @property {StoredReading|null} reading
 * @property {string|null} lastRunAt the last time a step ran for this Kin (reading, sleep or dream question)
 * @property {string|null} retryAt after an error, or a step that did not fit in a run: when to try again
 * @property {number} failures errors in a row (they slow the next try down)
 * @property {number} serverFailures Kindroid's own errors in a row (three show the server warning)
 * @property {string|null} errorKind
 * @property {string|null} error
 * @property {string|null} note what the person is told instead of the error
 * @property {Night|null} sleep
 * @property {string|null} sleptOn the fingerprint of the "asleep" sentence of the last night
 * @property {StoredDream|null} dream
 * @property {Object<string, { mark: string, at: string }>} told what the Kin was told of its look, per field: a
 *   fingerprint and when (never the sentence)
 * @property {string|null} lookFailedAt telling the look failed: not tried again for LOOK_RETRY_HOURS
 * @property {string|null} lookError why, shown on the Current look card
 *
 * @typedef {{ v: 1, runVersion: string|null, kins: Object<string, Entry> }} Status  runVersion: the version of the run
 *   that last saved the file (APP_VERSION), or null before 0.4.0
 */

export const SETTINGS_FILE = 'settings.json';
export const STATUS_FILE = 'status.json';
/** Start / Pause / Stop of the automatic update. */
export const AUTO = Object.freeze({ RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped' });
const RUN_STATES = Object.values(AUTO);
const SAVED_ERRORS = [ERROR.SERVER, ERROR.MAINTENANCE, ERROR.ANSWER, ERROR.INPUT];
export const THEMES = { warm: 'Warm (default)', sage: 'Sage green' };
/** The program's one action (kin.json), used by the screen. One action, so one input rule. */
export const ACTION = 'update_status';
export const OPS = ['read', 'wake'];

export const DEFAULT_SETTINGS = Object.freeze({
  v: 1,
  kinId: null, // the Kin of the current roleplay: the only one read
  autoState: AUTO.STOPPED, // Start / Pause / Stop
  intervalS: DEFAULT_INTERVAL_S, // how often the automatic update reads, in seconds (15 min to 4 h)
  tz: 'UTC', // the person's IANA time zone (wake-up times are on their clock)
  theme: 'warm',
  tellDream: false, // tell the Kin its dream (kin tell), so it can remember it during the day: only if the person turns it on
  reachOut: false, // and let it bring the dream up by itself (kin tell --reach-out)
  tellLook: false, // tell the Kin its outfit, hair and makeup when they change (kin tell): only if the person turns it on
  stoppedAt: null, // when Stop was last pressed: any night, dream or slowing down from before it is forgotten
});

const parse = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { const o = JSON.parse(String(raw ?? '')); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
};
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const sentence = (v, max) => (typeof v === 'string' && v.trim() ? oneLine(v, max) : null); // cut with "…"
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const count = (v) => (Number.isInteger(v) && v > 0 ? Math.min(v, 99) : 0);

/** settings.json (text or object) -> a complete, valid settings object. */
/** @returns {Settings} */
export function normalizeSettings(raw) {
  const o = parse(raw);
  return {
    v: 1,
    kinId: str(o.kinId, 120),
    autoState: RUN_STATES.includes(o.autoState) ? o.autoState : DEFAULT_SETTINGS.autoState,
    intervalS: snapInterval(o.intervalS),
    tz: safeTimeZone(o.tz),
    theme: Object.prototype.hasOwnProperty.call(THEMES, String(o.theme)) ? o.theme : DEFAULT_SETTINGS.theme,
    tellDream: typeof o.tellDream === 'boolean' ? o.tellDream : DEFAULT_SETTINGS.tellDream,
    reachOut: typeof o.reachOut === 'boolean' ? o.reachOut : DEFAULT_SETTINGS.reachOut,
    tellLook: typeof o.tellLook === 'boolean' ? o.tellLook : DEFAULT_SETTINGS.tellLook,
    stoppedAt: iso(o.stoppedAt),
  };
}

/** The sentences of a reading, each kept until the Kin says something new about it. */
const READING_FIELDS = ['location', 'doing', 'outfit', 'hair', 'makeup'];
/** @returns {Object<string, string>} */
const seenOf = (o) => Object.fromEntries(READING_FIELDS.filter((k) => o && iso(o[k])).map((k) => [k, String(iso(o[k]))]));
/** Whether a sentence says something (not empty, not the "nothing described" sentence). */
const said = (k, v) => typeof v === 'string' && v.trim() !== '' && v !== NOT_DESCRIBED[k];

/**
 * The new reading on top of the last one: what the Kin's answer said nothing about (no outfit in the recent chat,
 * say) keeps the last known sentence, with the time it was last seen (`seen`), instead of an empty card. Only the
 * Kin saying something new about it replaces it.
 */
export function carryOver(fresh, prev, now) {
  const at = now.toISOString();
  const r = { ...fresh, at, seen: {} };
  for (const k of READING_FIELDS) {
    if (said(k, fresh[k])) r.seen[k] = at;
    else if (prev && said(k, prev[k])) { r[k] = prev[k]; r.seen[k] = (prev.seen && prev.seen[k]) || prev.at || at; }
  }
  return r;
}

const objectOr = (v) => (v && typeof v === 'object' ? v : null);

/** The last reading (the card's sentences): kept only with an outfit sentence. */
/** @returns {StoredReading|null} */
function normalizeReading(given) {
  const r = objectOr(given);
  const outfit = r && sentence(r.outfit, 600);
  if (!r || !outfit) return null;
  return {
    location: sentence(r.location, 300) || '', doing: sentence(r.doing, 300) || '', outfit,
    hair: sentence(r.hair, 200), makeup: sentence(r.makeup, 200), at: iso(r.at), seen: seenOf(r.seen),
  };
}

/** The night: when the Kin wakes up, and from when the dream question is due. Both times, or no night. */
/** @returns {Night|null} */
function normalizeSleep(given) {
  const night = objectOr(given);
  const wakeAt = night && iso(night.wakeAt);
  const until = night && iso(night.until);
  return wakeAt && until ? { wakeAt, until } : null;
}

/** The last dream: kept only with the time it was told. */
/** @returns {StoredDream|null} */
function normalizeDream(given) {
  const d = objectOr(given);
  const at = d && iso(d.at);
  if (!d || !at) return null;
  return { dream: sentence(d.dream, 300), remembered: REMEMBERED.includes(d.remembered) ? d.remembered : 'some', at };
}

/**
 * One Kin's entry in status.json, complete and valid.
 * @param {any} [e]
 * @returns {Entry}
 */
export function normalizeEntry(e = {}) {
  return {
    name: str(e.name, 120),
    reading: normalizeReading(e.reading),
    lastRunAt: iso(e.lastRunAt), // the last time a step ran for this Kin (reading, sleep or dream question)
    retryAt: iso(e.retryAt), // after an error: when to try again (kept when the ruler moves)
    failures: count(e.failures),
    serverFailures: count(e.serverFailures),
    errorKind: SAVED_ERRORS.includes(e.errorKind) ? e.errorKind : null,
    error: str(e.error, 500),
    note: str(e.note, 500),
    sleep: normalizeSleep(e.sleep),
    sleptOn: typeof e.sleptOn === 'string' && /^[0-9a-f]{8}$/.test(e.sleptOn) ? e.sleptOn : null,
    dream: normalizeDream(e.dream),
    told: toldOf(e.told),
    lookFailedAt: iso(e.lookFailedAt),
    lookError: str(e.lookError, 300),
  };
}

// ---- telling the Kin its current look (settings.tellLook)
/** How long a told look lasts in the Kin (kin tell --ttl): a look older than that is no longer true anyway. */
export const LOOK_TTL_HOURS = 12;
/** After a failed kin tell (Kindroid down, or the note refused), the look is not told again for this long. */
export const LOOK_RETRY_HOURS = 1;
const LOOK_FIELDS = ['outfit', 'hair', 'makeup'];
const LOOK_FACT_MAX = 300;
/** @returns {Object<string, { mark: string, at: string }>} */
const toldOf = (o) => Object.fromEntries(LOOK_FIELDS.filter((k) => o && o[k] && /^[0-9a-f]{8}$/.test(o[k].mark) && iso(o[k].at))
  .map((k) => [k, { mark: String(o[k].mark), at: String(iso(o[k].at)) }]));

/**
 * What to tell the Kin of its look after a reading: [{ field, key, fact, mark }]. Only what the Kin said just now
 * (`fresh`, never a sentence kept from an earlier reading: an old or wrong sentence must not become the Kin's truth),
 * and only when it changed since it was last told, or that telling is about to expire. `when` is the person's clock.
 */
export function lookFacts({ fresh, told, now, when }) {
  const out = [];
  for (const field of LOOK_FIELDS) {
    const v = fresh && fresh[field];
    if (!said(field, v)) continue;
    const mark = sentenceMark(v);
    const last = told && told[field];
    if (last && last.mark === mark && now.getTime() - Date.parse(last.at) < (LOOK_TTL_HOURS - 1) * 3600e3) continue;
    out.push({ field, key: `look-${field}`, fact: oneLine(`Your ${field} right now (${when}): ${v[0].toLowerCase()}${v.slice(1)}`, LOOK_FACT_MAX), mark });
  }
  return out;
}

/**
 * status.json (text or object) -> { v, runVersion, kins: { id: entry } }.
 * @returns {Status}
 */
export function normalizeStatus(raw) {
  const o = parse(raw);
  /** @type {Object<string, Entry>} */
  const kins = {};
  if (o.kins && typeof o.kins === 'object') {
    for (const [id, e] of Object.entries(o.kins)) if (str(id, 120)) kins[id] = normalizeEntry(e && typeof e === 'object' ? e : {});
  }
  // runVersion: the version of the run that last saved the file (APP_VERSION), or null before 0.4.0.
  return { v: 1, runVersion: str(o.runVersion, 20), kins };
}

/**
 * Stop forgets the sleep cycle and any slowing down (the last reading stays). Stop only writes settings.stoppedAt, so
 * both the run and the screen apply it the same way, at once: what a Kin's entry holds from before that moment
 * (it last ran before Stop) is set aside.
 */
export function afterStop(entry, settings) {
  if (!entry || !settings.stoppedAt || (entry.lastRunAt && entry.lastRunAt > settings.stoppedAt)) return entry;
  return { ...succeeded(entry), sleep: null, sleptOn: null, dream: null, told: {}, lookFailedAt: null, lookError: null };
}

/**
 * What status.json may still hold: a dream is kept for DREAM_TTL_HOURS (as long as the screen shows it) and never
 * past Stop. Returns { status, changed }; the run writes the file back only when something was removed, so a dream
 * is erased within one 15-minute start of expiring or of Stop.
 * @param {Status} status
 * @param {Settings} settings
 * @param {Date} now
 * @returns {{ status: Status, changed: boolean }}
 */
export function forgetOld(status, settings, now) {
  /** @type {Object<string, Entry>} */
  const kins = {};
  let changed = false;
  for (const [id, entry] of Object.entries(status.kins)) {
    let e = afterStop(entry, settings);
    if (e.dream && (!e.dream.at || now.getTime() - Date.parse(e.dream.at) >= DREAM_TTL_HOURS * 3600e3)) e = { ...e, dream: null };
    if (JSON.stringify(e) !== JSON.stringify(entry)) changed = true;
    kins[id] = e;
  }
  return { status: { ...status, kins }, changed };
}

/**
 * When the next step for a Kin is planned: the end of its night, a retry after errors, or its last run plus the
 * current interval (so moving the ruler applies at once). null: at once.
 */
export function plannedAt(entry, settings) {
  if (!entry) return null;
  if (entry.sleep) return entry.retryAt && entry.retryAt > entry.sleep.until ? entry.retryAt : entry.sleep.until;
  if (entry.retryAt) return entry.retryAt;
  if (!entry.lastRunAt) return null;
  return new Date(new Date(entry.lastRunAt).getTime() + settings.intervalS * 1000).toISOString();
}

// ---------------------------------------------------------------- what a run does to an entry (pure: no I/O)

/** A step went through: errors, notes and any slowing down are over. */
/**
 * @param {Entry} entry
 * @returns {Entry}
 */
export function succeeded(entry) {
  return { ...entry, failures: 0, serverFailures: 0, errorKind: null, error: null, note: null, retryAt: null };
}

/**
 * A step failed: errors in a row slow the next try down (retryDelay); only Kindroid errors count towards the server
 * warning, a Kin's unusable answer does not. `note` is what the person is told instead of the error, if anything.
 */
/**
 * @param {Entry} entry
 * @param {{ kind?: ErrorKind, error: string, note?: string|null, now: Date, intervalS: number }} failure
 * @returns {Entry}
 */
export function failedEntry(entry, { kind: given, error, note = null, now, intervalS }) {
  const kind = errorKind(error, given || ERROR.SERVER);
  const failures = entry.failures + 1;
  return {
    ...entry,
    failures,
    serverFailures: kind === ERROR.ANSWER ? 0 : entry.serverFailures + 1,
    errorKind: kind,
    error: oneLine(error, 300),
    note: note || null,
    retryAt: new Date(now.getTime() + retryDelay(intervalS, failures, kind) * 1000).toISOString(),
  };
}

/** The run's own time ran out before a question: nothing failed, the step waits for the next start. */
/**
 * @param {Entry} entry
 * @param {{ now: Date, note: string }} when
 * @returns {Entry}
 */
export function postponedEntry(entry, { now, note }) {
  return { ...entry, retryAt: new Date(now.getTime() + TICK_S * 1000).toISOString(), note };
}

const nightOf = (x) => JSON.stringify([x.sleep, x.sleptOn]);
const newer = (a, b) => (!a ? b : !b ? a : (a.at || '') >= (b.at || '') ? a : b);

/**
 * What to save when another run saved the same Kin while this one ran (a scheduled start and Update status at the
 * same moment). `start` is the entry this run started from, `current` what is saved now, `next` what this run would
 * save. The night goes to the run that changed it (asked the dream question, started a night); if both did, to the
 * one that started later. The newest reading and dream are kept either way. Returns { entry, concurrent, theirs }:
 * concurrent when another run did save in between, theirs when its night was kept.
 */
/**
 * @param {{ current?: Entry, start?: Entry|null, next: Entry }} entries
 * @returns {{ entry: Entry, concurrent: boolean, theirs: boolean }}
 */
export function mergeConcurrent({ current, start, next }) {
  if (!current || !start || current.lastRunAt === start.lastRunAt) return { entry: next, concurrent: false, theirs: false };
  const theyChanged = nightOf(current) !== nightOf(start);
  const weChanged = nightOf(next) !== nightOf(start);
  const theirs = theyChanged && (!weChanged || (current.lastRunAt || '') >= (next.lastRunAt || ''));
  const night = theirs ? { sleep: current.sleep, sleptOn: current.sleptOn } : {};
  const entry = { ...next, ...night, dream: newer(next.dream, current.dream), reading: newer(next.reading, current.reading) };
  return { entry, concurrent: true, theirs };
}

/**
 * A stored reading as one text: "In the kitchen. Standing, making coffee. Wearing a grey hoodie." ('' for none). A bare
 * face is kept but not said.
 */
export function readingText(reading) {
  if (!reading) return '';
  return [reading.location, reading.doing, reading.outfit, reading.hair, shownMakeup(reading.makeup)].filter(Boolean).join(' ');
}

/** The makeup sentence to show, or null: none known, or a bare face (kept, not shown). */
export const shownMakeup = (makeup) => (makeup && makeup !== BARE_FACE_SENTENCE ? makeup : null);

/** The run's version when it differs from the screen's (some files were updated and others not), or null. */
export function versionMismatch(status) {
  return status.runVersion && status.runVersion !== APP_VERSION ? status.runVersion : null;
}

/** A warning about Kindroid itself for a Kin's entry, or null. */
export function warningOf(entry) {
  if (!entry) return null;
  if (entry.errorKind === ERROR.MAINTENANCE) return { kind: ERROR.MAINTENANCE };
  if (entry.errorKind !== ERROR.SERVER || entry.serverFailures < ERRORS_BEFORE_WARNING) return null;
  return { kind: ERROR.SERVER, failures: entry.serverFailures };
}

