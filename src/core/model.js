import {
  CLOTHING_SLOTS, ACCESSORY_SLOTS, BAG_SLOT, STATE_FIELDS, WEAR_SLOTS,
} from './constants.js';
import { canonicalName, capitalizeFirst } from './text.js';

export const SCHEMA_VERSION = 1;

/**
 * One record holds the scene state of one companion in one conversation scope.
 *
 * - Collections (`clothing[slot]`, `accessories[slot]`, `bags`):
 *     null  -> unknown
 *     []    -> confirmed empty
 *     [ids] -> worn items, ordered innermost -> outermost
 * - `items` is the registry of known objects. An item keeps its condition and
 *   its physical `place` even when it is not worn.
 * - Item `place`: worn | held | pocket | bag | scene | unknown
 */
export function createRecord(profileId, conversationId = null) {
  const field = () => ({ value: null, source: 'unknown', updatedAt: null, editedRev: 0 });
  return {
    schema: SCHEMA_VERSION,
    profileId,
    conversationId: conversationId || null,
    rev: 0,
    itemSeq: 0,
    pocketSeq: 0,
    fields: Object.fromEntries(STATE_FIELDS.map((f) => [f, field()])),
    clothing: Object.fromEntries(CLOTHING_SLOTS.map((s) => [s, null])),
    accessories: Object.fromEntries(ACCESSORY_SLOTS.map((s) => [s, null])),
    bags: null,
    slotEditedRev: {},
    items: {},
    lastRead: null,
    lastError: null,
    lastManualEditAt: null,
    processedMessageIds: [],
    unresolved: [],
    history: [],
  };
}

export function scopeKey(profileId, conversationId) {
  return `${profileId}::${conversationId || '-'}`;
}

export function getList(record, slot) {
  if (slot === BAG_SLOT) return record.bags;
  if (slot in record.clothing) return record.clothing[slot];
  if (slot in record.accessories) return record.accessories[slot];
  throw new Error(`Unknown slot: ${slot}`);
}

export function setList(record, slot, list) {
  if (slot === BAG_SLOT) record.bags = list;
  else if (slot in record.clothing) record.clothing[slot] = list;
  else if (slot in record.accessories) record.accessories[slot] = list;
  else throw new Error(`Unknown slot: ${slot}`);
}

/** Removes an item id from every worn list. */
export function detach(record, id) {
  for (const slot of WEAR_SLOTS) {
    const list = getList(record, slot);
    if (list && list.includes(id)) setList(record, slot, list.filter((x) => x !== id));
  }
}

export function slotsOf(record, id) {
  return WEAR_SLOTS.filter((s) => (getList(record, s) || []).includes(id));
}

export function newItem(id, name, kind) {
  return {
    id, name: String(name).trim(), kind, slot: null, covers: [],
    condition: null, wearMode: null, side: null, placement: null,
    pockets: null, place: { type: 'unknown' }, editedRev: 0,
  };
}

export function itemsIn(record, slot) {
  return (getList(record, slot) || []).map((id) => record.items[id]).filter(Boolean);
}

/** Items whose place references the given container item. */
export function contentsOf(record, containerId) {
  return Object.values(record.items).filter(
    (i) => (i.place.type === 'pocket' || i.place.type === 'bag') && i.place.itemId === containerId,
  );
}

export function offBodyItems(record) {
  const worn = new Set(WEAR_SLOTS.flatMap((s) => getList(record, s) || []));
  return Object.values(record.items).filter((i) => !worn.has(i.id));
}

export function pocketLabel(item, pocketId) {
  const p = (item?.pockets || []).find((x) => x.id === pocketId);
  return p ? p.label : 'pocket';
}

/** Human-readable (English) description of where an item is. */
export function describePlace(record, item) {
  const p = item.place || { type: 'unknown' };
  switch (p.type) {
    case 'worn': return 'Worn';
    case 'held': return p.hand && p.hand !== 'both' ? `Held in ${p.hand} hand` : (p.hand === 'both' ? 'Held in both hands' : 'Held in hand');
    case 'pocket': {
      const c = record.items[p.itemId];
      return c ? `In the ${pocketLabel(c, p.pocketId)} of ${c.name}` : 'In a pocket';
    }
    case 'bag': {
      const c = record.items[p.itemId];
      return c ? `In ${c.name}` : 'In a bag';
    }
    case 'scene': return p.place ? `Left at: ${p.place}` : 'Left in the scene';
    default: return 'Location unknown';
  }
}

/** Place as exposed to the extraction model (same shape as move destinations). */
function placeForModel(record, item) {
  const p = item.place;
  switch (p.type) {
    case 'held': return p.hand ? { type: 'held', hand: p.hand } : { type: 'held' };
    case 'pocket': {
      const c = record.items[p.itemId];
      return { type: 'pocket', container_item_id: p.itemId, pocket: pocketLabel(c, p.pocketId) };
    }
    case 'bag': return { type: 'bag', container_item_id: p.itemId };
    case 'scene': return p.place ? { type: 'scene', place: p.place } : { type: 'scene' };
    default: return { type: 'unknown' };
  }
}

function briefItem(record, item) {
  const out = { id: item.id, name: item.name };
  if (item.condition) out.condition = item.condition;
  if (item.wearMode) out.wear_mode = item.wearMode;
  if (item.side) out.side = item.side;
  if (item.placement) out.placement = item.placement;
  if (item.pockets) out.pockets = item.pockets.map((p) => p.label);
  const inside = contentsOf(record, item.id);
  if (inside.length) {
    out.contains = inside.map((c) => ({
      id: c.id, name: c.name,
      ...(c.place.type === 'pocket' ? { pocket: pocketLabel(item, c.place.pocketId) } : {}),
    }));
  }
  if (item.covers?.length) out.also_covers = item.covers;
  return out;
}

/** Compact projection of the confirmed state, sent to the extraction model. */
export function projectForPrompt(record, profile) {
  const col = (slots) => Object.fromEntries(slots.map((s) => {
    const list = getList(record, s);
    return [s, list === null ? null : list.map((id) => briefItem(record, record.items[id]))];
  }));
  const v = (f) => record.fields[f].value;
  return {
    target: { id: profile.id, name: profile.name, ...(profile.pronouns ? { pronouns: profile.pronouns } : {}) },
    location: v('location'),
    position: v('position'),
    hair: v('hair'),
    makeup: v('makeup'),
    clothing: col(CLOTHING_SLOTS),
    accessories: col(ACCESSORY_SLOTS),
    bags: record.bags === null ? null : record.bags.map((id) => briefItem(record, record.items[id])),
    known_items_not_worn: offBodyItems(record).map((i) => ({
      ...briefItem(record, i), kind: i.kind, place: placeForModel(record, i),
    })),
  };
}

/** Checks structural invariants. Returns a list of problems (empty when sound). */
export function checkInvariants(record) {
  const problems = [];
  for (const slot of WEAR_SLOTS) {
    const list = getList(record, slot);
    if (list === null) continue;
    if (new Set(list).size !== list.length) problems.push(`duplicate ids in ${slot}`);
    for (const id of list) {
      const it = record.items[id];
      if (!it) problems.push(`${slot} references missing item ${id}`);
      else if (it.place.type !== 'worn') problems.push(`${id} listed in ${slot} but place is ${it.place.type}`);
    }
  }
  for (const it of Object.values(record.items)) {
    if (it.place.type === 'worn' && slotsOf(record, it.id).length === 0) problems.push(`${it.id} is worn but in no slot`);
    if (it.place.type === 'pocket' || it.place.type === 'bag') {
      const c = record.items[it.place.itemId];
      if (!c) problems.push(`${it.id} is inside missing container`);
      else if (it.place.type === 'pocket' && !(c.pockets || []).some((p) => p.id === it.place.pocketId)) problems.push(`${it.id} is in a missing pocket`);
    }
    const seen = new Set([it.id]);
    let cur = it;
    while (cur && (cur.place.type === 'pocket' || cur.place.type === 'bag')) {
      cur = record.items[cur.place.itemId];
      if (cur && seen.has(cur.id)) { problems.push(`container cycle at ${it.id}`); break; }
      if (cur) seen.add(cur.id);
    }
  }
  return problems;
}

export function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  if (field === 'makeup' && String(value).toLowerCase() === 'none') return 'No makeup';
  return capitalizeFirst(value);
}

export { canonicalName };
