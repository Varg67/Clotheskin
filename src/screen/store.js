// The screen's state and what changes it: settings.json (written here), status.json (read here, written by the run)
// and the program's action. No page here: `onChange` asks for a render, the announcer speaks.
import { normalizeSettings, normalizeStatus, normalizeEntry, afterStop, SETTINGS_FILE, STATUS_FILE, ACTION, AUTO } from '../core/state.js';
import { deviceTimeZone } from '../core/time.js';
import { changesToTell } from './texts.js';
/** @import { Settings, Status } from '../core/state.js' */
/** @typedef {{ id: string, name: string }} Who */

const RUN_WORDS = { [AUTO.RUNNING]: 'started', [AUTO.PAUSED]: 'paused', [AUTO.STOPPED]: 'stopped' };

// ------------------------------------------------------------ the state, and what it shows (pure)

/**
 * `kins` is the first list from the page (null when the page answered files but not the Kins, e.g. a still picture of
 * the screen: the names then come from status.json).
 */
export function initialState(kins) {
  /**
   * @type {{ kins: Who[], kinsKnown: boolean, settings: Settings, status: Status, statusText: string|null, loaded: boolean,
   *   busy: Object<string, string>, error: { kinId?: string, save?: boolean, text: string }|null, picking: boolean, settingsOpen: boolean }}
   */
  const S = {
    kins: kins || [],
    kinsKnown: Array.isArray(kins),
    settings: normalizeSettings(null),
    status: normalizeStatus(null),
    statusText: null, // status.json as last read: an unchanged file is not rendered again
    loaded: false, // the first read of status.json is not announced (nothing changed: the screen just opened)
    busy: {}, // kin id -> 'read' | 'wake': the action running for that Kin
    error: null, // { kinId, text } (the action did not answer) or { save: true, text } (a setting was not saved)
    picking: false, // the Kin list is open on the card
    settingsOpen: false,
  };
  return S;
}

/** The Kins to show: the page's list, or (a still picture of the screen) the names status.json remembers. */
export function knownKins(S) {
  if (S.kinsKnown) return S.kins;
  return Object.entries(S.status.kins).filter(([, e]) => e.name).map(([id, e]) => ({ id, name: e.name }));
}

/** The Kin on screen; with several attached and none chosen, none (the person picks). */
export function selectedKin(S) {
  const list = knownKins(S);
  return list.find((k) => k.id === S.settings.kinId) || (list.length === 1 ? list[0] : null);
}

/** A Kin's entry as the run will see it (in `status`, by default the current one): what Stop forgot is not shown. */
export const entryOf = (S, id, status = S.status) => afterStop(status.kins[id] || normalizeEntry(), S.settings);

/** What the run needs from the screen and does not have yet: the person's time zone, and the only attached Kin. */
export function settingsFixes(S, tz) {
  const fixes = {};
  if (S.settings.tz !== tz) fixes.tz = tz;
  if (S.kins.length === 1 && S.settings.kinId !== S.kins[0].id) fixes.kinId = S.kins[0].id;
  return fixes;
}

/** Whether a newer run of the Kin on screen (than in `before`) answers the action's error: its own words replace it. */
export function errorAnswered(S, before) {
  const kin = selectedKin(S);
  return Boolean(kin && S.error && S.error.kinId === kin.id && entryOf(S, kin.id).lastRunAt !== entryOf(S, kin.id, before).lastRunAt);
}

/** What to tell a screen reader about the Kin on screen since `before` ({ say, alert }), or null with no Kin. */
export function newsSince(S, before, { asked, now }) {
  const kin = selectedKin(S);
  if (!kin) return null;
  return changesToTell(entryOf(S, kin.id, before), entryOf(S, kin.id), { name: kin.name, asked, at: { settings: S.settings, now } });
}

// ------------------------------------------------------------ the actions

/** settings.json: written here only. A change shows at once; a save that fails says so. */
function settingsActions(S, { channel, onChange, announcer }) {
  async function saveSettings(patch) {
    S.settings = normalizeSettings({ ...S.settings, ...patch });
    onChange(); // at once; the save goes on
    try {
      await channel.write(SETTINGS_FILE, JSON.stringify(S.settings));
      if (S.error && S.error.save) { S.error = null; onChange(); }
    } catch {
      S.error = { save: true, text: 'Your change could not be saved in Kindroid. Try again in a moment.' };
      announcer.alertOnce(S.error.text);
      onChange();
    }
  }
  async function loadSettings() {
    try { S.settings = normalizeSettings(await channel.read(SETTINGS_FILE)); } catch { /* defaults; saving will retry */ }
  }
  /**
   * What the run needs from the screen, saved whenever the Kins are known (at start or later). Never from a still
   * picture of the screen (no Kin list): it saves nothing.
   */
  function syncSettings() {
    if (!S.kinsKnown) return;
    const fixes = settingsFixes(S, deviceTimeZone());
    if (Object.keys(fixes).length) saveSettings(fixes);
  }
  return { saveSettings, loadSettings, syncSettings };
}

/** status.json: read here, written by the run. What changed for the Kin on screen is told once, in plain words. */
function statusActions(S, { channel, clock, onChange, announcer }) {
  function tell(news) {
    if (!news) return;
    announcer.announce(news.say);
    if (news.alert) announcer.alertOnce(news.alert);
  }
  async function loadStatus({ asked = false } = {}) {
    let body;
    try { body = await channel.read(STATUS_FILE); } catch { if (asked) onChange(); return; } // the next poll tries again
    if (body === S.statusText && !asked) return; // nothing new: no render, focus left alone
    const before = S.status;
    S.statusText = body;
    S.status = normalizeStatus(body);
    if (errorAnswered(S, before)) S.error = null;
    if (S.loaded || asked) tell(newsSince(S, before, { asked, now: clock() }));
    S.loaded = true;
    onChange();
  }
  return { loadStatus };
}

/** The store: the state, the two files, and the program's action (Update status, Wake now). */
export function createStore(deps) {
  const { channel, clock, onChange, announcer } = deps;
  const S = initialState(deps.kins);
  const { saveSettings, loadSettings, syncSettings } = settingsActions(S, deps);
  const { loadStatus } = statusActions(S, deps);

  async function update(op = 'read') {
    const kin = selectedKin(S);
    if (!kin || S.busy[kin.id]) return; // repeated clicks join the run in progress
    S.busy[kin.id] = op;
    S.error = null;
    announcer.forget(); // the same error after a new try is told again
    const ranBefore = entryOf(S, kin.id).lastRunAt;
    onChange();
    try {
      const reply = await channel.action(ACTION, { kin: kin.id, op });
      if (!reply.ok && reply.summary) S.error = { kinId: kin.id, text: reply.summary };
    } catch {
      S.error = { kinId: kin.id, text: 'Kindroid did not answer. Try again in a moment.' };
    }
    delete S.busy[kin.id];
    await loadStatus({ asked: true });
    // When the run recorded its own outcome, its words (friendlier, with the next try) replace the raw reply.
    if (S.error && entryOf(S, kin.id).lastRunAt !== ranBefore) { S.error = null; onChange(); }
    if (S.error) announcer.alertOnce(S.error.text);
  }

  return {
    S, saveSettings, loadSettings, syncSettings, loadStatus, update,
    pick(kin) {
      S.picking = false;
      S.error = null;
      saveSettings({ kinId: kin.id });
      announcer.announce(`Selected ${kin.name}.`);
    },
    setRun(state) {
      if (S.settings.autoState === state) return;
      saveSettings(state === AUTO.STOPPED ? { autoState: state, stoppedAt: clock().toISOString() } : { autoState: state });
      announcer.announce(`Automatic update ${RUN_WORDS[state]}.`);
    },
    /** The page sent the Kin list again (the person attached or detached a Kin). */
    kinsChanged(list) {
      S.kins = list;
      S.kinsKnown = true;
      syncSettings();
      loadStatus({ asked: false });
      onChange();
    },
    known: () => knownKins(S),
    selectedKin: () => selectedKin(S),
    entryOf: (id) => entryOf(S, id),
  };
}
