import { h, keepFocus, openSheet } from './dom.js';
import { icon, spinner } from './icons.js';
import { buildOutfitPrompt } from '../core/prompt.js';
import { parseReading, describeReading, poseIcon, NO_HAIR, NO_MAKEUP } from '../core/outfit.js';
import { formatClock, formatRelative } from '../core/format.js';
import { DEMO_SCENES } from '../demo/demo.js';
import { ReadingStore, JournalStore, SENTENCE_KEYS, HISTORY_MAX, clearHistory } from '../core/readings.js';
import { normalizeInterval, effectiveMinutes, autoFailureLines, adaptiveLine, SCHEDULE_TICK_MINUTES, AUTO_MIN_MINUTES, AUTO_MAX_MINUTES, ADAPTIVE_MAX_FACTOR } from '../core/auto.js';
import { HOST_NO_ANSWER } from '../core/errors.js';
import { flag } from '../core/store.js';

export const THEMES = [
  { id: 'warm', label: 'Kindroid warm (default)' },
  { id: 'sage', label: 'Sage green' },
];

function applyTheme(id) {
  const theme = THEMES.some((t) => t.id === id) ? id : 'warm';
  if (theme === 'warm') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

const LOCAL_ID = 'local';
const NO_LOCATION = 'No location described in the recent chat.';
const NO_DOING = 'No pose or action described in the recent chat.';
const NO_OUTFIT = 'No outfit described in the recent chat.';
/** The sentences of a reading, with the "nothing described" text for any that is missing. */
const sentencesOf = (o) => ({
  location: typeof o?.location === 'string' ? o.location : NO_LOCATION,
  doing: typeof o?.doing === 'string' ? o.doing : NO_DOING,
  outfit: typeof o?.outfit === 'string' ? o.outfit : NO_OUTFIT,
  hair: typeof o?.hair === 'string' ? o.hair : NO_HAIR,
  makeup: typeof o?.makeup === 'string' ? o.makeup : NO_MAKEUP,
});
const DEFAULTS = new Set([NO_LOCATION, NO_DOING, NO_OUTFIT, NO_HAIR, NO_MAKEUP]);
const secs = (ms) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s` : '—');

/**
 * The tracker: ask the Kin where it is, what it is doing and what it is wearing; show the answer as sentences.
 * In local mode nothing is stored. In the Workshop only the latest reading per Kin is kept (so an automatic reading
 * made in the background can be shown later), plus small preferences.
 */
export async function startApp({ root, settings, host, clock = () => new Date() }) {
  document.documentElement.lang = 'en';
  const isWorkshop = host.id === 'workshop';
  document.body.classList.toggle('mode-workshop', isWorkshop);
  applyTheme(settings.value.theme);

  const S = {
    kins: isWorkshop ? (host.kins || []) : [{ id: LOCAL_ID, name: settings.value.localName }],
    results: new Map(), // kin id -> { location, doing, outfit, hair, makeup, at, source }  (five sentences)
    journals: new Map(), // Workshop: kin id -> { history, log }, loaded when History or Diagnostics is opened
    historyOpen: false,
    diagOpen: false,
    cached: new Map(), // Workshop: kin id -> the stored reading, including the last attempt and its error
    errors: new Map(), // kin id -> message
    reading: new Set(), // kin ids with a reading in progress
    info: null, // { kind, text } for the selected Kin
    pending: null, // local mode: { id, prompt } waiting for the pasted answer
    slow: new Set(), // Workshop: Kins whose reading is taking longer than usual
    slowAfterMs: 15000,
    autoNote: null, // a message inside the automatic-updates settings (e.g. a setting that could not be saved)
    responseDraft: '',
    chatDraft: '', // memory only: a pasted conversation is never written to storage
    readerOpen: !isWorkshop,
  };

  const readings = isWorkshop ? new ReadingStore(host.storage) : null;
  const journals = isWorkshop ? new JournalStore(host.storage) : null;
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  document.body.append(live);
  const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };

  // ---------------------------------------------------------------- selection
  /** Two Kins may share a name: then the end of their id tells them apart. */
  const displayName = (k) => (S.kins.filter((x) => x.name === k.name).length > 1 ? `${k.name} (…${String(k.id).slice(-4)})` : k.name);
  function selectedKin() {
    if (!isWorkshop) return { id: LOCAL_ID, name: settings.value.localName || 'the character' };
    const found = S.kins.find((k) => k.id === settings.value.selectedKinId);
    if (found) return found;
    return S.kins.length === 1 ? S.kins[0] : null; // several Kins: the person chooses
  }

  /** Workshop: pick up the stored reading (made by a manual run or by the schedule). Returns true if something changed. */
  async function loadReading(kin) {
    if (!readings || !kin) return false;
    let stored;
    try { stored = await readings.get(kin.id); } catch { return false; }
    if (!stored) return false;
    const before = JSON.stringify(S.cached.get(kin.id) ?? null);
    S.cached.set(kin.id, stored);
    const mine = S.results.get(kin.id);
    // Same time as what is shown = the stored copy of that very reading, which is never shortened: take it.
    // A reading whose date was lost (corrupt file) is still shown when there is nothing else, as "unknown time".
    const newer = stored.location !== null && (!mine || (stored.at !== null && Date.parse(stored.at) >= Date.parse(mine.at)));
    const next = newer ? { ...sentencesOf(stored), at: stored.at, source: stored.source } : null;
    if (newer) S.results.set(kin.id, next);
    return (newer && JSON.stringify(next) !== JSON.stringify(mine)) || JSON.stringify(stored) !== before;
  }

  /** Workshop: history and diagnostics, read only while one of them is open. */
  async function loadJournal(kin) {
    if (!journals || !kin) return;
    S.journals.set(kin.id, await journals.get(kin.id));
  }
  const journalWanted = () => S.historyOpen || S.diagOpen;

  async function pollReading() {
    const kin = selectedKin();
    if (!isWorkshop || !kin || S.reading.has(kin.id)) return;
    if (await loadReading(kin)) {
      if (journalWanted()) await loadJournal(kin);
      render();
    }
  }

  /** Keep the ticked Kins in the settings in step with the Kins the host reports (names change, Kins get detached). */
  async function syncAutoKins() {
    const ticked = settings.value.autoKins || [];
    const next = ticked.filter((k) => S.kins.some((x) => x.id === k.id)).map((k) => ({ id: k.id, name: S.kins.find((x) => x.id === k.id).name }));
    if (JSON.stringify(next) !== JSON.stringify(ticked)) await settings.save({ autoKins: next });
  }

  if (isWorkshop) {
    host.channel.onKinsChange(async (kins) => { S.kins = kins; await syncAutoKins(); await loadReading(selectedKin()); render(); });
  }

  function chooseKin(opener) {
    openSheet({
      title: 'Select a Kin', cancelLabel: 'Close', saveLabel: 'Done', onSave: () => undefined,
      onClose: () => opener?.focus?.(),
      build(body, api) {
        body.append(
          h('ul', { class: 'profile-list', role: 'list' }, ...S.kins.map((k) => h('li', {},
            h('button', { type: 'button', class: `profile-pick${k.id === selectedKin()?.id ? ' selected' : ''}`, 'aria-pressed': String(k.id === selectedKin()?.id), 'data-key': `pick-${k.id}`,
              onClick: async () => { S.info = null; await settings.save({ selectedKinId: k.id }); await loadReading(k); if (journalWanted()) await loadJournal(k); api.close(); render(); announce(`Selected ${k.name}`); } },
            avatar(36), h('span', { class: 'pp-text' }, h('strong', {}, displayName(k)), h('span', { class: 'muted' }, 'From Kindroid')),
            k.id === selectedKin()?.id ? h('span', { class: 'tag' }, 'Selected') : null)))),
          h('p', { class: 'help' }, 'These are the Kins attached to this app. To add or remove one, open the app’s settings in Kindroid Apps and use Kins.'));
      },
    });
  }

  // ------------------------------------------------------------------ reading
  function show(kinId, outcome) {
    if (outcome.ok) {
      S.results.set(kinId, { ...sentencesOf(outcome), at: outcome.at || clock().toISOString(), source: 'manual' });
      S.errors.delete(kinId);
      const c = S.cached.get(kinId);
      if (c) S.cached.set(kinId, { ...c, error: null }); // a success clears an earlier automatic failure, even if it could not be stored
    } else S.errors.set(kinId, outcome.error);
  }

  /**
   * The run ends with {"at":"…","location":"…","doing":"…","outfit":"…","hair":"…","makeup":"…"}; `at` is when it stored
   * the reading, so the stored (never shortened) copy can replace it. Plain text (an older run) is shown as the outfit.
   */
  function readSummary(summary) {
    try {
      const o = JSON.parse(summary);
      if (o && typeof o.outfit === 'string') {
        const at = typeof o.at === 'string' && Number.isFinite(Date.parse(o.at)) ? o.at : null;
        return { ok: true, ...sentencesOf(o), at, cut: o.cut === true };
      }
    } catch { /* not JSON */ }
    return { ok: true, ...sentencesOf({ outfit: summary || NO_OUTFIT }), at: null };
  }

  const announceResult = (id) => S.errors.get(id) || (S.results.get(id) ? SENTENCE_KEYS.map((k) => S.results.get(id)[k]).filter((t) => !DEFAULTS.has(t)).join(' ') : '');

  /** What the person should read when the Workshop itself does not answer (the connection, not the Kin). */
  const friendlyHostError = (e) => (/did not answer/i.test(e.message) ? HOST_NO_ANSWER : e.message);

  /** Workshop: the run asks the Kin about its recent chat. The reading belongs to the Kin it started for. */
  async function readInWorkshop(kin) {
    if (S.reading.has(kin.id)) return; // repeated clicks join the reading in progress
    S.reading.add(kin.id); S.info = null; render();
    // A slow Kin is not a failed Kin: say so after a while, instead of leaving a spinner with no explanation.
    const slowTimer = setTimeout(() => { if (S.reading.has(kin.id)) { S.slow.add(kin.id); render(); } }, S.slowAfterMs);
    try {
      const r = await host.channel.runAction('read_outfit', { kin: kin.id, name: kin.name });
      const outcome = r.ok ? readSummary(r.summary) : { ok: false, error: r.summary || 'The reading could not be completed.' };
      show(kin.id, outcome);
      // The line back is limited to 500 characters; the stored copy is whole. Pick it up (same time = same reading).
      if (outcome.ok && outcome.at) await loadReading(kin);
    } catch (e) {
      show(kin.id, { ok: false, error: friendlyHostError(e) });
    }
    if (journalWanted()) { try { await loadJournal(kin); } catch { /* the reading counts; the journal can wait */ } }
    clearTimeout(slowTimer);
    S.slow.delete(kin.id);
    S.reading.delete(kin.id);
    announce(announceResult(kin.id));
    render();
  }

  /** Local mode: build the prompt from the pasted chat, then wait for the pasted JSON answer. */
  function prepareLocal() {
    const chat = S.chatDraft.trim();
    if (!chat) { S.info = { kind: 'info', text: 'Paste a conversation in the scene reader first.' }; S.readerOpen = true; render(); document.querySelector('[data-key="chat"]')?.focus(); return; }
    const kin = selectedKin();
    S.pending = { id: kin.id, prompt: buildOutfitPrompt({ name: kin.name, chat }) };
    S.reading.add(kin.id); S.info = null; S.readerOpen = true; render();
  }

  function applyLocal(text) {
    const kin = selectedKin();
    const id = S.pending?.id ?? kin.id; // the answer belongs to the Kin the question was prepared for
    const parsed = parseReading(text);
    show(id, parsed.ok ? { ok: true, ...describeReading(parsed) } : { ok: false, error: `${parsed.error} Nothing was changed.` });
    S.pending = null; S.reading.delete(id);
    if (parsed.ok) S.responseDraft = '';
    announce(announceResult(id));
    render();
  }

  async function update() {
    const kin = selectedKin();
    if (!kin) { chooseKin(); return; }
    if (isWorkshop) await readInWorkshop(kin); else prepareLocal();
  }

  // ---------------------------------------------------------------- rendering
  function avatar(size = 48) {
    return h('span', { class: 'avatar', style: `width:${size}px;height:${size}px` }, icon('person', { size: Math.round(size * 0.55) }));
  }

  function renderThemePicker() {
    return h('div', { class: 'theme-block' },
      h('h3', { class: 'sub' }, 'Appearance'),
      h('div', { class: 'demo-pick' },
        h('label', { class: 'label', for: 'theme-pick' }, 'Theme'),
        h('select', { id: 'theme-pick', class: 'text-input', 'data-key': 'theme-pick',
          onChange: async (e) => { applyTheme(e.target.value); await settings.save({ theme: e.target.value }); announce(`Theme: ${THEMES.find((t) => t.id === e.target.value)?.label}`); } },
        ...THEMES.map((t) => h('option', { value: t.id, selected: settings.value.theme === t.id ? '' : undefined }, t.label)),
        h('option', { value: 'host', disabled: '' }, 'Match my Kindroid theme (needs host support)'))),
      h('p', { class: 'help' }, 'Kindroid themes are customisable. Matching yours automatically depends on the Workshop exposing theme colours, which has not been confirmed yet.'));
  }

  function renderCard() {
    const kin = selectedKin();
    if (!kin) {
      return h('section', { class: 'card empty' },
        h('div', { class: 'empty-art' }, icon('users', { size: 40 })),
        h('h2', {}, 'Select a Kin'),
        h('p', { class: 'muted' }, S.kins.length === 0
          ? 'No Kin is attached to this app yet. In Apps, open Clotheskin’s settings, go to Kins and tick the Kins you want to track.'
          : 'Choose which Kin to read before pressing Update status.'),
        S.kins.length === 0 ? null : h('button', { type: 'button', class: 'btn primary', 'data-key': 'select-companion', onClick: (e) => chooseKin(e.currentTarget) }, 'Select a Kin'));
    }
    const reading = S.reading.has(kin.id);
    const result = S.results.get(kin.id);
    const stored = S.cached.get(kin.id);
    // A stored error stands until a later success clears it (the run does that). No clocks are compared: the screen
    // and the run may disagree about the time.
    const autoFailed = !S.errors.has(kin.id) && stored?.error ? autoFailureLines(stored, normalizeInterval(settings.value.autoIntervalMinutes)) : null;
    const error = S.errors.get(kin.id) || autoFailed;
    const now = clock();
    return h('section', { class: 'card', 'aria-label': `${kin.name} status` },
      h('div', { class: 'card-top' },
        h('div', { class: 'toggle static' }, avatar(48), h('span', { class: 'who' }, h('span', { class: 'name' }, displayName(kin)))),
        isWorkshop && S.kins.length > 1 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Switch Kin', 'data-key': 'switch', onClick: (e) => chooseKin(e.currentTarget) }, icon('users', { size: 20 })) : null),
      h('div', { class: 'card-body' },
        h('h2', { class: 'section-title' }, 'Current status'),
        h('div', { class: 'facts', 'aria-live': 'polite' },
          h('div', { class: `fact${result ? '' : ' empty'}` },
            h('span', { class: 'row-icon' }, icon('pin', { size: 24 })),
            h('span', { class: 'fact-text' }, h('span', { class: 'row-label' }, 'Location'),
              h('span', { class: 'fact-value', 'data-testid': 'location' }, result ? result.location : 'No location read yet.'))),
          h('div', { class: `fact${result ? '' : ' empty'}` },
            h('span', { class: 'row-icon' }, icon(result ? poseIcon(result.doing) : 'person', { size: 24 })),
            h('span', { class: 'fact-text' }, h('span', { class: 'row-label' }, 'Pose and action'),
              h('span', { class: 'fact-value', 'data-testid': 'doing' }, result ? result.doing : 'No pose or action read yet.'))),
          h('div', { class: `fact${result ? '' : ' empty'}` },
            h('span', { class: 'row-icon' }, icon('hanger', { size: 24 })),
            h('span', { class: 'fact-text' }, h('span', { class: 'row-label' }, 'Outfit'),
              h('span', { class: 'fact-value', 'data-testid': 'outfit' }, result ? result.outfit : 'No outfit read yet. Press Update status.'))),
          h('div', { class: `fact${result ? '' : ' empty'}` },
            h('span', { class: 'row-icon' }, icon(/\b(up|bun|ponytail|braid|tied)\b/i.test(result?.hair || '') ? 'hair-up' : 'hair-down', { size: 24 })),
            h('span', { class: 'fact-text' }, h('span', { class: 'row-label' }, 'Hair'),
              h('span', { class: 'fact-value', 'data-testid': 'hair' }, result ? result.hair : 'No hair read yet.'))),
          h('div', { class: `fact${result ? '' : ' empty'}` },
            h('span', { class: 'row-icon' }, icon('makeup', { size: 24 })),
            h('span', { class: 'fact-text' }, h('span', { class: 'row-label' }, 'Makeup'),
              h('span', { class: 'fact-value', 'data-testid': 'makeup' }, result ? result.makeup : 'No makeup read yet.')))),
        h('button', { type: 'button', class: 'btn primary block', 'data-key': 'update', 'aria-busy': String(reading), onClick: update },
          reading ? [spinner(), isWorkshop ? (S.slow.has(kin.id) ? 'Still waiting for the Kin…' : 'Reading…') : 'Waiting for the answer…'] : [icon('refresh', { size: 18 }), 'Update status']),
        reading && S.slow.has(kin.id) ? h('p', { class: 'help', 'data-testid': 'slow-note' }, 'The Kin is taking longer than usual. This can take up to a minute. You can keep using the app.') : null,
        h('p', { class: 'meta', 'data-testid': 'last-checked' }, 'Last checked: ',
          result ? [h('time', { datetime: result.at }, formatClock(result.at, { now })), ' · ', h('span', { class: 'rel', 'data-iso': result.at }, formatRelative(result.at, now)), result.source === 'auto' ? ' · automatic' : null] : 'never'),
        error ? h('div', { class: 'banner error', role: 'alert', 'data-testid': 'banner' }, icon('alert', { size: 18 }), h('span', { class: 'banner-text' }, ...[].concat(error).map((line, i) => h('span', { class: `banner-line${i === 0 ? ' first' : ''}` }, line))),
          h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: update }, 'Try again'))
          : S.info ? h('div', { class: `banner ${S.info.kind}`, role: 'status', 'data-testid': 'banner' }, icon('refresh', { size: 18 }), h('span', { class: 'banner-text' }, S.info.text)) : null));
  }

  const toggleJournal = (flag) => async (e) => {
    const open = e.currentTarget.open;
    if (S[flag] === open) return;
    S[flag] = open;
    const kin = selectedKin();
    if (open && kin && !S.journals.has(kin.id)) { await loadJournal(kin); render(); }
    else if (open && kin) { loadJournal(kin).then(render).catch(() => {}); }
  };

  /** Workshop: the last readings of the selected Kin, newest first. Only what changed is repeated in each entry. */
  function renderHistory() {
    const kin = selectedKin();
    if (!isWorkshop || !kin) return null;
    const j = S.journals.get(kin.id);
    const now = clock();
    const LABELS = { location: 'Location', doing: 'Pose and action', outfit: 'Outfit', hair: 'Hair', makeup: 'Makeup' };
    const entries = (j?.history || []).map((e, i, all) => {
      const older = all[i + 1];
      const rows = SENTENCE_KEYS.filter((k) => e[k] && !DEFAULTS.has(e[k]) && (!older || e[k] !== older[k]));
      return h('li', { class: 'hist-item', 'data-testid': 'history-item' },
        h('p', { class: 'hist-when' }, h('time', { datetime: e.at }, formatClock(e.at, { now })), ' · ', h('span', { class: 'rel', 'data-iso': e.at }, formatRelative(e.at, now)), e.source === 'auto' ? ' · automatic' : ''),
        rows.length
          ? h('dl', { class: 'hist-rows' }, ...rows.map((k) => [h('dt', {}, LABELS[k]), h('dd', {}, e[k])]))
          : h('p', { class: 'help' }, 'Same as the reading before.'));
    });
    return h('details', { class: 'reader history', open: S.historyOpen ? '' : undefined, onToggle: toggleJournal('historyOpen') },
      h('summary', { 'data-key': 'history-summary' }, icon('history', { size: 18 }), ' History'),
      h('div', { class: 'reader-body' },
        h('div', { class: 'full' },
          !j ? h('p', { class: 'help' }, 'Loading…')
            : entries.length ? h('ol', { class: 'hist-list', role: 'list' }, ...entries)
              : h('p', { class: 'help', 'data-testid': 'history-empty' }, 'No readings yet. Each new reading (yours or automatic) is added here.'),
          h('p', { class: 'help' }, `The last ${HISTORY_MAX} readings of ${displayName(kin)} are kept in the app’s own folder; each entry shows only what changed. Automatic checks that found nothing new are not repeated.`),
          // Two presses instead of confirm(): a locked frame may not allow dialogs.
          j?.history.length ? h('button', { type: 'button', class: 'btn small ghost', 'data-key': 'history-clear', onClick: async () => {
            if (S.confirmClear !== kin.id) { S.confirmClear = kin.id; render(); return; }
            S.confirmClear = null;
            try { S.journals.set(kin.id, await clearHistory(journals, kin.id)); announce('History cleared'); } catch { S.info = { kind: 'info', text: 'Could not clear the history: the Workshop did not respond.' }; }
            render();
          } }, icon('trash', { size: 16 }), S.confirmClear === kin.id ? 'Press again to clear (the current status stays)' : 'Clear history') : null)));
  }

  /** Workshop: what the last attempts did, to check how the Kin and the platform behave. */
  function renderDiagnostics() {
    const kin = selectedKin();
    if (!kin) return null;
    const j = S.journals.get(kin.id);
    const log = j?.log || [];
    const now = clock();
    const ok = log.filter((l) => l.ok);
    const avg = ok.length ? ok.reduce((n, l) => n + (l.ms || 0), 0) / ok.length : null;
    const describe = (l) => (l.ok ? (l.unchanged ? 'ok · nothing new' : 'ok') : `failed · ${l.kind || 'unknown'}`);
    return h('details', { class: 'sub-details diagnostics', open: S.diagOpen ? '' : undefined, onToggle: toggleJournal('diagOpen') },
      h('summary', { 'data-key': 'diag-summary' }, icon('pulse', { size: 18 }), ' Diagnostics'),
      !j ? h('p', { class: 'help' }, 'Loading…') : !log.length ? h('p', { class: 'help', 'data-testid': 'diag-empty' }, `No attempts recorded for ${displayName(kin)} yet.`) : [
        h('p', { class: 'help', 'data-testid': 'diag-summary-line' }, `Last ${log.length} attempts: ${ok.length} succeeded${avg !== null ? `, answered in ${secs(avg)} on average` : ''}.`),
        h('ol', { class: 'diag-list', role: 'list' }, ...log.map((l) => h('li', { class: `diag-item${l.ok ? '' : ' failed'}`, 'data-testid': 'diag-item' },
          h('span', { class: 'diag-head' }, h('time', { datetime: l.at }, formatClock(l.at, { now })), ` · ${l.source === 'auto' ? 'automatic' : 'manual'} · `, h('strong', {}, describe(l))),
          h('span', { class: 'diag-meta' }, [`${secs(l.ms)}`, l.tries > 1 ? `${l.tries} tries` : null, l.chars !== null ? `answer ${l.chars} characters` : null, l.cut ? 'shortened on the way back (full copy stored)' : null].filter(Boolean).join(' · ')),
          l.error ? h('span', { class: 'diag-error' }, l.error) : null))),
        h('button', { type: 'button', class: 'btn small', 'data-key': 'diag-copy', onClick: async () => {
          const text = JSON.stringify({ kin: kin.name, log }, null, 1);
          try { await navigator.clipboard.writeText(text); S.info = { kind: 'ok', text: 'Diagnostics copied.' }; } catch { S.info = { kind: 'info', text: 'Copy is blocked here.' }; }
          announce(S.info.text); render();
        } }, icon('copy', { size: 16 }), 'Copy diagnostics')],
      h('p', { class: 'help' }, 'Time, size of the answer and the reason of any failure for the last attempts of the selected Kin. The Kin’s answer itself is not kept.'));
  }

  function renderReader() {
    let sceneSel;
    const kin = selectedKin();
    return h('details', { class: 'reader', open: S.readerOpen ? '' : undefined, onToggle: (e) => { S.readerOpen = e.currentTarget.open; } },
      h('summary', { 'data-key': 'reader-summary' }, 'Scene reader (local mode)'),
      h('div', { class: 'reader-body' },
        h('p', { class: 'help full' }, 'Paste a conversation, copy the prompt into any model, then paste its JSON answer. Nothing leaves this page and nothing is saved.'),
        h('div', { class: 'col-a' },
          h('label', { class: 'label', for: 'local-name' }, 'Character name'),
          h('input', { id: 'local-name', class: 'text-input', type: 'text', 'data-key': 'local-name', value: settings.value.localName, autocomplete: 'off',
            onChange: async (e) => { await settings.save({ localName: e.target.value.trim() || 'Isa' }); S.kins = [{ id: LOCAL_ID, name: settings.value.localName }]; render(); } }),
          h('label', { class: 'label', for: 'chat' }, 'Conversation'),
          h('textarea', { id: 'chat', class: 'text-input', rows: 9, 'data-key': 'chat', placeholder: 'Isa: Estou na sala, vestindo uma calça jeans azul e uma jaqueta de couro…', onInput: (e) => { S.chatDraft = e.target.value; } }, S.chatDraft),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', 'data-key': 'prepare', onClick: prepareLocal }, 'Prepare prompt')),
          S.pending ? h('div', { class: 'prompt-box' },
            h('label', { class: 'label', for: 'prompt-view' }, 'Prompt to send'),
            h('textarea', { id: 'prompt-view', class: 'text-input mono', rows: 8, readOnly: true, 'data-key': 'prompt-view' }, S.pending.prompt),
            h('div', { class: 'btn-row' },
              h('button', { type: 'button', class: 'btn', 'data-key': 'copy-prompt', onClick: async () => {
                try { await navigator.clipboard.writeText(S.pending.prompt); S.info = { kind: 'ok', text: 'Prompt copied.' }; } catch { document.querySelector('[data-key="prompt-view"]')?.select(); S.info = { kind: 'info', text: 'Copy is blocked here. The prompt is selected: press Ctrl+C.' }; }
                announce(S.info.text); render(); } }, icon('copy', { size: 16 }), 'Copy prompt'),
              h('button', { type: 'button', class: 'btn ghost', 'data-key': 'cancel-read', onClick: () => { S.reading.delete(S.pending.id); S.pending = null; S.info = { kind: 'info', text: 'The reading was cancelled.' }; render(); } }, 'Cancel'))) : null),
        h('div', { class: 'col-b' },
          h('label', { class: 'label', for: 'response' }, 'JSON answer'),
          h('textarea', { id: 'response', class: 'text-input mono', rows: 9, 'data-key': 'response', placeholder: '{"location":"in the kitchen","pose":"standing at the counter","action":"chopping onions","topwear":["a white shirt"]}', onInput: (e) => { S.responseDraft = e.target.value; } }, S.responseDraft),
          h('button', { type: 'button', class: 'btn primary', 'data-key': 'apply', onClick: () => applyLocal(S.responseDraft) }, 'Show status')),
        h('div', { class: 'full' },
          h('h3', { class: 'sub' }, 'Demo scenes'),
          h('div', { class: 'demo-row' },
            h('div', { class: 'demo-pick' }, h('label', { class: 'label', for: 'scene-pick' }, 'Scene'),
              (sceneSel = h('select', { id: 'scene-pick', class: 'text-input', 'data-key': 'scene-pick' }, ...DEMO_SCENES.map((s) => h('option', { value: s.id }, s.title))))),
            h('div', { class: 'btn-row' },
              h('button', { type: 'button', class: 'btn', 'data-key': 'demo-load', onClick: async () => { const s = DEMO_SCENES.find((x) => x.id === sceneSel.value); S.chatDraft = s.chat; S.responseDraft = s.response; S.info = { kind: 'info', text: `Loaded “${s.title}”. Prepare the prompt, then press Show status.` }; render(); } }, 'Load scene'),
              h('button', { type: 'button', class: 'btn', 'data-key': 'demo-run', onClick: async () => { const s = DEMO_SCENES.find((x) => x.id === sceneSel.value); S.chatDraft = s.chat; S.responseDraft = s.response; S.pending = { id: kin.id, prompt: buildOutfitPrompt({ name: kin.name, chat: s.chat }) }; applyLocal(s.response); } }, 'Run demo scene'))),
          renderAutoSettings(),
          renderThemePicker())));
  }

  function renderAutoSettings() {
    const on = flag(settings.value.autoUpdate, false);
    const minutes = normalizeInterval(settings.value.autoIntervalMinutes);
    const eff = effectiveMinutes(minutes);
    const ticked = new Set((settings.value.autoKins || []).map((k) => k.id));
    const kin = selectedKin();
    const stored = kin ? S.cached.get(kin.id) : null;
    // A setting the Workshop could not store is taken back (see Settings.save): say so, because the scheduled run would not see it.
    const noteSave = (ok) => { S.autoNote = ok ? null : 'Could not save this setting: the Workshop did not respond. Nothing was changed; try again.'; };
    const saveKins = (set) => settings.save({ autoKins: S.kins.filter((k) => set.has(k.id)).map((k) => ({ id: k.id, name: k.name })) });
    return h('div', { class: 'auto-block' },
      h('h3', { class: 'sub' }, 'Automatic updates'),
      isWorkshop ? null : h('p', { class: 'help' }, 'Not available in local mode. In the Kindroid Workshop the app asks the Kin on a schedule you choose here.'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', id: 'auto-enable', 'data-key': 'auto-enable', disabled: !isWorkshop, checked: isWorkshop && on,
          onChange: async (e) => {
            const enable = e.target.checked;
            if (enable && !ticked.size && kin) ticked.add(kin.id); // switching it on must ask someone: start with the selected Kin
            const ok = (await settings.save({ autoUpdate: enable })) && (!enable || (await saveKins(ticked)));
            noteSave(ok);
            announce(ok ? (enable ? 'Automatic updates on' : 'Automatic updates off') : S.autoNote); render();
          } }),
        'Update automatically'),
      h('label', { class: 'label', for: 'auto-interval' }, 'Ask every (minutes)'),
      h('input', { type: 'number', id: 'auto-interval', class: 'text-input', 'data-key': 'auto-interval', min: String(AUTO_MIN_MINUTES), max: String(AUTO_MAX_MINUTES), step: '1', value: String(minutes), disabled: !isWorkshop,
        'aria-describedby': 'auto-interval-help',
        onChange: async (e) => { const n = normalizeInterval(e.target.value); e.target.value = String(n); noteSave(await settings.save({ autoIntervalMinutes: n })); render(); } }),
      h('p', { class: 'help', id: 'auto-interval-help' }, eff === minutes
        ? `Between ${AUTO_MIN_MINUTES} minutes and 24 hours.`
        : `The Workshop wakes the app every ${SCHEDULE_TICK_MINUTES} minutes, so ${minutes} minutes behaves like ${eff}.`),
      isWorkshop && S.kins.length ? h('fieldset', { class: 'auto-kins' },
        h('legend', {}, 'Which Kins'),
        ...S.kins.map((k) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', id: `auto-kin-${k.id}`, 'data-key': `auto-kin-${k.id}`, checked: ticked.has(k.id),
            onChange: async (e) => { if (e.target.checked) ticked.add(k.id); else ticked.delete(k.id); noteSave(await saveKins(ticked)); render(); } }),
          displayName(k)))) : null,
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', id: 'auto-adaptive', 'data-key': 'auto-adaptive', disabled: !isWorkshop, checked: flag(settings.value.autoAdaptive, true),
          onChange: async (e) => { noteSave(await settings.save({ autoAdaptive: e.target.checked })); render(); } }),
        'Wait longer when nothing changes'),
      h('p', { class: 'help' }, `Each check that finds the same status doubles the wait, up to ${ADAPTIVE_MAX_FACTOR}× your interval. The first change, a failure or Update status goes back to your interval. Saves credits when the scene is quiet.`),
      isWorkshop && kin && stored?.attemptedAt ? h('p', { class: 'help', 'data-testid': 'auto-status' }, `Last check for ${displayName(kin)}: `, h('span', { class: 'rel', 'data-iso': stored.attemptedAt }, formatRelative(stored.attemptedAt, clock())), stored.error ? ' (failed)' : '') : null,
      isWorkshop && on && kin && stored && !stored.error && flag(settings.value.autoAdaptive, true) && ticked.has(kin.id) && adaptiveLine(stored, minutes) ? h('p', { class: 'help', 'data-testid': 'adaptive-status' }, adaptiveLine(stored, minutes)) : null,
      S.autoNote ? h('p', { class: 'form-error', role: 'alert', 'data-testid': 'auto-note' }, S.autoNote) : null,
      h('p', { class: 'help' }, 'Each check asks the Kin one question and uses running time from your credits. The latest reading and a short history of each Kin are kept, so they can be shown when you open the app.'));
  }

  function renderWorkshopSettings() {
    return h('details', { class: 'reader workshop-settings', open: S.readerOpen ? '' : undefined, onToggle: (e) => { S.readerOpen = e.currentTarget.open; } },
      h('summary', { 'data-key': 'reader-summary' }, 'Settings'),
      h('div', { class: 'reader-body' },
        h('div', { class: 'full' },
          h('h3', { class: 'sub' }, 'How it works'),
          h('p', { class: 'help' }, 'Update status asks the selected Kin to look at its recent chat and say where it is, how it is positioned, what it is doing, what it is wearing and how its hair and makeup look. Each answer is shown as one sentence.'),
          renderAutoSettings(),
          renderDiagnostics(),
          renderThemePicker())));
  }

  function render() {
    keepFocus(root, () => {
      const work = isWorkshop ? renderWorkshopSettings() : renderReader();
      root.replaceChildren(
        h('header', { class: 'app-head' }, h('h1', {}, 'Clotheskin'), h('p', { class: 'muted' }, 'Where your Kin is, what it is doing and what it is wearing')),
        h('div', { class: `layout${isWorkshop ? ' frame' : ''}` },
          h('div', { class: 'col-status' }, renderCard(), renderHistory()),
          h('div', { class: 'col-work' }, work)),
        h('footer', { class: 'foot muted' }, `Mode: ${host.label}`));
    });
  }

  setInterval(() => {
    for (const el of root.querySelectorAll('.rel[data-iso]')) el.textContent = formatRelative(el.dataset.iso, clock());
  }, 30000);

  if (isWorkshop) {
    await loadReading(selectedKin());
    setInterval(() => { pollReading().catch(() => {}); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollReading().catch(() => {}); });
    window.addEventListener('focus', () => { pollReading().catch(() => {}); });
  }

  render();
  return { S, render, selectedKin, pollNow: pollReading, host };
}
