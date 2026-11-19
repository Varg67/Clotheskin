import { h, keepFocus } from './dom.js';
import { icon, spinner } from './icons.js';
import { avatarNode, openFieldEditor, openItemsEditor, openProfileSheet, saveManualEdit } from './editors.js';
import { ReadCoordinator, ManualProvider } from '../core/reader.js';
import { DEFAULT_EXTRACTION_PROMPT } from '../core/prompt.js';
import { parseConversation } from '../core/messages.js';
import { displayValue } from '../core/model.js';
import { dismissUnresolved } from '../core/apply.js';
import { canonicalName } from '../core/text.js';
import { formatClock, formatRelative } from '../core/format.js';
import {
  lookSummary, accessorySummary, hairIcon, postureIcon, clothingCount, accessoryItems,
} from '../core/summary.js';
import { DEMO_SCENES, DEMO_PROFILE_ID, seedDemo } from '../demo/demo.js';

const REQUIRED_PLACEHOLDERS = ['{{target_character}}', '{{previous_state_json}}', '{{speaker_labeled_messages}}'];

export async function startApp({ root, repo, host, clock = () => new Date() }) {
  document.documentElement.lang = 'en';
  const provider = new ManualProvider();
  const S = {
    settings: await repo.getSettings(),
    profiles: [],
    profile: null,
    record: null,
    reading: false,
    banner: null, // { kind: 'info'|'error'|'ok', text }
    lastResult: null,
    pending: null,
    responseDraft: '',
    readerOpen: true, // desktop: the workspace is visible by default
    promptEditor: false,
  };

  await seedDemo(repo);
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  document.body.append(live);
  const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };

  const coordinator = new ReadCoordinator({
    repo, provider, clock,
    getPromptTemplate: () => S.settings.promptOverride || DEFAULT_EXTRACTION_PROMPT,
    onChange: async (ev) => {
      if (ev.type === 'started' && ev.ticket?.profileId === S.profile?.id) { S.reading = true; render(); }
      if (ev.type === 'finished') {
        S.reading = coordinator.inflight.size > 0 && S.profile ? coordinator.isReading(S.profile.id, S.settings.conversationId || null) : false;
        await refresh();
      }
    },
  });
  provider.subscribe((p) => { S.pending = p; render(); });

  // ------------------------------------------------------------- data loading
  async function refresh() {
    S.profiles = await repo.listProfiles();
    if (S.settings.selectedProfileId && !S.profiles.some((p) => p.id === S.settings.selectedProfileId)) {
      S.settings = await repo.saveSettings({ selectedProfileId: null });
    }
    S.profile = S.profiles.find((p) => p.id === S.settings.selectedProfileId) || null;
    S.record = S.profile ? await repo.getRecord(S.profile.id, S.settings.conversationId || null) : null;
    S.reading = S.profile ? coordinator.isReading(S.profile.id, S.settings.conversationId || null) : false;
    render();
  }

  async function selectProfile(id) {
    S.settings = await repo.saveSettings({ selectedProfileId: id });
    S.banner = null; S.lastResult = null;
    await refresh();
    announce(id ? `Selected ${S.profile?.name}` : 'No companion selected');
  }

  if (!S.settings.firstRunDone) {
    S.settings = await repo.saveSettings({ selectedProfileId: DEMO_PROFILE_ID, firstRunDone: true });
  }

  // ------------------------------------------------------------------ actions
  const convId = () => S.settings.conversationId || null;
  const draftText = () => (S.profile ? S.settings.drafts?.[S.profile.id] || '' : '');

  async function setDraft(text) {
    if (!S.profile) return;
    S.settings.drafts = { ...(S.settings.drafts || {}), [S.profile.id]: text };
    await repo.saveSettings({ drafts: S.settings.drafts });
  }

  function openPicker(opener) {
    openProfileSheet({
      repo, profiles: S.profiles, selectedId: S.profile?.id || null, opener,
      onSelect: (id) => { selectProfile(id); }, onChanged: refresh,
    });
  }

  async function startReading({ force = false, demoOnly = false } = {}) {
    if (!S.profile) { openPicker(); return; }
    const messages = parseConversation(draftText());
    if (!messages.length) {
      S.banner = { kind: 'info', text: 'Paste a conversation in the scene reader first.' };
      S.readerOpen = true; render();
      document.querySelector('[data-key="conversation"]')?.focus();
      return;
    }
    S.banner = null;
    const result = coordinator.read({ profileId: S.profile.id, conversationId: convId(), messages, force, demoOnly });
    S.reading = true; S.readerOpen = true; render();
    handleResult(await result);
  }

  function handleResult(res) {
    S.lastResult = res;
    if (res.status === 'ok') {
      S.banner = { kind: 'ok', text: res.message + (res.skipped?.length ? ` ${res.skipped.length} change(s) skipped.` : '') };
      S.responseDraft = '';
    } else if (res.status === 'nothing-new') {
      S.banner = { kind: 'info', text: `${res.message} Use “Read again” to process them anyway.` };
    } else if (res.status === 'error') {
      S.banner = { kind: 'error', text: res.message };
    } else if (res.status === 'cancelled' || res.status === 'discarded') {
      S.banner = { kind: 'info', text: res.message };
    }
    S.reading = false;
    announce(S.banner?.text || '');
    refresh();
  }

  async function applyResponse() {
    const text = S.responseDraft;
    if (!S.profile) { openPicker(); return; }
    if (S.pending) { provider.resolve(text); return; }
    const messages = parseConversation(draftText());
    const msgs = messages.length ? messages : [{ id: `manual-${Date.now()}`, speaker: 'Pasted response', text: '(response applied without a conversation)' }];
    provider.preload(text);
    S.reading = true; render();
    handleResult(await coordinator.read({ profileId: S.profile.id, conversationId: convId(), messages: msgs, force: true }));
  }

  async function runDemoScene(id, { run }) {
    const scene = DEMO_SCENES.find((s) => s.id === id);
    if (!scene) return;
    await setDraft(scene.conversation);
    S.responseDraft = scene.response;
    if (!run) { S.banner = { kind: 'info', text: `Loaded demo scene “${scene.title}”. Update status, then apply the demo response.` }; render(); return; }
    if (!S.profile?.demo) {
      S.banner = { kind: 'error', text: 'Demo responses only update the demo profile. Select Isa (demo) to try them.' };
      render(); return;
    }
    provider.preload(scene.response);
    S.reading = true; render();
    handleResult(await coordinator.read({ profileId: S.profile.id, conversationId: convId(), messages: parseConversation(scene.conversation), force: true, demoOnly: true }));
  }

  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); S.banner = { kind: 'ok', text: okMsg }; }
    catch {
      const ta = document.querySelector('[data-key="prompt-view"]');
      ta?.select();
      S.banner = { kind: 'info', text: 'Copy is blocked here. The prompt is selected: press Ctrl+C (or ⌘C).' };
    }
    announce(S.banner.text); render();
  }

  // ---------------------------------------------------------------- rendering
  const placeFor = () => {
    const v = S.record?.fields.location.value;
    if (!v) return null;
    return (S.profile.places || []).find((p) => canonicalName(p.name) === canonicalName(v)) || null;
  };

  function rowButton({ key, iconName, label, value, onClick, unknown }) {
    return h('li', {}, h('button', { type: 'button', class: 'row', 'data-key': key, onClick: (e) => onClick(e.currentTarget),
      'aria-label': `${label}: ${value}. Edit` },
      h('span', { class: 'row-icon' }, icon(iconName, { size: 24 })),
      h('span', { class: 'row-text' }, h('span', { class: 'row-label' }, label), h('span', { class: `row-value${unknown ? ' unknown' : ''}` }, value)),
      icon('chevron-right', { size: 18, cls: 'row-chev' })));
  }

  function renderCard() {
    const r = S.record;
    if (!S.profile) {
      return h('section', { class: 'card empty' },
        h('div', { class: 'empty-art' }, icon('users', { size: 40 })),
        h('h2', {}, 'Select a companion'),
        h('p', { class: 'muted' }, 'Choose or create a companion before reading a scene. Each companion keeps its own wardrobe and scene.'),
        h('button', { type: 'button', class: 'btn primary', 'data-key': 'select-companion', onClick: (e) => openPicker(e.currentTarget) }, 'Select a companion'));
    }
    const expanded = S.settings.expanded !== false;
    const loc = displayValue('location', r.fields.location.value);
    const look = lookSummary(r);
    const acc = accessorySummary(r);
    const place = placeFor();

    const header = h('div', { class: 'card-top' },
      h('button', { type: 'button', class: 'toggle', 'aria-expanded': String(expanded), 'aria-controls': 'card-body', 'data-key': 'toggle',
        onClick: async () => { S.settings = await repo.saveSettings({ expanded: !expanded }); render(); } },
      avatarNode(S.profile, 48),
      h('span', { class: 'who' },
        h('span', { class: 'name' }, S.profile.name, S.profile.demo ? h('span', { class: 'tag' }, 'Demo') : null),
        h('span', { class: 'last-loc' }, icon('pin', { size: 14 }), h('span', { class: 'sr-only' }, 'Last known location: '), loc)),
      icon('chevron-down', { size: 22, cls: `chev${expanded ? ' open' : ''}` })),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Switch companion', 'data-key': 'switch', onClick: (e) => openPicker(e.currentTarget) }, icon('users', { size: 20 })));

    const body = h('div', { id: 'card-body', class: 'card-body', hidden: expanded ? undefined : '' },
      h('h2', { class: 'section-title' }, 'Current status'),
      h('button', { type: 'button', class: `hero${place?.imageUrl ? ' has-img' : ''}`, 'data-key': 'hero', 'aria-label': `Location: ${loc}. Edit`,
        onClick: (e) => openFieldEditor({ field: 'location', record: r, profile: S.profile, repo, onSaved: refresh, opener: e.currentTarget }) },
      place?.imageUrl ? h('img', { class: 'hero-img', src: place.imageUrl, alt: '', onError: (e) => e.target.remove() }) : null,
      h('span', { class: 'hero-scrim' }),
      h('span', { class: 'hero-label' }, h('span', { class: 'hero-kicker' }, icon('pin', { size: 16 }), 'Location'), h('span', { class: 'hero-name' }, loc))),
      h('p', { class: `look${look ? '' : ' unknown'}`, 'data-testid': 'look' }, look || 'Look unknown'),
      h('ul', { class: 'rows' },
        rowButton({ key: 'row-clothing', iconName: 'hanger', label: 'Clothing', value: look ? `${clothingCount(r)} piece${clothingCount(r) === 1 ? '' : 's'}` : 'Unknown', unknown: !look,
          onClick: (o) => openItemsEditor({ mode: 'clothing', record: r, repo, onSaved: refresh, opener: o }) }),
        rowButton({ key: 'row-accessories', iconName: 'glasses', label: 'Accessories', value: acc ?? 'Unknown', unknown: acc === null,
          onClick: (o) => openItemsEditor({ mode: 'accessories', record: r, repo, onSaved: refresh, opener: o }) }),
        rowButton({ key: 'row-hair', iconName: hairIcon(r.fields.hair.value), label: 'Hair', value: displayValue('hair', r.fields.hair.value), unknown: r.fields.hair.value === null,
          onClick: (o) => openFieldEditor({ field: 'hair', record: r, profile: S.profile, repo, onSaved: refresh, opener: o }) }),
        rowButton({ key: 'row-makeup', iconName: 'makeup', label: 'Makeup', value: displayValue('makeup', r.fields.makeup.value), unknown: r.fields.makeup.value === null,
          onClick: (o) => openFieldEditor({ field: 'makeup', record: r, profile: S.profile, repo, onSaved: refresh, opener: o }) }),
        rowButton({ key: 'row-position', iconName: postureIcon(r.fields.position.value), label: 'Posture', value: displayValue('position', r.fields.position.value), unknown: r.fields.position.value === null,
          onClick: (o) => openFieldEditor({ field: 'position', record: r, profile: S.profile, repo, onSaved: refresh, opener: o }) })),
      renderUnresolved(),
      h('button', { type: 'button', class: 'btn primary block', 'data-key': 'update', 'aria-busy': String(S.reading), onClick: () => startReading() },
        S.reading ? [spinner(), 'Reading…'] : [icon('refresh', { size: 18 }), 'Update status']),
      renderMeta(),
      renderBanner());
    return h('section', { class: 'card', 'aria-label': `${S.profile.name} scene status` }, header, body);
  }

  function renderMeta() {
    const r = S.record;
    const now = clock();
    const meta = [];
    meta.push(h('p', { class: 'meta', 'data-testid': 'last-checked' },
      'Last checked: ',
      r.lastRead ? [h('time', { datetime: r.lastRead.at }, formatClock(r.lastRead.at, { now })), ' · ', h('span', { class: 'rel', 'data-iso': r.lastRead.at }, formatRelative(r.lastRead.at, now))] : 'never'));
    if (r.lastManualEditAt) {
      meta.push(h('p', { class: 'meta' }, 'Edited manually: ', h('time', { datetime: r.lastManualEditAt }, formatClock(r.lastManualEditAt, { now })), ' · ',
        h('span', { class: 'rel', 'data-iso': r.lastManualEditAt }, formatRelative(r.lastManualEditAt, now))));
    }
    return h('div', {}, ...meta);
  }

  function renderBanner() {
    const err = S.record?.lastError;
    const b = S.banner || (err ? { kind: 'error', text: err.message } : null);
    if (!b) return null;
    return h('div', { class: `banner ${b.kind}`, role: b.kind === 'error' ? 'alert' : 'status', 'data-testid': 'banner' },
      icon(b.kind === 'error' ? 'alert' : b.kind === 'ok' ? 'check' : 'refresh', { size: 18 }),
      h('span', { class: 'banner-text' }, b.text),
      b.kind === 'error' ? h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: () => (S.pending ? (S.readerOpen = true, render()) : startReading({ force: true })) }, 'Try again') : null);
  }

  function renderUnresolved() {
    const list = S.record?.unresolved || [];
    if (!list.length) return null;
    return h('div', { class: 'review', 'data-testid': 'review' },
      h('h3', {}, icon('alert', { size: 16 }), 'Needs review'),
      h('ul', {}, ...list.map((u) => h('li', {},
        h('span', {}, u.note),
        h('button', { type: 'button', class: 'btn ghost small', 'aria-label': `Dismiss: ${u.note}`, onClick: async () => {
          await repo.updateRecord(S.profile.id, convId(), (latest) => ({ record: dismissUnresolved(latest, u.id) }));
          refresh();
        } }, 'Dismiss')))));
  }

  function renderReader() {
    if (!S.profile) return null;
    const demo = S.profile.demo;
    const autoOk = host.capabilities.autoUpdate;
    let sceneSel;
    return h('details', { class: 'reader', open: S.readerOpen ? '' : undefined, onToggle: (e) => { S.readerOpen = e.currentTarget.open; } },
      h('summary', { 'data-key': 'reader-summary' }, 'Scene reader (local mode)'),
      h('div', { class: 'reader-body' },
        h('p', { class: 'help full' }, 'Paste a conversation as “Name: message”, copy the prompt into your model, then paste its JSON answer here. Nothing leaves this page.'),
        h('div', { class: 'col-a' },
        h('label', { class: 'label', for: 'conversation' }, 'Conversation'),
        h('textarea', { id: 'conversation', class: 'text-input', rows: 9, 'data-key': 'conversation', placeholder: 'Isa: *sits on the sofa* I put on a green cardigan…', onInput: (e) => setDraft(e.target.value) }, draftText()),
        h('label', { class: 'label', for: 'conv-id' }, 'Conversation ID (optional)'),
        h('input', { id: 'conv-id', class: 'text-input', type: 'text', 'data-key': 'conv-id', value: S.settings.conversationId || '', placeholder: 'Leave empty if your host gives none', autocomplete: 'off',
          onChange: async (e) => { S.settings = await repo.saveSettings({ conversationId: e.target.value.trim() }); S.banner = null; await refresh(); } }),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', 'data-key': 'prepare', disabled: S.reading && !!S.pending, onClick: () => startReading() }, 'Prepare prompt'),
          h('button', { type: 'button', class: 'btn ghost', 'data-key': 'read-again', onClick: () => startReading({ force: true }) }, 'Read again')),
        S.pending ? h('div', { class: 'prompt-box' },
          h('label', { class: 'label', for: 'prompt-view' }, 'Prompt to send'),
          h('textarea', { id: 'prompt-view', class: 'text-input mono', rows: 8, readOnly: true, 'data-key': 'prompt-view' }, S.pending.prompt),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn', 'data-key': 'copy-prompt', onClick: () => copyText(S.pending.prompt, 'Prompt copied.') }, icon('copy', { size: 16 }), 'Copy prompt'),
            h('button', { type: 'button', class: 'btn ghost', 'data-key': 'cancel-read', onClick: () => provider.cancel() }, 'Cancel reading'))) : null),
        h('div', { class: 'col-b' },
        h('label', { class: 'label', for: 'response' }, 'JSON response'),
        h('textarea', { id: 'response', class: 'text-input mono', rows: 9, 'data-key': 'response', placeholder: '{"state_updates": {}, "item_changes": [], "unresolved": []}', onInput: (e) => { S.responseDraft = e.target.value; } }, S.responseDraft),
        h('button', { type: 'button', class: 'btn primary', 'data-key': 'apply', onClick: applyResponse }, 'Apply response'),
),
        h('div', { class: 'full' },
        h('h3', { class: 'sub' }, 'Demo scenes'),
        h('p', { class: 'help' }, 'Responses are marked as demo responses and only update the Isa demo profile.'),
        h('div', { class: 'demo-row' },
        h('div', { class: 'demo-pick' }, h('label', { class: 'label', for: 'scene-pick' }, 'Scene'),
          (sceneSel = h('select', { id: 'scene-pick', class: 'text-input', 'data-key': 'scene-pick' }, ...DEMO_SCENES.map((s) => h('option', { value: s.id }, s.title))))),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', 'data-key': 'demo-load', onClick: () => runDemoScene(sceneSel.value, { run: false }) }, 'Load scene'),
          h('button', { type: 'button', class: 'btn', 'data-key': 'demo-run', onClick: () => runDemoScene(sceneSel.value, { run: true }) }, 'Run demo scene'),
          demo ? h('button', { type: 'button', class: 'btn ghost', 'data-key': 'demo-reset', onClick: async () => { await seedDemo(repo, { reset: true, now: clock().toISOString() }); S.banner = { kind: 'info', text: 'Demo profile reset.' }; await refresh(); } }, 'Reset demo') : null)),
        h('h3', { class: 'sub' }, 'Automatic updates'),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', 'data-key': 'auto', disabled: !autoOk, checked: autoOk && S.settings.autoUpdate, onChange: async (e) => { S.settings = await repo.saveSettings({ autoUpdate: e.target.checked }); } }),
          'Update after each complete Kin reply'),
        autoOk ? null : h('p', { class: 'help' }, 'Unavailable in local mode. It needs a Workshop host that reports when the Kin’s reply is complete. This has not been confirmed yet.'),

        h('details', { class: 'sub-details', open: S.promptEditor ? '' : undefined, onToggle: (e) => { S.promptEditor = e.currentTarget.open; } },
          h('summary', {}, 'Extraction prompt'),
          renderPromptEditor()),
        renderHistory())));
  }

  function renderPromptEditor() {
    const ta = h('textarea', { id: 'prompt-tpl', class: 'text-input mono', rows: 10, 'data-key': 'prompt-tpl', 'aria-label': 'Extraction prompt template' }, S.settings.promptOverride || DEFAULT_EXTRACTION_PROMPT);
    const msg = h('p', { class: 'form-error', role: 'alert', hidden: '' });
    return h('div', {}, h('p', { class: 'help' }, 'Keep the three placeholders {{target_character}}, {{previous_state_json}} and {{speaker_labeled_messages}}. {{operation_contract}} is filled in automatically.'),
      ta, msg,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onClick: async () => {
          const missing = REQUIRED_PLACEHOLDERS.filter((p) => !ta.value.includes(p));
          if (missing.length) { msg.textContent = `The prompt must keep: ${missing.join(', ')}`; msg.hidden = false; return; }
          S.settings = await repo.saveSettings({ promptOverride: ta.value === DEFAULT_EXTRACTION_PROMPT ? null : ta.value });
          msg.hidden = true; announce('Prompt saved'); render();
        } }, 'Save prompt'),
        h('button', { type: 'button', class: 'btn ghost', onClick: async () => { S.settings = await repo.saveSettings({ promptOverride: null }); render(); } }, 'Reset to default')));
  }

  function renderHistory() {
    const items = [...(S.record?.history || [])].reverse().slice(0, 8);
    if (!items.length) return null;
    const now = clock();
    return h('details', { class: 'sub-details' },
      h('summary', {}, 'Recent updates'),
      h('ul', { class: 'history' }, ...items.map((e) => h('li', {},
        h('span', { class: 'hist-head' }, h('span', { class: 'tag' }, e.source === 'manual' ? 'Manual' : e.source === 'demo' ? 'Demo' : 'Scene'), ' ', formatClock(e.at, { now })),
        h('ul', {}, ...e.summary.map((s) => h('li', {}, s)), ...e.skipped.map((s) => h('li', { class: 'muted' }, `Skipped — ${s}`)))))));
  }

  function render() {
    keepFocus(root, () => {
      const work = renderReader();
      root.replaceChildren(
        h('header', { class: 'app-head' }, h('h1', {}, 'Clotheskin'), h('p', { class: 'muted' }, 'Visual continuity for your companions')),
        h('div', { class: `layout${work ? '' : ' solo'}` },
          h('div', { class: 'col-status' }, renderCard()),
          work ? h('div', { class: 'col-work' }, work) : null),
        h('footer', { class: 'foot muted' }, `Mode: ${host.label}`));
    });
  }

  setInterval(() => {
    for (const el of root.querySelectorAll('.rel[data-iso]')) el.textContent = formatRelative(el.dataset.iso, clock());
  }, 30000);

  await refresh();
  return { refresh, S, coordinator, provider, selectProfile };
}
