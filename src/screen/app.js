// The screen: a view of status.json (written by the run) and the controls that write settings.json. The run does the
// work, every 15 minutes or when Update status is pressed; the screen never asks the Kin anything itself.
import { h, keepFocus } from './dom.js';
import { icon, spinner, poseIcon, hairIcon } from './icons.js';
import { normalizeSettings, normalizeStatus, normalizeEntry, plannedAt, afterStop, warningOf, versionMismatch, shownMakeup, SETTINGS_FILE, STATUS_FILE, ACTION, THEMES } from '../core/state.js';
import { INTERVAL_STEPS, formatInterval, snapInterval, startDueFor } from '../core/schedule.js';
import { describeDream, DREAM_TTL_HOURS } from '../core/sleep.js';
import { deviceTimeZone } from '../core/time.js';
import { formatClock, formatRelative, formatWhen } from '../core/format.js';
import { APP_VERSION } from '../core/constants.js';

const POLL_MS = 60000; // status.json is read again every minute while the screen is visible
const RUN_WORDS = { running: 'started', paused: 'paused', stopped: 'stopped' };

/**
 * Starts the screen on a connected channel. `kins` is the first list from the page (null when the page answered
 * files but not the Kins, e.g. a still picture of the screen: the names then come from status.json).
 */
export async function startApp({ root, channel, kins, clock = () => new Date() }) {
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

  // ------------------------------------------------------------ announcements
  // Two regions that stay in the page (a region rebuilt on every render would be read again and again): results
  // and notes are polite, errors are assertive. Messages of one moment are joined, so none hides another.
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const alertLive = h('div', { class: 'sr-only', role: 'alert' });
  document.body.append(live, alertLive);
  const say = (region, text) => { region.textContent = ''; setTimeout(() => { region.textContent = text; }, 30); };
  const announce = (text) => { if (text) say(live, text); };
  let lastAlert = '';
  const alertOnce = (text) => { if (text && text !== lastAlert) say(alertLive, text); lastAlert = text || ''; };

  // ------------------------------------------------------------ data
  const known = () => (S.kinsKnown ? S.kins : kinsFromStatus());
  function kinsFromStatus() {
    return Object.entries(S.status.kins).filter(([, e]) => e.name).map(([id, e]) => ({ id, name: e.name }));
  }
  function selectedKin() {
    const list = known();
    return list.find((k) => k.id === S.settings.kinId) || (list.length === 1 ? list[0] : null); // several and none chosen: the person picks
  }
  /** A Kin's entry as the run will see it: what Stop forgot is not shown either. */
  const entryOf = (id) => afterStop(S.status.kins[id] || normalizeEntry(), S.settings);

  async function saveSettings(patch) {
    S.settings = normalizeSettings({ ...S.settings, ...patch });
    render(); // at once; the save goes on
    try {
      await channel.write(SETTINGS_FILE, JSON.stringify(S.settings));
      if (S.error && S.error.save) { S.error = null; render(); }
    } catch {
      S.error = { save: true, text: 'Your change could not be saved in Kindroid. Try again in a moment.' };
      alertOnce(S.error.text);
      render();
    }
  }

  /**
   * What the run needs from the screen, saved whenever the Kins are known (at start or later): the person's time zone
   * (wake-up times are on their clock) and, when only one Kin is attached, that Kin. Never from a still picture of the
   * screen (no Kin list): it saves nothing.
   */
  function syncSettings() {
    if (!S.kinsKnown) return;
    const fixes = {};
    const tz = deviceTimeZone();
    if (S.settings.tz !== tz) fixes.tz = tz;
    if (S.kins.length === 1 && S.settings.kinId !== S.kins[0].id) fixes.kinId = S.kins[0].id;
    if (Object.keys(fixes).length) saveSettings(fixes);
  }

  async function loadStatus({ asked = false } = {}) {
    let body;
    try { body = await channel.read(STATUS_FILE); } catch { if (asked) render(); return; } // the next poll tries again
    if (body === S.statusText && !asked) return; // nothing new: no render, focus left alone
    const before = S.status;
    S.statusText = body;
    S.status = normalizeStatus(body);
    const kin = selectedKin();
    if (kin && S.error && S.error.kinId === kin.id && entryOf(kin.id).lastRunAt !== (before.kins[kin.id] || {}).lastRunAt) S.error = null; // a newer run
    if (S.loaded || asked) announceChanges(before, S.status, asked);
    S.loaded = true;
    render();
  }

  /** What changed for the Kin on screen: told once, in plain words. After Update status the reading is always told. */
  function announceChanges(before, after, asked) {
    const kin = selectedKin();
    if (!kin) return;
    const a = afterStop(before.kins[kin.id] || normalizeEntry(), S.settings);
    const b = afterStop(after.kins[kin.id] || normalizeEntry(), S.settings);
    const text = (r) => (r ? [r.location, r.doing, r.outfit, r.hair, shownMakeup(r.makeup)].filter(Boolean).join(' ') : '');
    const parts = [];
    if (b.reading && (asked ? b.reading.at !== (a.reading && a.reading.at) : text(b.reading) !== text(a.reading))) parts.push(text(b.reading));
    if (b.sleep && (!a.sleep || asked)) parts.push(`${kin.name} is asleep until ${formatWhen(b.sleep.wakeAt, { now: clock() })}.`);
    if (b.dream && b.dream.at !== (a.dream && a.dream.at)) parts.push(`${kin.name} woke up. Dream: ${describeDream(b.dream)}`);
    const w = warningOf(b);
    if (w && (!warningOf(a) || warningOf(a).kind !== w.kind)) parts.push(warningText(w, b));
    announce(parts.join(' '));
    if (b.error && !w && (b.error !== a.error || b.lastRunAt !== a.lastRunAt)) alertOnce(problemText(b, kin));
  }

  // ------------------------------------------------------------ actions
  async function update(op = 'read') {
    const kin = selectedKin();
    if (!kin || S.busy[kin.id]) return; // repeated clicks join the run in progress
    S.busy[kin.id] = op;
    S.error = null; lastAlert = ''; // the same error after a new try is told again
    const ranBefore = entryOf(kin.id).lastRunAt;
    render();
    try {
      const r = await channel.action(ACTION, { kin: kin.id, op });
      if (!r.ok && r.summary) S.error = { kinId: kin.id, text: r.summary };
    } catch {
      S.error = { kinId: kin.id, text: 'Kindroid did not answer. Try again in a moment.' };
    }
    delete S.busy[kin.id];
    await loadStatus({ asked: true });
    // When the run recorded its own outcome, its words (friendlier, with the next try) replace the raw reply.
    if (S.error && entryOf(kin.id).lastRunAt !== ranBefore) { S.error = null; render(); }
    if (S.error) alertOnce(S.error.text);
  }

  function pick(kin) {
    S.picking = false;
    S.error = null;
    saveSettings({ kinId: kin.id });
    renderAndFocus('update');
    announce(`Selected ${kin.name}.`);
  }

  function setRun(state) {
    if (S.settings.autoState === state) return;
    saveSettings(state === 'stopped' ? { autoState: state, stoppedAt: clock().toISOString() } : { autoState: state });
    announce(`Automatic update ${RUN_WORDS[state]}.`);
  }

  // ------------------------------------------------------------ text
  const at = (iso) => formatWhen(iso, { now: clock() });
  const nextTry = (entry) => at(startDueFor(plannedAt(entry, S.settings), clock()).toISOString());

  function warningText(w, entry) {
    const when = ` The next try is around ${nextTry(entry)}.`;
    return w.kind === 'maintenance' ? `Kindroid seems to be under maintenance.${when}` : `Kindroid has not answered ${w.failures} times in a row. It may be down.${when}`;
  }

  /** The last run's problem in plain words (the technical detail in brackets, for anyone who reports it). */
  function problemText(e, kin) {
    if (e.note) return e.note;
    if (e.errorKind === 'answer') return `${kin.name}'s answer could not be read: ${e.error}`;
    if (e.errorKind === 'server') return `Kindroid did not answer this time (${e.error}). It tries again around ${nextTry(e)}.`;
    return e.error;
  }

  // ------------------------------------------------------------ rendering
  function avatar(size) {
    return h('span', { class: 'avatar', style: `width:${size}px;height:${size}px` }, icon('person', { size: Math.round(size * 0.55) }));
  }

  function renderKinList({ intro }) {
    const current = selectedKin();
    return h('div', { class: 'picker' },
      intro,
      h('ul', { class: 'profile-list', role: 'list' }, ...known().map((k) => {
        const e = entryOf(k.id);
        const state = e.sleep ? `Asleep until ${at(e.sleep.wakeAt)}`
          : e.reading ? `${e.reading.location.replace(/\.$/, '')} · ${formatRelative(e.reading.at, clock())}` : 'Not read yet';
        const isCurrent = current && current.id === k.id;
        return h('li', {},
          h('button', { type: 'button', class: `profile-pick${isCurrent ? ' selected' : ''}`, 'aria-pressed': String(Boolean(isCurrent)), 'data-key': `pick-${k.id}`, onClick: () => pick(k) },
            avatar(36), h('span', { class: 'pp-text' }, h('strong', {}, k.name), h('span', { class: 'muted' }, state)),
            isCurrent ? h('span', { class: 'tag' }, 'Selected') : null));
      })),
      h('p', { class: 'help' }, 'Only the selected Kin is read. To attach or detach a Kin, open Clotheskin’s settings in Kindroid Apps and use Kins.'));
  }

  // `seen`: for a sentence kept from an earlier reading (the Kin said nothing new about it), when it was last seen.
  function fact(iconName, label, testid, value, empty, seen) {
    return h('div', { class: `fact${value ? '' : ' empty'}` },
      h('span', { class: 'row-icon' }, icon(iconName, { size: 24 })),
      h('span', { class: 'fact-text' },
        h('span', { class: 'row-label' }, label, seen ? h('span', { class: 'seen', 'data-testid': `${testid}-seen` }, ` · seen ${seen}`) : null),
        h('span', { class: 'fact-value', 'data-testid': testid }, value || empty)));
  }
  const seenAt = (r, key, now) => (r && r.seen && r.seen[key] && r.seen[key] !== r.at ? formatClock(r.seen[key], { now }) : null);

  function renderCard() {
    const list = known();
    const kin = selectedKin();
    if (!kin) {
      if (!list.length && !S.kinsKnown) return h('section', { class: 'card empty' }, h('p', { class: 'muted' }, 'Connecting to Kindroid…'));
      if (!list.length) {
        return h('section', { class: 'card empty' },
          h('div', { class: 'empty-art' }, icon('users', { size: 40 })),
          h('h2', {}, 'Select a Kin'),
          h('p', { class: 'muted' }, 'No Kin is attached to this app yet. In Kindroid Apps, open Clotheskin’s settings, go to Kins and tick the Kin you want to follow.'));
      }
      return h('section', { class: 'card picker-card', 'aria-labelledby': 'picker-title' },
        renderKinList({ intro: [h('h2', { id: 'picker-title' }, 'Select a Kin'), h('p', { class: 'muted' }, 'Which Kin is in your roleplay now?')] }));
    }

    const e = entryOf(kin.id);
    const r = e.reading;
    const now = clock();
    const busy = S.busy[kin.id];
    const dream = e.dream && e.dream.dream && now - new Date(e.dream.at) < DREAM_TTL_HOURS * 3600e3 ? e.dream : null;
    const others = list.length - 1;
    const warning = S.settings.autoState === 'running' ? warningOf(e) : null;
    const problem = S.error && (S.error.save || S.error.kinId === kin.id) ? S.error.text : e.error ? problemText(e, kin) : null;

    return h('section', { class: 'card', 'aria-label': `${kin.name}: current status` },
      h('div', { class: 'card-top' },
        h('div', { class: 'who-row' }, avatar(48), h('span', { class: 'who' }, h('span', { class: 'name' }, kin.name),
          others > 0 ? h('span', { class: 'muted small', 'data-testid': 'only-this' }, `Only this Kin is read · ${others} other${others > 1 ? 's' : ''} attached`) : null)),
        others > 0 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': S.picking ? 'Close the Kin list' : 'Switch Kin', 'aria-expanded': String(S.picking), 'data-key': 'switch', onClick: () => { S.picking = !S.picking; renderAndFocus(S.picking ? `pick-${kin.id}` : 'switch'); } }, icon(S.picking ? 'close' : 'users', { size: 20 })) : null),
      S.picking ? h('div', { class: 'card-body' }, renderKinList({ intro: null })) : null,
      h('div', { class: 'card-body' },
        h('h2', { class: 'section-title' }, 'Current status'),
        h('div', { class: 'facts' },
          fact('pin', 'Location', 'location', r && r.location, 'No location read yet.', seenAt(r, 'location', now)),
          fact(r ? poseIcon(r.doing) : 'person', 'Pose and action', 'doing', r && r.doing, 'No pose or action read yet.', seenAt(r, 'doing', now)),
          fact('hanger', 'Outfit', 'outfit', r && r.outfit, 'No outfit read yet. Press Update status.', seenAt(r, 'outfit', now)),
          r && r.hair ? fact(hairIcon(r.hair), 'Hair', 'hair', r.hair, '', seenAt(r, 'hair', now)) : null,
          r && shownMakeup(r.makeup) ? fact('makeup', 'Makeup', 'makeup', r.makeup, '', seenAt(r, 'makeup', now)) : null,
          dream ? fact('moon', 'Last dream', 'dream', describeDream(dream), '') : null),
        h('button', { type: 'button', class: 'btn primary block', 'data-key': 'update', 'aria-busy': String(Boolean(busy)), onClick: () => update('read') },
          busy ? [spinner(), busy === 'wake' ? 'Asking about the dream…' : 'Reading…'] : [icon('refresh', { size: 18 }), 'Update status']),
        h('p', { class: 'meta', 'data-testid': 'last-checked' }, 'Last read: ',
          r && r.at ? [h('time', { datetime: r.at }, formatClock(r.at, { now })), ' · ', h('span', { class: 'rel', 'data-iso': r.at }, formatRelative(r.at, now))] : 'never'),
        warning ? h('div', { class: 'banner warn', 'data-testid': 'server-warning' }, icon('alert', { size: 18 }), h('span', { class: 'banner-text' }, warningText(warning, e)),
          h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: () => update('read') }, 'Try now'))
          : problem && !busy ? h('div', { class: 'banner error', 'data-testid': 'banner' }, icon('alert', { size: 18 }), h('span', { class: 'banner-text' }, problem),
            h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: () => update('read') }, 'Try again')) : null,
        renderAutomation(e, busy)));
  }

  // Start / Pause / Stop and the ruler. The ruler's label follows the thumb while dragging; the choice is saved on
  // release (a render is held back while the thumb is held, so a status refresh cannot cut the drag short).
  let dragging = false;
  function renderAutomation(e, busy) {
    const run = S.settings.autoState;
    const value = snapInterval(S.settings.intervalS);
    const label = (s) => `Every ${formatInterval(s)}`;
    const out = h('span', { class: 'auto-value', 'data-testid': 'auto-value', 'aria-hidden': 'true' }, label(value));
    const now = clock();
    const night = e.sleep;
    let status;
    if (run === 'stopped') status = 'Stopped. Press Start to update automatically.';
    else if (night) {
      const asleep = new Date(night.until) > now ? `Asleep until ${at(night.wakeAt)}. The dream question comes around ${nextTry(e)}. ` : `Waking up: the dream question comes around ${nextTry(e)}. `;
      status = run === 'paused' ? `${asleep}Paused: nothing is asked until you press Resume.`
        : [asleep, busy ? null : h('button', { type: 'button', class: 'link-btn', 'data-key': 'wake-now', onClick: () => update('wake') }, 'Wake now')];
    } else if (run === 'paused') status = 'Paused: nothing is asked until you press Resume.';
    else status = `Next update around ${nextTry(e)}.`;
    const control = (key, text, iconName, enabled, state, focusAfter) => h('button', {
      type: 'button', class: `btn small${key === 'auto-start' ? ' primary' : ''}`, 'data-key': key, disabled: !enabled,
      onClick: () => { setRun(state); renderAndFocus(focusAfter); },
    }, icon(iconName, { size: 16 }), text);
    return h('div', { class: 'auto', role: 'group', 'aria-labelledby': 'auto-title' },
      h('div', { class: 'auto-head' },
        h('span', { class: 'row-label', id: 'auto-title' }, 'Automatic update'),
        h('span', { class: `auto-state ${run}`, 'data-testid': 'auto-state' }, { running: 'Running', paused: 'Paused', stopped: 'Stopped' }[run])),
      h('div', { class: 'auto-controls' },
        control('auto-start', run === 'paused' ? 'Resume' : 'Start', 'play', run !== 'running', 'running', 'auto-pause'),
        control('auto-pause', 'Pause', 'pause', run === 'running', 'paused', 'auto-start'),
        control('auto-stop', 'Stop', 'stop', run !== 'stopped', 'stopped', 'auto-start')),
      h('div', { class: 'auto-head' }, h('label', { class: 'row-label', for: 'auto-ruler' }, 'How often'), out),
      h('input', { type: 'range', id: 'auto-ruler', class: 'ruler', 'data-key': 'auto-ruler', min: 0, max: INTERVAL_STEPS.length - 1, step: 1, value: Math.max(0, INTERVAL_STEPS.indexOf(value)), 'aria-valuetext': label(value),
        onPointerdown: () => { dragging = true; },
        onInput: (ev) => { const s = INTERVAL_STEPS[Number(ev.target.value)]; out.textContent = label(s); ev.target.setAttribute('aria-valuetext', label(s)); },
        onChange: (ev) => { dragging = false; saveSettings({ intervalS: INTERVAL_STEPS[Number(ev.target.value)] }); } }),
      h('div', { class: 'ruler-ends muted', 'aria-hidden': 'true' }, h('span', {}, '15 min'), h('span', {}, '4 h')),
      h('p', { class: 'meta auto-status', 'data-testid': 'auto-status' }, status),
      h('p', { class: 'help cost' }, 'Kindroid starts Clotheskin every 15 minutes, even while it is stopped. Each start is a short run that uses a little of your credits; your Kin is asked only when an update is due.'));
  }

  // The dream choices, in plain sight (not inside Settings): nothing is told to the Kin unless the person ticks it.
  function renderDreams() {
    const s = S.settings;
    const reachOn = s.tellDream && s.reachOut;
    return h('section', { class: 'card dreams', 'aria-labelledby': 'dreams-title' },
      h('div', { class: 'card-body' },
        h('h2', { class: 'section-title', id: 'dreams-title' }, 'Dreams'),
        h('p', { class: 'help' }, 'When your Kin wakes up, Clotheskin asks what it dreamt and shows it here for a day. Your Kin is not told its dream unless you turn this on.'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-key': 'tell-dream', checked: s.tellDream || undefined, onChange: (ev) => saveSettings({ tellDream: ev.target.checked }) }),
          h('span', {}, 'Tell my Kin its dream, so it can remember it during the day')),
        h('label', { class: `check${s.tellDream ? '' : ' off'}` }, h('input', { type: 'checkbox', 'data-key': 'reach-out', checked: reachOn || undefined, disabled: !s.tellDream || undefined, 'aria-describedby': s.tellDream ? undefined : 'reach-why', onChange: (ev) => saveSettings({ reachOut: ev.target.checked }) }),
          h('span', {}, 'Let my Kin bring the dream up by itself', s.tellDream ? null : h('span', { class: 'why', id: 'reach-why' }, ' (needs the option above)')))));
  }

  function renderSettings() {
    const s = S.settings;
    return h('details', { class: 'reader', open: S.settingsOpen ? '' : undefined, onToggle: (ev) => { S.settingsOpen = ev.currentTarget.open; } },
      h('summary', { 'data-key': 'settings-summary' }, 'Settings'),
      h('div', { class: 'reader-body' },
        h('h3', { class: 'sub' }, 'Appearance'),
        h('label', { class: 'label', for: 'theme-pick' }, 'Theme'),
        h('select', { id: 'theme-pick', class: 'text-input', 'data-key': 'theme-pick', onChange: (ev) => { applyTheme(ev.target.value); saveSettings({ theme: ev.target.value }); } },
          ...Object.entries(THEMES).map(([id, text]) => h('option', { value: id, selected: s.theme === id ? '' : undefined }, text))),
        h('h3', { class: 'sub' }, 'How it works'),
        h('p', { class: 'help' }, 'Your Kin looks at its recent chat with you and says where it is, how it is positioned, what it is doing, what it is wearing, and its hair and makeup; Clotheskin shows that as short sentences. When it is asleep, Clotheskin asks when it will wake up, lets it sleep, and asks about its dream in the morning. Kept in the app’s files: the last reading, the night’s times and the last dream. The dream is erased after a day, and Stop erases the night and the dream within 15 minutes. The chat is never kept.'),
        h('p', { class: 'help', 'data-testid': 'version' }, `Clotheskin ${APP_VERSION}`)));
  }

  function applyTheme(id) {
    if (id === 'sage') document.documentElement.setAttribute('data-theme', 'sage');
    else document.documentElement.removeAttribute('data-theme');
  }

  // A render asked for while the ruler's thumb is held waits for the release.
  let renderPending = false;
  const endDrag = () => { if (!dragging) return; dragging = false; if (renderPending) render(); };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  function render() {
    if (dragging) { renderPending = true; return; }
    renderPending = false;
    const hadFocus = root.contains(document.activeElement);
    keepFocus(root, () => {
      const parts = [
        h('header', { class: 'app-head' }, h('h1', {}, 'Clotheskin'), h('p', {}, 'Where your Kin is, what it is doing and what it is wearing')),
        versionMismatch(S.status) ? h('div', { class: 'banner warn', role: 'alert', 'data-testid': 'version-mismatch' }, icon('alert', { size: 18 }),
          h('span', { class: 'banner-text' }, `Some of Clotheskin’s files are from another update: the screen is ${APP_VERSION}, the automatic part is ${versionMismatch(S.status)}. Update all the files together.`)) : null,
        renderCard(),
        selectedKin() ? renderDreams() : null,
        selectedKin() ? renderSettings() : null,
      ];
      root.replaceChildren(...parts.filter(Boolean)); // replaceChildren would show a null as the text "null"
    });
    // The focused control is gone (a banner closed, Wake now done, the Kin detached): the keyboard stays in the app.
    if (hadFocus && !root.contains(document.activeElement)) {
      const fallback = root.querySelector('[data-key="update"], [data-key^="pick-"], button');
      if (fallback) fallback.focus();
    }
  }
  function renderAndFocus(key) { render(); const el = root.querySelector(`[data-key="${key}"]`); if (el) el.focus(); }

  // ------------------------------------------------------------ start
  try { S.settings = normalizeSettings(await channel.read(SETTINGS_FILE)); } catch { /* defaults; saving will retry */ }
  applyTheme(S.settings.theme);
  await loadStatus();
  syncSettings();
  channel.onKins((list) => { S.kins = list; S.kinsKnown = true; syncSettings(); loadStatus({ asked: false }); render(); });
  setInterval(() => { if (document.visibilityState !== 'hidden') loadStatus(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadStatus(); });
  setInterval(() => { for (const el of root.querySelectorAll('.rel[data-iso]')) el.textContent = formatRelative(el.dataset.iso, clock()); }, 30000);
  render();
  return { S, render, update };
}
