// The screen: a view of status.json (written by the run) and the controls that write settings.json. The run does the
// work, every 15 minutes or when Update status is pressed; the screen never asks the Kin anything itself.
import { h, keepFocus } from './dom.js';
import { icon, spinner, poseIcon } from './icons.js';
import { normalizeSettings, normalizeStatus, normalizeEntry, plannedAt, warningOf, SETTINGS_FILE, STATUS_FILE } from '../core/state.js';
import { INTERVAL_STEPS, formatInterval, snapInterval, startDueFor } from '../core/schedule.js';
import { describeDream } from '../core/sleep.js';
import { deviceTimeZone } from '../core/time.js';
import { formatClock, formatRelative, formatWhen } from '../core/format.js';

export const ACTION = 'update_status'; // run/program.js
const POLL_MS = 60000; // status.json is read again every minute while the screen is visible
const DREAM_SHOWN_H = 24;
const THEME_LABELS = { warm: 'Warm (default)', sage: 'Sage green' };

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
    busy: null, // 'read' | 'wake': the action is running
    error: null, // a problem of the screen itself (the action did not answer, a save failed)
    picking: false, // the Kin list is open on the card
    loaded: false,
  };

  // ------------------------------------------------------------ announcements
  // Two regions that stay in the page (a region rebuilt on every render would be read again and again): results
  // and notes are polite, errors are assertive. Each message is read once.
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const alertLive = h('div', { class: 'sr-only', role: 'alert' });
  document.body.append(live, alertLive);
  const say = (region, text) => { region.textContent = ''; setTimeout(() => { region.textContent = text; }, 30); };
  const announce = (text) => say(live, text);
  let lastAlert = '';
  const alertOnce = (text) => { if (text && text !== lastAlert) say(alertLive, text); lastAlert = text || ''; };

  // ------------------------------------------------------------ data
  function selectedKin() {
    const known = S.kinsKnown ? S.kins : kinsFromStatus();
    const found = known.find((k) => k.id === S.settings.kinId);
    if (found) return found;
    return known.length === 1 ? known[0] : null; // several Kins and none chosen: the person picks
  }
  function kinsFromStatus() {
    return Object.entries(S.status.kins).filter(([, e]) => e.name).map(([id, e]) => ({ id, name: e.name }));
  }
  const entryOf = (id) => S.status.kins[id] || normalizeEntry();

  async function saveSettings(patch) {
    S.settings = normalizeSettings({ ...S.settings, ...patch });
    try { await channel.write(SETTINGS_FILE, JSON.stringify(S.settings)); if (S.error && S.error.save) S.error = null; } catch (e) {
      S.error = { save: true, text: 'Your change could not be saved in Kindroid. Try again in a moment.' };
      alertOnce(S.error.text);
    }
    render();
  }

  async function loadStatus() {
    let body;
    try { body = await channel.read(STATUS_FILE); } catch { return; } // the next poll tries again
    const before = S.status;
    S.status = normalizeStatus(body);
    S.loaded = true;
    announceChanges(before, S.status);
    render();
  }

  /** What changed for the Kin on screen since the last read: told once, in plain words. */
  function announceChanges(before, after) {
    const kin = selectedKin();
    if (!kin) return;
    const a = before.kins[kin.id] || normalizeEntry();
    const b = after.kins[kin.id] || normalizeEntry();
    const text = (r) => (r ? `${r.location} ${r.doing} ${r.outfit}` : '');
    if (b.reading && b.reading.at !== (a.reading && a.reading.at) && text(b.reading) !== text(a.reading)) announce(text(b.reading));
    if (b.sleep && !a.sleep) announce(`${kin.name} is asleep until ${formatWhen(b.sleep.wakeAt, { now: clock() })}.`);
    if (b.dream && b.dream.at !== (a.dream && a.dream.at)) announce(`${kin.name} woke up. Dream: ${describeDream(b.dream)}`);
    const w = warningOf(b);
    if (w && !warningOf(a)) announce(warningText(w, b));
    if (b.error && b.error !== a.error) alertOnce(b.note || b.error);
  }

  // ------------------------------------------------------------ actions
  async function update(op = 'read') {
    const kin = selectedKin();
    if (!kin || S.busy) return; // repeated clicks join the run in progress
    S.busy = op; S.error = null; render();
    try {
      const r = await channel.action(ACTION, { kin: kin.id, name: kin.name, op });
      if (!r.ok && r.summary) S.error = { text: r.summary };
    } catch (e) {
      S.error = { text: 'Kindroid did not answer. Try again in a moment.' };
    }
    S.busy = null;
    if (S.error) alertOnce(S.error.text);
    await loadStatus();
    render();
  }

  function pick(kin) {
    S.picking = false;
    saveSettings({ kinId: kin.id }); // render at once; the save goes on
    renderAndFocus('update');
    announce(`Selected ${kin.name}.`);
  }

  function setRun(state) {
    if (S.settings.autoState === state) return;
    saveSettings({ autoState: state });
    announce(`Automatic update ${{ running: 'started', paused: 'paused', stopped: 'stopped' }[state]}.`);
  }

  // ------------------------------------------------------------ rendering
  const at = (iso) => formatWhen(iso, { now: clock() });

  function warningText(w, entry) {
    const next = startDueFor(plannedAt(entry, S.settings), clock());
    const when = ` The next try is around ${at(next.toISOString())}.`;
    return w.kind === 'maintenance' ? `Kindroid seems to be under maintenance.${when}` : `Kindroid has not answered ${w.failures} times in a row. It may be down.${when}`;
  }

  function avatar(size) {
    return h('span', { class: 'avatar', style: `width:${size}px;height:${size}px` }, icon('person', { size: Math.round(size * 0.55) }));
  }

  function renderKinList({ intro }) {
    const current = selectedKin();
    return h('div', { class: 'picker' },
      intro,
      h('ul', { class: 'profile-list', role: 'list' }, ...(S.kinsKnown ? S.kins : kinsFromStatus()).map((k) => {
        const e = entryOf(k.id);
        const state = e.sleep && S.settings.autoState !== 'stopped' ? `Asleep until ${at(e.sleep.wakeAt)}`
          : e.reading ? `${e.reading.location.replace(/\.$/, '')} · ${formatRelative(e.reading.at, clock())}` : 'Not read yet';
        const isCurrent = current && current.id === k.id;
        return h('li', {},
          h('button', { type: 'button', class: `profile-pick${isCurrent ? ' selected' : ''}`, 'aria-pressed': String(Boolean(isCurrent)), 'data-key': `pick-${k.id}`, onClick: () => pick(k) },
            avatar(36), h('span', { class: 'pp-text' }, h('strong', {}, k.name), h('span', { class: 'muted' }, state)),
            isCurrent ? h('span', { class: 'tag' }, 'Selected') : null));
      })),
      h('p', { class: 'help' }, 'Only the selected Kin is read. To attach or detach a Kin, open Clotheskin’s settings in Kindroid Apps and use Kins.'));
  }

  function fact(iconName, label, testid, value, empty) {
    return h('div', { class: `fact${value ? '' : ' empty'}` },
      h('span', { class: 'row-icon' }, icon(iconName, { size: 24 })),
      h('span', { class: 'fact-text' }, h('span', { class: 'row-label' }, label), h('span', { class: 'fact-value', 'data-testid': testid }, value || empty)));
  }

  function renderCard() {
    const known = S.kinsKnown ? S.kins : kinsFromStatus();
    const kin = selectedKin();
    if (!kin) {
      if (!known.length) {
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
    const stopped = S.settings.autoState === 'stopped';
    const dream = !stopped && e.dream && e.dream.dream && now - new Date(e.dream.at) < DREAM_SHOWN_H * 3600e3 ? e.dream : null;
    const others = known.length - 1;
    const warning = S.settings.autoState === 'running' ? warningOf(e) : null;
    const problem = S.error ? S.error.text : e.error ? (e.note || e.error) : null;

    return h('section', { class: 'card', 'aria-label': `${kin.name}: current status` },
      h('div', { class: 'card-top' },
        h('div', { class: 'who-row' }, avatar(48), h('span', { class: 'who' }, h('span', { class: 'name' }, kin.name),
          others > 0 ? h('span', { class: 'muted small', 'data-testid': 'only-this' }, `Only this Kin is read · ${others} other${others > 1 ? 's' : ''} attached`) : null)),
        others > 0 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': S.picking ? 'Close the Kin list' : 'Switch Kin', 'aria-expanded': String(S.picking), 'data-key': 'switch', onClick: () => { S.picking = !S.picking; renderAndFocus(S.picking ? `pick-${kin.id}` : 'switch'); } }, icon(S.picking ? 'close' : 'users', { size: 20 })) : null),
      S.picking ? h('div', { class: 'card-body' }, renderKinList({ intro: null })) : null,
      h('div', { class: 'card-body' },
        h('h2', { class: 'section-title' }, 'Current status'),
        h('div', { class: 'facts' },
          fact('pin', 'Location', 'location', r && r.location, 'No location read yet.'),
          fact(r ? poseIcon(r.doing) : 'person', 'Pose and action', 'doing', r && r.doing, 'No pose or action read yet.'),
          fact('hanger', 'Outfit', 'outfit', r && r.outfit, 'No outfit read yet. Press Update status.'),
          dream ? fact('moon', 'Last dream', 'dream', describeDream(dream), '') : null),
        h('button', { type: 'button', class: 'btn primary block', 'data-key': 'update', 'aria-busy': String(Boolean(S.busy)), onClick: () => update('read') },
          S.busy ? [spinner(), S.busy === 'wake' ? 'Asking about the dream…' : 'Reading…'] : [icon('refresh', { size: 18 }), 'Update status']),
        h('p', { class: 'meta', 'data-testid': 'last-checked' }, 'Last read: ',
          r && r.at ? [h('time', { datetime: r.at }, formatClock(r.at, { now })), ' · ', h('span', { class: 'rel', 'data-iso': r.at }, formatRelative(r.at, now))] : 'never'),
        warning ? h('div', { class: 'banner warn', 'data-testid': 'server-warning' }, icon('alert', { size: 18 }), h('span', { class: 'banner-text' }, warningText(warning, e)),
          h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: () => update('read') }, 'Try now'))
          : problem && !S.busy ? h('div', { class: 'banner error', 'data-testid': 'banner' }, icon('alert', { size: 18 }), h('span', { class: 'banner-text' }, problem),
            h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: () => update('read') }, 'Try again')) : null,
        renderAutomation(kin, e)));
  }

  // Start / Pause / Stop and the ruler. The ruler's label follows the thumb while dragging; the choice is saved on
  // release (a render is held back while the thumb is held, so a status refresh cannot cut the drag short).
  let dragging = false;
  function renderAutomation(kin, e) {
    const run = S.settings.autoState;
    const value = snapInterval(S.settings.intervalS);
    const label = (s) => `Every ${formatInterval(s)}`;
    const out = h('span', { class: 'auto-value', 'data-testid': 'auto-value', 'aria-hidden': 'true' }, label(value));
    const now = clock();
    const night = e.sleep;
    let status;
    if (run === 'stopped') status = 'Stopped. Press Start to update automatically.';
    else if (night) {
      const dreamAt = startDueFor(plannedAt(e, S.settings), now).toISOString();
      const asleep = new Date(night.until) > now ? `Asleep until ${at(night.wakeAt)}. The dream question comes around ${at(dreamAt)}. ` : `Waking up: the dream question comes around ${at(dreamAt)}. `;
      status = run === 'paused' ? `${asleep}Paused: nothing is asked until you press Resume.`
        : [asleep, h('button', { type: 'button', class: 'link-btn', 'data-key': 'wake-now', disabled: Boolean(S.busy), onClick: () => update('wake') }, 'Wake now')];
    } else if (run === 'paused') status = 'Paused: nothing is asked until you press Resume.';
    else status = `Next update around ${at(startDueFor(plannedAt(e, S.settings), now).toISOString())}.`;
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
      e.note && run === 'running' && !warningOf(e) && !e.error ? h('p', { class: 'meta auto-note', 'data-testid': 'auto-note' }, e.note) : null,
      h('p', { class: 'help cost' }, 'Kindroid starts Clotheskin every 15 minutes, even while it is stopped. Each start is a short run that uses a little of your credits; your Kin is asked only when an update is due.'));
  }

  function renderSettings() {
    const s = S.settings;
    return h('details', { class: 'reader', open: S.settingsOpen ? '' : undefined, onToggle: (ev) => { S.settingsOpen = ev.currentTarget.open; } },
      h('summary', { 'data-key': 'settings-summary' }, 'Settings'),
      h('div', { class: 'reader-body' },
        h('h3', { class: 'sub' }, 'Dreams'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-key': 'tell-dream', checked: s.tellDream || undefined, onChange: (ev) => saveSettings({ tellDream: ev.target.checked }) }),
          h('span', {}, 'Tell my Kin its dream, so it can remember it during the day')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-key': 'reach-out', checked: s.reachOut || undefined, disabled: !s.tellDream || undefined, onChange: (ev) => saveSettings({ reachOut: ev.target.checked }) }),
          h('span', {}, 'Let my Kin bring the dream up by itself')),
        h('h3', { class: 'sub' }, 'Appearance'),
        h('label', { class: 'label', for: 'theme-pick' }, 'Theme'),
        h('select', { id: 'theme-pick', class: 'text-input', 'data-key': 'theme-pick', onChange: (ev) => { saveSettings({ theme: ev.target.value }); applyTheme(ev.target.value); } },
          ...Object.entries(THEME_LABELS).map(([id, text]) => h('option', { value: id, selected: s.theme === id ? '' : undefined }, text))),
        h('h3', { class: 'sub' }, 'How it works'),
        h('p', { class: 'help' }, 'Your Kin looks at its recent chat with you and says where it is, how it is positioned, what it is doing and what it is wearing; Clotheskin shows that as three sentences. When it is asleep, Clotheskin asks when it will wake up, lets it sleep, and asks about its dream in the morning. Only the last reading and the night’s times are kept, never the chat.')));
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
    keepFocus(root, () => {
      const parts = [
        h('header', { class: 'app-head' }, h('h1', {}, 'Clotheskin'), h('p', {}, 'Where your Kin is, what it is doing and what it is wearing')),
        renderCard(),
        selectedKin() ? renderSettings() : null,
      ];
      root.replaceChildren(...parts.filter(Boolean)); // replaceChildren would show a null as the text "null"
    });
  }
  function renderAndFocus(key) { render(); const el = root.querySelector(`[data-key="${key}"]`); if (el) el.focus(); }

  // ------------------------------------------------------------ start
  try { S.settings = normalizeSettings(await channel.read(SETTINGS_FILE)); } catch { /* defaults; saving will retry */ }
  applyTheme(S.settings.theme);
  await loadStatus();
  // The run needs the person's time zone (wake-up times are on their clock) and, with one Kin, which Kin to read.
  // Only with a real Kindroid around (it listed the Kins): a still picture of the screen saves nothing.
  const fixes = {};
  const tz = deviceTimeZone();
  if (S.settings.tz !== tz) fixes.tz = tz;
  const only = S.kinsKnown && S.kins.length === 1 ? S.kins[0] : null;
  if (only && S.settings.kinId !== only.id) fixes.kinId = only.id;
  if (S.kinsKnown && Object.keys(fixes).length) saveSettings(fixes);

  channel.onKins((list) => { S.kins = list; S.kinsKnown = true; loadStatus(); });
  setInterval(() => { if (document.visibilityState !== 'hidden') loadStatus(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadStatus(); });
  setInterval(() => { for (const el of root.querySelectorAll('.rel[data-iso]')) el.textContent = formatRelative(el.dataset.iso, clock()); }, 30000);
  render();
  return { S, render, update };
}
