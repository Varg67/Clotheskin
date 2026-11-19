import { h, keepFocus, openSheet } from './dom.js';
import { icon, spinner } from './icons.js';
import { buildOutfitPrompt } from '../core/prompt.js';
import { parseReading, describeReading, describeLocation, describeDoing, describeOutfit, poseIcon } from '../core/outfit.js';
import { formatClock, formatRelative } from '../core/format.js';
import { DEMO_SCENES } from '../demo/demo.js';

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

/**
 * The tracker: ask the Kin where it is, what it is doing and what it is wearing, and show the answer as three
 * sentences. Nothing about outfits is stored; results live in memory for the session, per Kin id.
 */
export async function startApp({ root, settings, host, clock = () => new Date() }) {
  document.documentElement.lang = 'en';
  const isWorkshop = host.id === 'workshop';
  document.body.classList.toggle('mode-workshop', isWorkshop);
  applyTheme(settings.value.theme);

  const S = {
    kins: isWorkshop ? (host.kins || []) : [{ id: LOCAL_ID, name: settings.value.localName }],
    results: new Map(), // kin id -> { location, doing, outfit, at }  (three sentences)
    errors: new Map(), // kin id -> message
    reading: new Set(), // kin ids with a reading in progress
    info: null, // { kind, text } for the selected Kin
    pending: null, // local mode: { id, prompt } waiting for the pasted answer
    responseDraft: '',
    chatDraft: '', // memory only: a pasted conversation is never written to storage
    sceneId: DEMO_SCENES[0].id, // the demo scene chosen in the list (kept across re-renders)
    readerOpen: !isWorkshop,
  };

  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  document.body.append(live);
  const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };
  /** A notice under the card. It replaces an older error of that Kin (the newer message wins) and is announced. */
  const setInfo = (kind, text, kinId = selectedKin()?.id) => { S.info = { kind, text }; S.errors.delete(kinId); announce(text); };
  /** Re-renders and puts focus on the element with this data-key (when the focused button was removed). */
  const renderAndFocus = (key) => { render(); root.querySelector(`[data-key="${key}"]`)?.focus(); };

  // ---------------------------------------------------------------- selection
  function selectedKin() {
    if (!isWorkshop) return { id: LOCAL_ID, name: settings.value.localName || 'the character' };
    const found = S.kins.find((k) => k.id === settings.value.selectedKinId);
    if (found) return found;
    return S.kins.length === 1 ? S.kins[0] : null; // several Kins: the person chooses
  }

  if (isWorkshop) {
    host.channel.onKinsChange((kins) => { S.kins = kins; render(); });
  }

  /** Where a Kin stands in this session, for the list: its last place, a reading in progress, or nothing yet. */
  function kinState(k) {
    if (S.reading.has(k.id)) return 'Reading…';
    const r = S.results.get(k.id);
    return r ? `${r.location.replace(/\.$/, '')} · ${formatRelative(r.at, clock())}` : 'Not read yet';
  }

  /** The attached Kins as buttons. Picking one makes it the only Kin the app reads until another is picked. */
  function kinList(afterPick) {
    const current = selectedKin()?.id;
    return [
      h('ul', { class: 'profile-list', role: 'list' }, ...S.kins.map((k) => h('li', {},
        h('button', { type: 'button', class: `profile-pick${k.id === current ? ' selected' : ''}`, 'aria-pressed': String(k.id === current), 'data-key': `pick-${k.id}`,
          onClick: () => { S.info = null; settings.save({ selectedKinId: k.id }); afterPick(); renderAndFocus('update'); announce(`Selected ${k.name}`); } },
        avatar(36), h('span', { class: 'pp-text' }, h('strong', {}, k.name), h('span', { class: 'muted' }, kinState(k))),
        k.id === current ? h('span', { class: 'tag' }, 'Selected') : null)))),
      h('p', { class: 'help' }, 'Only the selected Kin is read, and only when you press Update status. To attach or detach a Kin, open the app’s settings in Kindroid Apps and use Kins.'),
    ];
  }

  function chooseKin(opener) {
    openSheet({
      title: 'Select a Kin', cancelLabel: 'Close',
      onClose: () => opener?.focus?.(),
      build(body, api) { body.append(...kinList(api.close)); },
    });
  }

  // ------------------------------------------------------------------ reading
  function show(kinId, outcome) {
    if (outcome.ok) { S.results.set(kinId, { location: outcome.location, doing: outcome.doing, outfit: outcome.outfit, at: clock().toISOString() }); S.errors.delete(kinId); }
    else S.errors.set(kinId, outcome.error);
  }

  const SUMMARY_MAX = 500; // what `kin end` allows; anything longer did not come from this app's run
  const parseJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  /** The Kin a run's summary names ({"kin":"…",…}), or undefined (plain text, an error line, an older run). */
  const summaryKin = (summary) => { const o = parseJson(summary); return o && typeof o === 'object' && typeof o.kin === 'string' ? o.kin : undefined; };

  /**
   * The run ends with {"kin":"…","location":"…","doing":"…","outfit":"…"}. Plain text (an older run) is shown as the
   * outfit. Any other JSON is not a reading and becomes an error instead of being shown raw.
   */
  function readSummary(summary) {
    const text = String(summary ?? '');
    const none = { location: describeLocation(null), doing: describeDoing({}) };
    const o = parseJson(text);
    const str = (v) => typeof v === 'string' && v.length <= SUMMARY_MAX;
    if (o && typeof o === 'object' && str(o.outfit)) {
      return { ok: true, location: str(o.location) ? o.location : none.location, doing: str(o.doing) ? o.doing : none.doing, outfit: o.outfit };
    }
    if (o !== undefined || text.length > SUMMARY_MAX) return { ok: false, error: 'The reading came back in an unexpected format. Try again.' };
    return { ok: true, ...none, outfit: text || describeOutfit({}) };
  }

  /** Results of the Kin on screen go to the status region; an error is already read out by its role="alert" banner. */
  const announceResult = (id) => {
    const r = S.results.get(id);
    if (id === selectedKin()?.id && !S.errors.has(id) && r) announce(`${r.location} ${r.doing} ${r.outfit}`);
  };

  /** Workshop: the run asks the Kin about its recent chat. The reading belongs to the Kin it started for. */
  async function readInWorkshop(kin) {
    if (S.reading.has(kin.id)) return; // repeated clicks join the reading in progress
    S.reading.add(kin.id); S.info = null; render();
    try {
      // A reply naming another Kin is a late answer to an earlier run that timed out: not this reading.
      const accept = (reply) => { const k = summaryKin(reply.summary); return k === undefined || k === kin.id; };
      const r = await host.channel.runAction('read_outfit', { kin: kin.id, name: kin.name }, { accept });
      show(kin.id, r.ok ? readSummary(r.summary) : { ok: false, error: r.summary || 'The reading could not be completed.' });
    } catch (e) {
      show(kin.id, { ok: false, error: e.message });
    }
    S.reading.delete(kin.id);
    announceResult(kin.id);
    render();
  }

  /** Local mode: build the prompt from the pasted chat, then wait for the pasted JSON answer. */
  function prepareLocal() {
    const chat = S.chatDraft.trim();
    if (!chat) { setInfo('info', 'Paste a conversation in the scene reader first.'); S.readerOpen = true; renderAndFocus('chat'); return; }
    const kin = selectedKin();
    S.pending = { id: kin.id, chat, prompt: buildOutfitPrompt({ name: kin.name, chat }) };
    S.reading.add(kin.id); S.info = null; S.errors.delete(kin.id); S.readerOpen = true; render();
  }

  function applyLocal(text) {
    const kin = selectedKin();
    const id = S.pending?.id ?? kin.id; // the answer belongs to the Kin the question was prepared for
    const parsed = parseReading(text);
    show(id, parsed.ok ? { ok: true, ...describeReading(parsed) } : { ok: false, error: `${parsed.error} Nothing was changed.` });
    S.info = null;
    if (parsed.ok) { S.pending = null; S.reading.delete(id); S.responseDraft = ''; } // a typo keeps the prompt: fix the answer and retry
    announceResult(id);
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
      if (S.kins.length === 0) {
        return h('section', { class: 'card empty' },
          h('div', { class: 'empty-art' }, icon('users', { size: 40 })),
          h('h2', {}, 'Select a Kin'),
          h('p', { class: 'muted' }, 'No Kin is attached to this app yet. In Apps, open Clotheskin’s settings, go to Kins and tick the Kins you want to track.'));
      }
      // Several Kins and none chosen: the list is the screen, so one tap picks the Kin of the current roleplay.
      return h('section', { class: 'card picker', 'aria-labelledby': 'picker-title' },
        h('h2', { id: 'picker-title' }, 'Select a Kin'),
        h('p', { class: 'muted' }, 'Which Kin is in your roleplay now?'),
        ...kinList(() => {}));
    }
    const reading = S.reading.has(kin.id);
    const result = S.results.get(kin.id);
    const error = S.errors.get(kin.id);
    const now = clock();
    return h('section', { class: 'card', 'aria-label': `${kin.name} status` },
      h('div', { class: 'card-top' },
        h('div', { class: 'toggle static' }, avatar(48), h('span', { class: 'who' }, h('span', { class: 'name' }, kin.name),
          isWorkshop && S.kins.length > 1 ? h('span', { class: 'muted small', 'data-testid': 'only-this' }, `Only this Kin is read · ${S.kins.length - 1} other${S.kins.length > 2 ? 's' : ''} attached`) : null)),
        isWorkshop && S.kins.length > 1 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Switch Kin', 'data-key': 'switch', onClick: (e) => chooseKin(e.currentTarget) }, icon('users', { size: 20 })) : null),
      h('div', { class: 'card-body' },
        h('h2', { class: 'section-title' }, 'Current status'),
        h('div', { class: 'facts' },
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
              h('span', { class: 'fact-value', 'data-testid': 'outfit' }, result ? result.outfit : 'No outfit read yet. Press Update status.')))),
        h('button', { type: 'button', class: 'btn primary block', 'data-key': 'update', 'aria-busy': String(reading), onClick: update },
          reading ? [spinner(), isWorkshop ? 'Reading…' : 'Waiting for the answer…'] : [icon('refresh', { size: 18 }), 'Update status']),
        h('p', { class: 'meta', 'data-testid': 'last-checked' }, 'Last checked: ',
          result ? [h('time', { datetime: result.at }, formatClock(result.at, { now })), ' · ', h('span', { class: 'rel', 'data-iso': result.at }, formatRelative(result.at, now))] : 'never'),
        error ? h('div', { class: 'banner error', role: 'alert', 'data-testid': 'banner' }, icon('alert', { size: 18 }), h('span', { class: 'banner-text' }, error),
          h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: update }, 'Try again'))
          : S.info ? h('div', { class: `banner ${S.info.kind}`, role: 'status', 'data-testid': 'banner' }, icon('refresh', { size: 18 }), h('span', { class: 'banner-text' }, S.info.text)) : null));
  }

  const scene = () => DEMO_SCENES.find((x) => x.id === S.sceneId) || DEMO_SCENES[0];

  function renderReader() {
    const kin = selectedKin();
    return h('details', { class: 'reader', open: S.readerOpen ? '' : undefined, onToggle: (e) => { S.readerOpen = e.currentTarget.open; } },
      h('summary', { 'data-key': 'reader-summary' }, 'Scene reader (local mode)'),
      h('div', { class: 'reader-body' },
        h('p', { class: 'help full' }, 'Paste a conversation, copy the prompt into any model, then paste its JSON answer. Nothing leaves this page and nothing is saved.'),
        h('div', { class: 'col-a' },
          h('label', { class: 'label', for: 'local-name' }, 'Character name'),
          h('input', { id: 'local-name', class: 'text-input', type: 'text', 'data-key': 'local-name', value: settings.value.localName, autocomplete: 'off',
            onChange: (e) => {
              settings.save({ localName: e.target.value.trim() || 'Isa' });
              S.kins = [{ id: LOCAL_ID, name: settings.value.localName }];
              if (S.pending) S.pending.prompt = buildOutfitPrompt({ name: settings.value.localName, chat: S.pending.chat });
              setTimeout(render); // after the focus has moved on (Tab), so keepFocus restores it there
            } }),
          h('label', { class: 'label', for: 'chat' }, 'Conversation'),
          h('textarea', { id: 'chat', class: 'text-input', rows: 9, 'data-key': 'chat', placeholder: 'Isa: Estou na sala, vestindo uma calça jeans azul e uma jaqueta de couro…', onInput: (e) => { S.chatDraft = e.target.value; } }, S.chatDraft),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', 'data-key': 'prepare', onClick: prepareLocal }, 'Prepare prompt')),
          S.pending ? h('div', { class: 'prompt-box' },
            h('label', { class: 'label', for: 'prompt-view' }, 'Prompt to send'),
            h('textarea', { id: 'prompt-view', class: 'text-input mono', rows: 8, readOnly: true, 'data-key': 'prompt-view' }, S.pending.prompt),
            h('div', { class: 'btn-row' },
              h('button', { type: 'button', class: 'btn', 'data-key': 'copy-prompt', onClick: async () => {
                try { await navigator.clipboard.writeText(S.pending.prompt); setInfo('ok', 'Prompt copied.'); } catch { document.querySelector('[data-key="prompt-view"]')?.select(); setInfo('info', 'Copy is blocked here. The prompt is selected: press Ctrl+C.'); }
                render(); } }, icon('copy', { size: 16 }), 'Copy prompt'),
              h('button', { type: 'button', class: 'btn ghost', 'data-key': 'cancel-read', onClick: () => { S.reading.delete(S.pending.id); S.pending = null; setInfo('info', 'The reading was cancelled.'); renderAndFocus('prepare'); } }, 'Cancel'))) : null),
        h('div', { class: 'col-b' },
          h('label', { class: 'label', for: 'response' }, 'JSON answer'),
          h('textarea', { id: 'response', class: 'text-input mono', rows: 9, 'data-key': 'response', placeholder: '{"location":"in the kitchen","pose":"standing at the counter","action":"chopping onions","topwear":["a white shirt"]}', onInput: (e) => { S.responseDraft = e.target.value; } }, S.responseDraft),
          h('button', { type: 'button', class: 'btn primary', 'data-key': 'apply', onClick: () => applyLocal(S.responseDraft) }, 'Show status')),
        h('div', { class: 'full' },
          h('h3', { class: 'sub' }, 'Demo scenes'),
          h('div', { class: 'demo-row' },
            h('div', { class: 'demo-pick' }, h('label', { class: 'label', for: 'scene-pick' }, 'Scene'),
              h('select', { id: 'scene-pick', class: 'text-input', 'data-key': 'scene-pick', onChange: (e) => { S.sceneId = e.target.value; } },
                ...DEMO_SCENES.map((s) => h('option', { value: s.id, selected: s.id === S.sceneId ? '' : undefined }, s.title)))),
            h('div', { class: 'btn-row' },
              h('button', { type: 'button', class: 'btn', 'data-key': 'demo-load', onClick: () => { const s = scene(); S.chatDraft = s.chat; S.responseDraft = s.response; setInfo('info', `Loaded “${s.title}”. Prepare the prompt, then press Show status.`); render(); } }, 'Load scene'),
              h('button', { type: 'button', class: 'btn', 'data-key': 'demo-run', onClick: () => { const s = scene(); S.chatDraft = s.chat; S.responseDraft = s.response; S.pending = { id: kin.id, chat: s.chat, prompt: buildOutfitPrompt({ name: kin.name, chat: s.chat }) }; applyLocal(s.response); } }, 'Run demo scene'))),
          renderThemePicker())));
  }

  function renderWorkshopSettings() {
    return h('details', { class: 'reader workshop-settings', open: S.readerOpen ? '' : undefined, onToggle: (e) => { S.readerOpen = e.currentTarget.open; } },
      h('summary', { 'data-key': 'reader-summary' }, 'Settings'),
      h('div', { class: 'reader-body' },
        h('div', { class: 'full' },
          h('h3', { class: 'sub' }, 'How it works'),
          h('p', { class: 'help' }, 'Update status asks the selected Kin to look at its recent chat and say where it is, how it is positioned, what it is doing and what it is wearing. Each answer is shown as one sentence. Nothing is saved.'),
          renderThemePicker())));
  }

  function render() {
    keepFocus(root, () => {
      const work = isWorkshop ? renderWorkshopSettings() : renderReader();
      root.replaceChildren(
        h('header', { class: 'app-head' }, h('h1', {}, 'Clotheskin'), h('p', { class: 'muted' }, 'Where your Kin is, what it is doing and what it is wearing')),
        h('div', { class: `layout${isWorkshop ? ' frame' : ''}` },
          h('div', { class: 'col-status' }, renderCard()),
          h('div', { class: 'col-work' }, work)),
        h('footer', { class: 'foot muted' }, `Mode: ${host.label}`));
    });
  }

  setInterval(() => {
    for (const el of root.querySelectorAll('.rel[data-iso]')) el.textContent = formatRelative(el.dataset.iso, clock());
  }, 30000);

  render();
  return { S, render, selectedKin };
}
