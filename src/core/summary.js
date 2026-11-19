import { CLOTHING_SLOTS, ACCESSORY_SLOTS, SLOT_LABELS } from './constants.js';
import { getList, itemsIn } from './model.js';
import { capitalizeFirst } from './text.js';

export function itemLabel(item) {
  const base = item.condition ? `${item.condition} ${item.name}` : item.name;
  return item.wearMode ? `${base} (${item.wearMode})` : base;
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/** Items visible in the main panel: no underwear. */
const VISIBLE_CLOTHING = ['headwear', 'topwear', 'bottomwear', 'footwear'];

export function clothingKnown(record) {
  return CLOTHING_SLOTS.some((s) => getList(record, s) !== null);
}

/** One readable line, e.g. "Green cardigan (open) over T-shirt, jeans, sneakers". */
export function lookSummary(record) {
  if (!clothingKnown(record)) return null;
  const parts = [];
  const shown = new Set(); // a one-piece garment sits in several slots but is named once
  const take = (slot) => uniqueById(itemsIn(record, slot)).filter((i) => !shown.has(i.id)).reverse()
    .map((i) => { shown.add(i.id); return i; });
  for (const slot of ['topwear', 'bottomwear', 'footwear', 'headwear']) {
    const items = take(slot); // outermost first
    if (items.length) parts.push(items.map(itemLabel).join(' over '));
  }
  if (!parts.length) {
    const under = uniqueById(CLOTHING_SLOTS.flatMap((s) => itemsIn(record, s)));
    if (under.length) parts.push(under.map(itemLabel).join(', '));
  }
  if (!parts.length) return 'Nothing recorded as worn';
  return capitalizeFirst(parts.join(', '));
}

export function clothingCount(record) {
  return uniqueById(CLOTHING_SLOTS.flatMap((s) => itemsIn(record, s))).length;
}

export function accessoriesKnown(record) {
  return ACCESSORY_SLOTS.some((s) => getList(record, s) !== null) || record.bags !== null;
}

export function accessoryItems(record) {
  return uniqueById([...ACCESSORY_SLOTS, 'bags'].flatMap((s) => itemsIn(record, s)));
}

/** "Glasses, watch +1" or null when nothing is known. */
export function accessorySummary(record, max = 3) {
  if (!accessoriesKnown(record)) return null;
  const items = accessoryItems(record);
  if (!items.length) return 'None recorded';
  const shown = items.slice(0, max).map((i) => i.name).join(', ');
  return capitalizeFirst(items.length > max ? `${shown} +${items.length - max}` : shown);
}

export function visibleClothingSlots() { return VISIBLE_CLOTHING; }
export { SLOT_LABELS };

export function hairIcon(value) {
  return /\b(bun|ponytail|pony tail|braid|braids|updo|tied|pinned|up)\b/i.test(value || '') ? 'hair-up' : 'hair-down';
}

export function postureIcon(value) {
  const v = value || '';
  if (/\b(sit|sits|sitting|seated|lying|lies|lay|kneel|kneeling|crouch)/i.test(v)) return 'sitting';
  if (/\b(stand|standing|walk|walking|upright|leaning)\b/i.test(v)) return 'standing';
  return 'person';
}
