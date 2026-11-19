import {
  CLOTHING_SLOTS, STATE_FIELDS, slotCategory, SLOT_LABELS,
} from './constants.js';
import {
  getList, setList, detach, newItem, slotsOf, pocketLabel,
} from './model.js';
import { canonicalName, slugify, cleanString, sameJSON, randomSuffix } from './text.js';

/** An operation that cannot be applied. Only that operation is skipped. */
export class OpSkip extends Error {
  constructor(reason, unresolved = null) {
    super(reason);
    this.unresolved = unresolved;
  }
}

const HISTORY_LIMIT = 40;
const UNRESOLVED_LIMIT = 20;
const PROCESSED_LIMIT = 500;

// ---------------------------------------------------------------- references

function findByName(record, name, filter = () => true) {
  const q = canonicalName(name);
  if (!q) return [];
  const items = Object.values(record.items).filter(filter);
  const exact = items.filter((i) => canonicalName(i.name) === q);
  if (exact.length) return exact;
  const qt = q.split(' ');
  return items.filter((i) => {
    const it = new Set(canonicalName(i.name).split(' '));
    return qt.every((t) => it.has(t));
  });
}

/**
 * Resolves `<base>_id` / `<base>_name` to a known item.
 * Returns { item } | { ambiguous: [items] } | { missing: label }.
 */
export function resolveRef(record, obj, base, { prefer, filter } = {}) {
  const id = obj[`${base}_id`];
  const name = obj[`${base}_name`];
  if (id && record.items[id]) return { item: record.items[id] };
  if (!name) return { missing: id ? `ID "${id}"` : null };
  let cands = findByName(record, name, filter);
  if (cands.length > 1 && prefer) {
    const p = cands.filter(prefer);
    if (p.length) cands = p;
  }
  if (cands.length === 1) return { item: cands[0] };
  if (cands.length > 1) return { ambiguous: cands, name };
  return { missing: name };
}

function ambiguityNote(r) {
  return `Ambiguous reference "${r.name}": it could be ${r.ambiguous.map((c) => `${c.name} (${c.id})`).join(' or ')}. Left unchanged.`;
}

function mustResolve(record, obj, base, opts) {
  const r = resolveRef(record, obj, base, opts);
  if (r.ambiguous) throw new OpSkip('ambiguous reference', ambiguityNote(r));
  return r;
}

// ------------------------------------------------------------------ helpers

function nextItemId(record, name, ctx) {
  if (ctx.manual) return `${slugify(name)}-m${randomSuffix()}${randomSuffix()}`;
  record.itemSeq += 1;
  return `${slugify(name)}-${record.itemSeq}`;
}

function createItem(record, name, kind, ctx) {
  const item = newItem(nextItemId(record, name, ctx), name, kind);
  item.editedRev = ctx.manual ? record.rev : 0;
  record.items[item.id] = item;
  return item;
}

function kindForSlot(slot) {
  return slotCategory(slot) || 'object';
}

function guardItem(ctx, item) {
  if (!ctx.manual && item.editedRev > ctx.baseRev) {
    throw new OpSkip(`"${item.name}" was edited manually while the scene was being read`);
  }
}

function guardSlot(ctx, record, slot) {
  if (!ctx.manual && (record.slotEditedRev[slot] || 0) > ctx.baseRev) {
    throw new OpSkip(`${SLOT_LABELS[slot]} was edited manually while the scene was being read`);
  }
}

function wouldCycle(record, itemId, containerId) {
  let cur = record.items[containerId];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    if (cur.id === itemId) return true;
    seen.add(cur.id);
    if (cur.place.type === 'pocket' || cur.place.type === 'bag') cur = record.items[cur.place.itemId];
    else break;
  }
  return false;
}

function applyPockets(record, item, specs, ctx) {
  const old = item.pockets || [];
  const kept = [];
  for (const spec of specs) {
    const label = spec.label;
    const match = old.find((p) => canonicalName(p.label) === canonicalName(label) && (p.side || null) === (spec.side || null))
      || old.find((p) => canonicalName(p.label) === canonicalName(label));
    if (match) kept.push(match);
    else {
      record.pocketSeq += 1;
      kept.push({ id: `p${record.pocketSeq}${ctx.manual ? randomSuffix() : ''}`, label, side: spec.side || null });
    }
  }
  // Never drop a pocket that still holds something.
  for (const p of old) {
    const holds = Object.values(record.items).some((i) => i.place.type === 'pocket' && i.place.itemId === item.id && i.place.pocketId === p.id);
    if (holds && !kept.includes(p)) kept.push(p);
  }
  item.pockets = kept;
}

function findOrCreatePocket(record, container, dest, ctx) {
  if (container.pockets && container.pockets.length === 0) {
    throw new OpSkip(`${container.name} has no pockets`);
  }
  const label = dest.pocket || (dest.side ? `${dest.side} pocket` : 'pocket');
  const list = container.pockets || [];
  const q = canonicalName(label);
  let matches = list.filter((p) => canonicalName(p.label) === q);
  if (!matches.length && dest.side) matches = list.filter((p) => p.side === dest.side);
  if (!matches.length && !dest.pocket && list.length === 1) matches = list;
  if (matches.length > 1) {
    throw new OpSkip('ambiguous pocket', `Ambiguous pocket "${label}" on ${container.name}. Left unchanged.`);
  }
  if (matches.length === 1) return matches[0];
  applyPockets(record, container, [...list.map((p) => ({ label: p.label, side: p.side })), { label, ...(dest.side ? { side: dest.side } : {}) }], ctx);
  return container.pockets.find((p) => canonicalName(p.label) === q);
}

/** Turns a validated destination into a stored `place`. */
function resolveDestination(record, dest, item, ctx) {
  switch (dest.type) {
    case 'held': return { type: 'held', hand: dest.hand || null };
    case 'scene': return { type: 'scene', place: dest.place || null };
    case 'bag':
    case 'pocket': {
      const r = mustResolve(record, dest, 'container_item');
      let container = r.item;
      if (!container) {
        if (dest.type === 'pocket') throw new OpSkip(`container "${r.missing}" is not known`);
        container = createItem(record, r.missing, 'bag', ctx);
      }
      if (container.id === item.id || wouldCycle(record, item.id, container.id)) {
        throw new OpSkip(`${item.name} cannot be placed inside ${container.name}`);
      }
      if (dest.type === 'bag') return { type: 'bag', itemId: container.id };
      const pocket = findOrCreatePocket(record, container, dest, ctx);
      return { type: 'pocket', itemId: container.id, pocketId: pocket.id };
    }
    default: throw new OpSkip('unsupported destination');
  }
}

function describeDest(record, place) {
  switch (place.type) {
    case 'held': return 'in hand';
    case 'scene': return place.place ? `at ${place.place}` : 'in the scene';
    case 'bag': return `into ${record.items[place.itemId]?.name || 'a bag'}`;
    case 'pocket': return `into the ${pocketLabel(record.items[place.itemId], place.pocketId)} of ${record.items[place.itemId]?.name}`;
    default: return 'somewhere unknown';
  }
}

// --------------------------------------------------------------- operations

function insertInList(list, id, { over, under }) {
  const next = list.filter((x) => x !== id);
  if (over && next.includes(over)) next.splice(next.indexOf(over) + 1, 0, id);
  else if (under && next.includes(under)) next.splice(next.indexOf(under), 0, id);
  else next.push(id);
  return next;
}

function resolveLayer(record, op, base, slot, kind, ctx) {
  if (op[`${base}_id`] === undefined && op[`${base}_name`] === undefined) return null;
  const inSlot = new Set(getList(record, slot) || []);
  const r = resolveRef(record, op, base, { prefer: (i) => inSlot.has(i.id) });
  if (r.ambiguous) return null; // hint only; ignore rather than guess
  if (r.item) return r.item.id;
  if (op[`${base}_name`]) return createItem(record, op[`${base}_name`], kind, ctx).id;
  return null;
}

const HANDLERS = {
  wear(record, op, ctx) {
    const { slot } = op;
    guardSlot(ctx, record, slot);
    const kind = kindForSlot(slot);
    const r = mustResolve(record, op, 'item');
    let item = r.item;
    if (item) guardItem(ctx, item);
    else {
      if (!r.missing) throw new OpSkip('the item has no usable name');
      item = createItem(record, op.item_name || r.missing, kind, ctx);
    }
    const had = getList(record, slot) || [];
    if (!had.includes(item.id)) {
      const over = resolveLayer(record, op, 'over_item', slot, kind, ctx);
      const under = resolveLayer(record, op, 'under_item', slot, kind, ctx);
      detach(record, item.id);
      const cur = getList(record, slot) || [];
      setList(record, slot, insertInList(cur, item.id, { over, under }));
    }
    item.slot = slot;
    item.place = { type: 'worn' };
    if (op.wear_mode !== undefined) item.wearMode = op.wear_mode;
    if (op.condition !== undefined) item.condition = op.condition;
    if (op.side !== undefined) item.side = op.side;
    if (op.placement !== undefined) item.placement = op.placement;
    if (op.pockets !== undefined) applyPockets(record, item, op.pockets, ctx);
    if (op.covers !== undefined) {
      const extra = op.covers.filter((s) => s !== slot);
      for (const s of item.covers) if (!extra.includes(s)) setList(record, s, (getList(record, s) || []).filter((x) => x !== item.id));
      for (const s of extra) {
        const cur = getList(record, s) || [];
        if (!cur.includes(item.id)) setList(record, s, [...cur, item.id]);
      }
      item.covers = extra;
    }
    return `Wore ${item.name} (${SLOT_LABELS[slot]})`;
  },

  remove(record, op, ctx) {
    const wornIds = new Set(Object.keys(record.items).filter((id) => slotsOf(record, id).length));
    const r = mustResolve(record, op, 'item', { prefer: (i) => wornIds.has(i.id) });
    let item = r.item;
    if (item) guardItem(ctx, item);
    else {
      if (!r.missing) throw new OpSkip('the item has no usable name');
      item = createItem(record, op.item_name || r.missing, op.slot ? kindForSlot(op.slot) : 'object', ctx);
      if (op.slot) item.slot = op.slot;
    }
    for (const s of slotsOf(record, item.id)) guardSlot(ctx, record, s);
    const place = op.to ? resolveDestination(record, op.to, item, ctx) : { type: 'unknown' };
    detach(record, item.id);
    item.place = place;
    return `Took off ${item.name}${op.to ? ` (${describeDest(record, place)})` : ''}`;
  },

  change_wear_mode(record, op, ctx) {
    const r = mustResolve(record, op, 'item');
    if (!r.item) throw new OpSkip(`item "${r.missing ?? '?'}" is not known`);
    guardItem(ctx, r.item);
    r.item.wearMode = op.wear_mode;
    return `${r.item.name}: ${op.wear_mode ? `worn ${op.wear_mode}` : 'wear mode cleared'}`;
  },

  change_condition(record, op, ctx) {
    const r = mustResolve(record, op, 'item');
    if (!r.item) throw new OpSkip(`item "${r.missing ?? '?'}" is not known`);
    guardItem(ctx, r.item);
    r.item.condition = op.condition;
    return `${r.item.name}: ${op.condition ? op.condition : 'condition cleared'}`;
  },

  move(record, op, ctx) {
    const r = mustResolve(record, op, 'item');
    let item = r.item;
    if (item) guardItem(ctx, item);
    else {
      if (!r.missing) throw new OpSkip('the item has no usable name');
      item = createItem(record, op.item_name || r.missing, op.kind || 'object', ctx);
    }
    for (const s of slotsOf(record, item.id)) guardSlot(ctx, record, s);
    const place = resolveDestination(record, op.to, item, ctx);
    detach(record, item.id);
    item.place = place;
    return `Moved ${item.name} ${describeDest(record, place)}`;
  },
};

// ------------------------------------------------------------------ driver

function pushUnique(list, entry, limit) {
  if (!list.some((x) => x.note === entry.note)) list.push(entry);
  while (list.length > limit) list.shift();
}

/**
 * Applies a validated document to a copy of `record` in one transaction.
 *
 *  - `baseRev`: the record revision the reading started from. Fields, slots
 *    and items that the user edited manually after that point are protected.
 *  - Returns { record, applied, skipped, unresolved }. The input is untouched.
 */
export function applyDocument(record, doc, { baseRev, now, ticketId = null, messageIds = [], source = 'scene' }) {
  let draft = structuredClone(record);
  const ctx = { baseRev, manual: false };
  const applied = [];
  const skipped = [];
  const unresolved = [];

  for (const field of STATE_FIELDS) {
    if (!(field in doc.state_updates)) continue;
    const cur = draft.fields[field];
    if (cur.editedRev > baseRev) {
      skipped.push({ what: `${field} update`, reason: 'it was edited manually while the scene was being read' });
      continue;
    }
    const value = doc.state_updates[field];
    if (cur.value === value) continue;
    draft.fields[field] = { value, source, updatedAt: now, editedRev: cur.editedRev };
    applied.push(`${field}: ${cur.value ?? 'unknown'} → ${value}`);
  }

  doc.item_changes.forEach((op, index) => {
    const trial = structuredClone(draft);
    try {
      const before = JSON.stringify(draft);
      const text = HANDLERS[op.op](trial, op, ctx);
      if (JSON.stringify(trial) !== before) {
        draft = trial;
        applied.push(text);
      }
    } catch (e) {
      if (!(e instanceof OpSkip)) throw e;
      skipped.push({ what: `${op.op} #${index + 1}`, reason: e.message });
      if (e.unresolved) unresolved.push(e.unresolved);
    }
  });

  for (const note of doc.unresolved) unresolved.push(note);
  for (const note of unresolved) pushUnique(draft.unresolved, { id: `u${draft.rev}-${draft.unresolved.length}-${Math.random().toString(36).slice(2, 6)}`, note, at: now }, UNRESOLVED_LIMIT);

  draft.rev += 1;
  draft.lastRead = { at: now, ticketId, applied: applied.length, skipped: skipped.length };
  draft.lastError = null;
  const seen = new Set(draft.processedMessageIds);
  for (const id of messageIds) if (!seen.has(id)) draft.processedMessageIds.push(id);
  draft.processedMessageIds = draft.processedMessageIds.slice(-PROCESSED_LIMIT);
  draft.history.push({ at: now, source, summary: applied.length ? applied : ['No changes'], skipped: skipped.map((s) => `${s.what}: ${s.reason}`) });
  draft.history = draft.history.slice(-HISTORY_LIMIT);
  return { record: draft, applied, skipped, unresolved };
}

// ----------------------------------------------------------- manual editing

/** Runs an operation handler in manual mode (used by the editors). */
export function manualOp(record, op) {
  return HANDLERS[op.op](record, op, { manual: true, baseRev: Infinity });
}

/**
 * Merges a manual edit into the latest stored record. Only what the draft
 * changed relative to `original` is written, so reads that committed while the
 * editor was open are not overwritten for untouched slots, fields or items.
 */
export function mergeManualEdit(latest, original, draft, { now }) {
  const out = structuredClone(latest);
  out.rev = latest.rev + 1;
  const rev = out.rev;
  const changes = [];
  for (const f of STATE_FIELDS) {
    if (!sameJSON(original.fields[f], draft.fields[f])) {
      out.fields[f] = { value: draft.fields[f].value, source: 'manual', updatedAt: now, editedRev: rev };
      changes.push(`${f}: ${original.fields[f].value ?? 'unknown'} → ${draft.fields[f].value ?? 'unknown'}`);
    }
  }
  for (const slot of [...CLOTHING_SLOTS, ...Object.keys(original.accessories), 'bags']) {
    if (!sameJSON(getList(original, slot), getList(draft, slot))) {
      setList(out, slot, structuredClone(getList(draft, slot)));
      out.slotEditedRev[slot] = rev;
      changes.push(`${SLOT_LABELS[slot]} edited`);
    }
  }
  for (const [id, item] of Object.entries(draft.items)) {
    if (!sameJSON(original.items[id], item)) {
      out.items[id] = { ...structuredClone(item), editedRev: rev };
      if (original.items[id]) changes.push(`${item.name} edited`);
    }
  }
  if (!changes.length && !Object.keys(draft.items).some((id) => !original.items[id])) return { record: latest, changed: false };
  out.pocketSeq = Math.max(out.pocketSeq, draft.pocketSeq);
  out.lastManualEditAt = now;
  out.history.push({ at: now, source: 'manual', summary: changes.length ? changes : ['Manual edit'], skipped: [] });
  out.history = out.history.slice(-HISTORY_LIMIT);
  return { record: out, changed: true };
}

export function dismissUnresolved(record, id) {
  const out = structuredClone(record);
  out.unresolved = out.unresolved.filter((u) => u.id !== id);
  return out;
}

export { cleanString };
