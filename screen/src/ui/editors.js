import { h, keepFocus, openSheet } from './dom.js';
import { icon } from './icons.js';
import {
  CLOTHING_SLOTS, ACCESSORY_SLOTS, SLOT_LABELS, SIDES, FIELD_LABELS, slotCategory,
} from '../core/constants.js';
import { getList, setList, contentsOf, describePlace, displayValue } from '../core/model.js';
import { manualOp, mergeManualEdit, OpSkip } from '../core/apply.js';
import { canonicalName, cleanString } from '../core/text.js';
import { itemLabel } from '../core/summary.js';

const NOW = () => new Date().toISOString();

/** Saves `draft` against the latest stored record, merging only what changed. */
export async function saveManualEdit(repo, original, draft) {
  return repo.updateRecord(original.profileId, original.conversationId, (latest) =>
    mergeManualEdit(latest, original, draft, { now: NOW() }));
}

// --------------------------------------------------------------- image helper

/** Reads a local image and shrinks it so it fits comfortably in local storage. */
export function fileToDataUrl(file, maxSide = 720) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a supported image.'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------------------ text fields

const HINTS = {
  hair: { placeholder: 'e.g. low bun, loose, wet', help: 'Describe the current hairstyle or condition. Leave empty for unknown.' },
  makeup: { placeholder: 'e.g. red lipstick, light mascara', help: 'Use "No makeup" only when the scene confirms it. Leave empty for unknown.' },
  position: { placeholder: 'e.g. sitting on the sofa', help: 'The physical posture right now.' },
  location: { placeholder: 'e.g. living room at the shared house', help: 'The place where the scene is happening now.' },
};

export function openFieldEditor({ field, record, profile, repo, onSaved, opener }) {
  const draft = structuredClone(record);
  const cur = draft.fields[field];
  const hint = HINTS[field];
  let placeImage;
  const place = () => (profile.places || []).find((p) => canonicalName(p.name) === canonicalName(input.value));
  const input = h('input', {
    type: 'text', id: 'field-input', 'data-key': 'field-input', class: 'text-input', autocomplete: 'off',
    placeholder: hint.placeholder, list: field === 'location' ? 'places-list' : undefined,
    value: field === 'makeup' && cur.value === 'none' ? 'none' : cur.value ?? '',
  });
  const imgPreview = h('div', { class: 'place-preview' });
  const urlInput = h('input', { type: 'url', class: 'text-input', id: 'place-url', placeholder: 'https://… (optional)', 'aria-label': 'Image address' });
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', id: 'place-file', 'aria-label': 'Choose an image file',
    onChange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try { placeImage = await fileToDataUrl(f); urlInput.value = ''; drawPreview(); sheet.api.setError(''); } catch (err) { sheet.api.setError(err.message); }
    },
  });
  const drawPreview = () => {
    imgPreview.replaceChildren();
    const src = placeImage !== undefined ? placeImage : place()?.imageUrl;
    if (src) imgPreview.append(h('img', { src, alt: `Picture of ${input.value || 'the place'}`, onError: (e) => e.target.replaceWith(icon('image', { size: 28 })) }));
    else imgPreview.append(icon('pin', { size: 28 }), h('span', {}, 'No image yet. A simple background is used.'));
  };
  const sheet = openSheet({
    title: `Edit ${FIELD_LABELS[field].toLowerCase()}`,
    onClose: () => opener?.focus?.(),
    build(body) {
      body.append(
        h('label', { for: 'field-input', class: 'label' }, FIELD_LABELS[field]),
        input,
        h('p', { class: 'help' }, hint.help),
      );
      if (field === 'makeup') {
        body.append(h('div', { class: 'chip-row' },
          h('button', { type: 'button', class: 'chip', onClick: () => { input.value = 'none'; input.focus(); } }, 'No makeup'),
          h('button', { type: 'button', class: 'chip', onClick: () => { input.value = ''; input.focus(); } }, 'Unknown')));
      }
      if (field === 'location') {
        body.append(h('datalist', { id: 'places-list' }, ...(profile.places || []).map((p) => h('option', { value: p.name }))));
        urlInput.addEventListener('input', () => { placeImage = urlInput.value.trim() || undefined; if (!urlInput.value) placeImage = undefined; drawPreview(); });
        input.addEventListener('input', () => { if (urlInput.value === '') placeImage = undefined; drawPreview(); });
        body.append(
          h('h3', { class: 'sub' }, 'Picture for this place'),
          imgPreview,
          h('label', { for: 'place-url', class: 'label' }, 'Image address'), urlInput,
          h('label', { for: 'place-file', class: 'label' }, 'Or choose a file'), fileInput,
          h('button', { type: 'button', class: 'btn ghost small', onClick: () => { placeImage = null; urlInput.value = ''; drawPreview(); } }, 'Remove picture'),
          h('p', { class: 'help' }, 'Pictures are only reused, never generated.'),
        );
        drawPreview();
      }
      setTimeout(() => input.focus(), 0);
    },
    async onSave() {
      let value = cleanString(input.value) || null;
      if (field === 'makeup' && value && /^(none|no makeup)$/i.test(value)) value = 'none';
      draft.fields[field].value = value;
      await saveManualEdit(repo, record, draft);
      if (field === 'location' && value) {
        await repo.updateProfile(profile.id, (p) => {
          p.places = p.places || [];
          let pl = p.places.find((x) => canonicalName(x.name) === canonicalName(value));
          if (!pl) { pl = { id: `place-${Date.now().toString(36)}`, name: value, imageUrl: null }; p.places.push(pl); }
          if (placeImage !== undefined) pl.imageUrl = placeImage;
          return p;
        });
      }
      await onSaved?.();
      return undefined;
    },
  });
  return sheet;
}

// ------------------------------------------------------------- clothing / accessories

const MODE_SUGGESTIONS = ['open', 'closed', 'buttoned', 'unbuttoned', 'zipped', 'tucked in', 'untucked', 'rolled-up sleeves', 'on shoulders'];
const CONDITION_SUGGESTIONS = ['wet', 'damp', 'dirty', 'wrinkled', 'torn', 'new'];

export function openItemsEditor({ mode, record, repo, onSaved, opener }) {
  const draft = structuredClone(record);
  const isClothing = mode === 'clothing';
  const slots = isClothing ? CLOTHING_SLOTS : [...ACCESSORY_SLOTS, 'bags'];
  const kinds = isClothing ? ['clothing'] : ['accessory', 'bag'];
  let message = '';
  let body;
  let api;

  const redraw = () => keepFocus(body, () => { body.replaceChildren(...build()); });
  const say = (m) => { message = m; api?.setError(m); };

  function addItem(slot, name) {
    const n = cleanString(name, 80);
    if (!n) return say('Type a name first.');
    const before = JSON.stringify(draft);
    try {
      manualOp(draft, { op: 'wear', item_name: n, slot });
    } catch (e) {
      if (e instanceof OpSkip) return say(e.unresolved || `Could not add "${n}": ${e.message}.`);
      throw e;
    }
    say(JSON.stringify(draft) === before ? `"${n}" is already listed here.` : '');
    redraw();
    return undefined;
  }

  function move(slot, id, delta) {
    const list = [...getList(draft, slot)];
    const i = list.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setList(draft, slot, list);
    redraw();
  }

  function takeOff(id) {
    manualOp(draft, { op: 'remove', item_id: id });
    say('');
    redraw();
  }

  function wearAgain(item) {
    const slot = item.slot && slots.includes(item.slot) ? item.slot : slots.find((s) => slotCategory(s) === (isClothing ? 'clothing' : item.kind === 'bag' ? 'bag' : 'accessory'));
    manualOp(draft, { op: 'wear', item_id: item.id, slot });
    say('');
    redraw();
  }

  const field = (label, key, value, onInput, list) => h('label', { class: 'mini' }, label,
    h('input', { type: 'text', class: 'text-input', value: value ?? '', list, 'data-key': key, autocomplete: 'off', onInput: (e) => onInput(cleanString(e.target.value) || null) }));

  function itemRow(slot, item, idx, total) {
    const inner = getList(draft, slot).indexOf(item.id);
    const last = getList(draft, slot).length - 1;
    const chips = [item.condition && `${item.condition}`, item.wearMode && `${item.wearMode}`, item.side && `${item.side} side`, item.placement].filter(Boolean);
    const inside = contentsOf(draft, item.id);
    return h('li', { class: 'item' },
      h('div', { class: 'item-main' },
        h('span', { class: 'item-name' }, itemLabel(item).replace(/^./, (c) => c.toUpperCase()), item.covers?.length ? h('em', { class: 'tag' }, 'one-piece') : null),
        chips.length ? h('span', { class: 'chips' }, ...chips.map((c) => h('span', { class: 'chip static' }, c))) : null),
      h('div', { class: 'item-actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${item.name} outward`, disabled: inner >= last, 'data-key': `up-${slot}-${item.id}`, onClick: () => move(slot, item.id, 1) }, icon('up', { size: 18 })),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${item.name} inward`, disabled: inner <= 0, 'data-key': `down-${slot}-${item.id}`, onClick: () => move(slot, item.id, -1) }, icon('down', { size: 18 })),
        h('button', { type: 'button', class: 'btn ghost small', 'data-key': `off-${slot}-${item.id}`, 'aria-label': `Take off ${item.name}`, onClick: () => takeOff(item.id) }, 'Take off')),
      h('details', { class: 'item-detail' },
        h('summary', {}, `Details for ${item.name}`),
        h('div', { class: 'detail-grid' },
          field('How it is worn', `mode-${slot}-${item.id}`, item.wearMode, (v) => { item.wearMode = v; }, 'mode-list'),
          field('Condition', `cond-${slot}-${item.id}`, item.condition, (v) => { item.condition = v; }, 'cond-list'),
          !isClothing ? h('label', { class: 'mini' }, 'Side',
            h('select', { class: 'text-input', 'data-key': `side-${slot}-${item.id}`, onChange: (e) => { item.side = e.target.value || null; } },
              h('option', { value: '' }, 'Not specified'),
              ...SIDES.map((s) => h('option', { value: s, selected: item.side === s ? '' : undefined }, s[0].toUpperCase() + s.slice(1))))) : null,
          !isClothing ? field('Precise position', `place-${slot}-${item.id}`, item.placement, (v) => { item.placement = v; }) : null),
        item.pockets !== null ? h('p', { class: 'detail-line' }, item.pockets.length ? `Pockets: ${item.pockets.map((p) => p.label).join(', ')}` : 'Has no pockets') : null,
        inside.length ? h('p', { class: 'detail-line' }, `Carrying: ${inside.map((c) => c.name).join(', ')}`) : null),
    );
  }

  function section(slot) {
    const list = getList(draft, slot);
    const nameInput = h('input', {
      type: 'text', class: 'text-input', placeholder: 'Add a piece…', 'data-key': `add-${slot}`,
      'aria-label': `Add an item to ${SLOT_LABELS[slot]}`,
      onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(slot, e.target.value); } },
    });
    const items = list ? [...list].reverse().map((id) => draft.items[id]).filter(Boolean) : [];
    return h('section', { class: 'slot', 'aria-label': SLOT_LABELS[slot] },
      h('div', { class: 'slot-head' },
        h('h3', {}, SLOT_LABELS[slot]),
        list === null ? h('span', { class: 'muted' }, 'Unknown')
          : list.length === 0 ? h('span', { class: 'muted' }, 'Confirmed empty') : null,
        list === null ? h('button', { type: 'button', class: 'btn ghost small', 'data-key': `empty-${slot}`, 'aria-label': `Mark ${SLOT_LABELS[slot]} as empty`, onClick: () => { setList(draft, slot, []); redraw(); } }, 'Mark empty')
          : list.length === 0 ? h('button', { type: 'button', class: 'btn ghost small', 'data-key': `unk-${slot}`, 'aria-label': `Mark ${SLOT_LABELS[slot]} as unknown`, onClick: () => { setList(draft, slot, null); redraw(); } }, 'Mark unknown') : null),
      items.length ? h('ul', { class: 'items' }, ...items.map((it, i) => itemRow(slot, it, i, items.length))) : null,
      items.length > 1 ? h('p', { class: 'help' }, 'Outermost layer first.') : null,
      h('div', { class: 'add-row' }, nameInput,
        h('button', { type: 'button', class: 'btn small', 'data-key': `addbtn-${slot}`, onClick: () => { addItem(slot, nameInput.value); } }, icon('plus', { size: 16 }), 'Add')));
  }

  function build() {
    const worn = new Set(slots.flatMap((s) => getList(draft, s) || []));
    const off = Object.values(draft.items).filter((i) => kinds.includes(i.kind) && !worn.has(i.id));
    return [
      h('datalist', { id: 'mode-list' }, ...MODE_SUGGESTIONS.map((v) => h('option', { value: v }))),
      h('datalist', { id: 'cond-list' }, ...CONDITION_SUGGESTIONS.map((v) => h('option', { value: v }))),
      ...slots.map(section),
      off.length ? h('section', { class: 'slot', 'aria-label': 'Not worn' },
        h('div', { class: 'slot-head' }, h('h3', {}, 'Not worn')),
        h('ul', { class: 'items' }, ...off.map((it) => h('li', { class: 'item' },
          h('div', { class: 'item-main' }, h('span', { class: 'item-name' }, it.name), h('span', { class: 'muted' }, describePlace(draft, it) + (it.condition ? ` · ${it.condition}` : ''))),
          h('div', { class: 'item-actions' }, h('button', { type: 'button', class: 'btn ghost small', onClick: () => wearAgain(it), 'aria-label': `Wear ${it.name} again` }, 'Wear again')))))) : null,
    ];
  }

  const sheet = openSheet({
    title: isClothing ? 'Edit clothing' : 'Edit accessories',
    wide: true,
    onClose: () => opener?.focus?.(),
    build(b, a) { body = b; api = a; b.append(...build()); if (message) a.setError(message); },
    async onSave() {
      await saveManualEdit(repo, record, draft);
      await onSaved?.();
      return undefined;
    },
  });
  return sheet;
}

// ------------------------------------------------------------------ profiles

const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export function openProfileSheet({ repo, profiles, selectedId, onSelect, onChanged, opener, managed = false }) {
  // managed: the host (Workshop) owns identity. Names and ids come from it; only pronouns are editable here.
  let editing = null; // null | 'new' | profile id
  let avatarData; // undefined = unchanged
  let body;
  let api;

  const redraw = () => keepFocus(body, () => body.replaceChildren(...view()));

  function form(existing) {
    const name = h('input', { type: 'text', id: 'pf-name', class: 'text-input', value: existing?.name ?? '', disabled: managed, 'data-key': 'pf-name', autocomplete: 'off' });
    const id = h('input', { type: 'text', id: 'pf-id', class: 'text-input', value: existing?.id ?? '', disabled: !!existing, 'data-key': 'pf-id', autocomplete: 'off', placeholder: 'Leave empty to create one' });
    const pron = h('input', { type: 'text', id: 'pf-pron', class: 'text-input', value: existing?.pronouns ?? '', 'data-key': 'pf-pron', placeholder: 'e.g. she/her (optional)', autocomplete: 'off' });
    const url = h('input', { type: 'url', id: 'pf-avatar', class: 'text-input', value: existing?.avatarUrl && !existing.avatarUrl.startsWith('data:') ? existing.avatarUrl : '', 'data-key': 'pf-avatar', placeholder: 'https://… (optional)' });
    const file = h('input', { type: 'file', accept: 'image/*', id: 'pf-avatar-file', 'aria-label': 'Choose an avatar file',
      onChange: async (e) => { const f = e.target.files?.[0]; if (f) { try { avatarData = await fileToDataUrl(f, 256); api.setError(''); } catch (err) { api.setError(err.message); } } } });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: '' });
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    return h('form', { class: 'profile-form', onSubmit: (e) => e.preventDefault() },
      h('h3', { class: 'sub' }, existing ? `Edit ${existing.name}` : 'New companion'),
      h('label', { class: 'label', for: 'pf-name' }, 'Name'), name,
      h('label', { class: 'label', for: 'pf-id' }, 'Companion ID'), id,
      h('p', { class: 'help' }, managed ? 'The name and ID come from Kindroid.' : existing ? 'The ID never changes, so renaming keeps this companion’s data.' : 'Use the ID your host gives this companion. It keeps two companions with the same name apart.'),
      h('label', { class: 'label', for: 'pf-pron' }, 'Pronouns'), pron,
      ...(managed ? [] : [h('label', { class: 'label', for: 'pf-avatar' }, 'Avatar image address'), url,
        h('label', { class: 'label', for: 'pf-avatar-file' }, 'Or choose a file'), file]),
      err,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn ghost', onClick: () => { editing = null; avatarData = undefined; redraw(); } }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary', 'data-key': 'pf-save', onClick: async () => {
          const nm = managed ? existing.name : cleanString(name.value, 60);
          if (!nm) return fail('Enter a name for the companion.');
          const idv = existing ? existing.id : (cleanString(id.value, 64) || `kin-${Math.random().toString(36).slice(2, 10)}`);
          if (!ID_RE.test(idv)) return fail('The ID may only use letters, numbers, dots, dashes, colons and underscores.');
          if (!existing && profiles.some((p) => p.id === idv)) return fail('Another companion already uses this ID.');
          const avatar = managed ? (existing.avatarUrl ?? null) : avatarData !== undefined ? avatarData : (url.value.trim() || null);
          if (existing) {
            await repo.updateProfile(existing.id, (p) => ({ ...p, name: nm, pronouns: cleanString(pron.value, 40) || null, avatarUrl: avatar }));
          } else {
            await repo.saveProfile({ id: idv, name: nm, pronouns: cleanString(pron.value, 40) || null, avatarUrl: avatar, demo: false, createdAt: new Date().toISOString(), places: [] });
            onSelect(idv);
          }
          editing = null; avatarData = undefined;
          await onChanged();
          api.close();
          return undefined;
        } }, existing ? 'Save changes' : 'Create companion')));
  }

  function view() {
    if (editing) return [form(editing === 'new' ? null : profiles.find((p) => p.id === editing))];
    const confirm = { id: null };
    return [
      h('ul', { class: 'profile-list', role: 'list' }, ...profiles.map((p) => h('li', {},
        h('button', { type: 'button', class: `profile-pick${p.id === selectedId ? ' selected' : ''}`, 'aria-pressed': String(p.id === selectedId), 'data-key': `pick-${p.id}`,
          onClick: () => { onSelect(p.id); api.close(); } },
        avatarNode(p, 36), h('span', { class: 'pp-text' }, h('strong', {}, p.name), h('span', { class: 'muted' }, p.demo ? 'Demo example' : managed ? 'From Kindroid' : `ID: ${p.id}`)),
        p.id === selectedId ? h('span', { class: 'tag' }, 'Selected') : null),
        h('button', { type: 'button', class: 'btn ghost small', 'aria-label': `Edit ${p.name}`, 'data-key': `edit-${p.id}`, onClick: () => { editing = p.id; redraw(); } }, 'Edit'),
        !p.demo && !managed ? h('button', { type: 'button', class: 'btn ghost small danger', 'aria-label': `Delete ${p.name}`, 'data-key': `del-${p.id}`, onClick: async (e) => {
          if (confirm.id !== p.id) { confirm.id = p.id; e.target.textContent = 'Confirm delete'; return; }
          await repo.deleteProfile(p.id);
          if (p.id === selectedId) onSelect(null);
          await onChanged();
          api.close();
        } }, 'Delete') : null))),
      profiles.length === 0 ? h('p', { class: 'muted' }, 'No companions yet.') : null,
      managed ? h('p', { class: 'help' }, 'Companions are the Kins attached to this app. To add or remove one, open this app’s settings in Kindroid Apps and use Kins.')
        : h('button', { type: 'button', class: 'btn', 'data-key': 'new-profile', onClick: () => { editing = 'new'; redraw(); } }, icon('plus', { size: 16 }), 'New companion'),
    ];
  }

  return openSheet({
    title: 'Select a companion',
    cancelLabel: 'Close',
    saveLabel: 'Done',
    onSave: () => undefined,
    onClose: () => opener?.focus?.(),
    build(b, a) { body = b; api = a; b.append(...view()); },
  });
}

export function avatarNode(profile, size = 44) {
  const wrap = h('span', { class: 'avatar', style: `width:${size}px;height:${size}px` });
  const fallback = () => wrap.replaceChildren(icon('person', { size: Math.round(size * 0.55) }));
  if (profile?.avatarUrl) {
    wrap.append(h('img', { src: profile.avatarUrl, alt: `Avatar of ${profile.name}`, onError: fallback }));
  } else fallback();
  return wrap;
}

export { displayValue };
