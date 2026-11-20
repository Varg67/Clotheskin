// The program's two files in its Kindroid folder, shared by the run and the screen:
//   settings.json  written by the screen only: which Kin, Start/Pause/Stop, the interval, the person's time zone,
//                  the theme and the dream options.
//   status.json    written by the run only: per Kin, the last reading, when it last ran, errors (and when to retry),
//                  the night (hibernation) and the last dream.
// One writer per file, so the screen and a run never overwrite each other. Both are normalised on every read: a
// damaged or hand-edited file can never break the screen or the run, it only falls back to defaults.
import { snapInterval, DEFAULT_INTERVAL_S, ERRORS_BEFORE_WARNING } from './schedule.js';
import { safeTimeZone } from './time.js';
import { REMEMBERED } from './sleep.js';
import { oneLine } from './text.js';

export const SETTINGS_FILE = 'settings.json';
export const STATUS_FILE = 'status.json';
export const RUN_STATES = ['running', 'paused', 'stopped'];
export const THEMES = { warm: 'Warm (default)', sage: 'Sage green' };
/** The program's one action (kin.json), used by the screen. One action, so one input rule. */
export const ACTION = 'update_status';
export const OPS = ['read', 'wake'];

export const DEFAULT_SETTINGS = Object.freeze({
  v: 1,
  kinId: null, // the Kin of the current roleplay: the only one read
  autoState: 'stopped', // Start / Pause / Stop
  intervalS: DEFAULT_INTERVAL_S, // how often the automatic update reads, in seconds (15 min to 4 h)
  tz: 'UTC', // the person's IANA time zone (wake-up times are on their clock)
  theme: 'warm',
  tellDream: true, // tell the Kin its dream (kin tell), so it can remember it during the day
  reachOut: false, // and let it bring the dream up by itself (kin tell --reach-out)
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
    stoppedAt: iso(o.stoppedAt),
  };
}

/** One Kin's entry in status.json, complete and valid. */
export function normalizeEntry(e = {}) {
  const r = e.reading && typeof e.reading === 'object' ? e.reading : null;
  const reading = r && sentence(r.outfit, 600) ? { location: sentence(r.location, 300) || '', doing: sentence(r.doing, 300) || '', outfit: sentence(r.outfit, 600), at: iso(r.at) } : null;
  const s = e.sleep && typeof e.sleep === 'object' ? e.sleep : null;
  const sleep = s && iso(s.wakeAt) && iso(s.until) ? { wakeAt: iso(s.wakeAt), until: iso(s.until) } : null;
  const d = e.dream && typeof e.dream === 'object' ? e.dream : null;
  const dream = d && iso(d.at) ? { dream: sentence(d.dream, 300), remembered: REMEMBERED.includes(d.remembered) ? d.remembered : 'some', at: iso(d.at) } : null;
  return {
    name: str(e.name, 120),
    reading,
    lastRunAt: iso(e.lastRunAt), // the last time a step ran for this Kin (reading, sleep or dream question)
    retryAt: iso(e.retryAt), // after an error: when to try again (kept when the ruler moves)
    failures: count(e.failures),
    serverFailures: count(e.serverFailures),
    errorKind: ['server', 'maintenance', 'answer', 'input'].includes(e.errorKind) ? e.errorKind : null,
    error: str(e.error, 500),
    note: str(e.note, 500),
    sleep,
    sleptOn: typeof e.sleptOn === 'string' && /^[0-9a-f]{8}$/.test(e.sleptOn) ? e.sleptOn : null,
    dream,
  };
}

/** status.json (text or object) -> { v, kins: { id: entry } }. */
export function normalizeStatus(raw) {
  const o = parse(raw);
  const kins = {};
  if (o.kins && typeof o.kins === 'object') {
    for (const [id, e] of Object.entries(o.kins)) if (str(id, 120)) kins[id] = normalizeEntry(e && typeof e === 'object' ? e : {});
  }
  return { v: 1, kins };
}

/**
 * Stop forgets the sleep cycle and any slowing down (the last reading stays). Stop only writes settings.stoppedAt, so
 * both the run and the screen apply it the same way, at once: what a Kin's entry holds from before that moment
 * (it last ran before Stop) is set aside.
 */
export function afterStop(entry, settings) {
  if (!entry || !settings.stoppedAt || (entry.lastRunAt && entry.lastRunAt > settings.stoppedAt)) return entry;
  return { ...entry, sleep: null, sleptOn: null, dream: null, retryAt: null, failures: 0, serverFailures: 0, errorKind: null, error: null, note: null };
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

/** A warning about Kindroid itself for a Kin's entry, or null. */
export function warningOf(entry) {
  if (!entry) return null;
  if (entry.errorKind === 'maintenance') return { kind: 'maintenance' };
  if (entry.errorKind === 'server' && entry.serverFailures >= ERRORS_BEFORE_WARNING) return { kind: 'server', failures: entry.serverFailures };
  return null;
}

