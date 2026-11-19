// The whole "tracker" logic: read the Kin's JSON, put its branches in order, add commas, show a sentence.
// Nothing here is saved: every reading stands on its own.
import { CLOTHING_SLOTS, ACCESSORY_SLOTS, BAG_SLOT, WEAR_SLOTS } from './constants.js';
import { cleanString, capitalizeFirst } from './text.js';
import { parseJsonObject } from './json.js';

// ---- slot words: the identifiers are obscure ("topunderwear"), so common slips are understood
const slotKey = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '');
const SLOT_ALIASES = (() => {
  const m = Object.fromEntries(WEAR_SLOTS.map((s) => [slotKey(s), s]));
  Object.assign(m, {
    top: 'topwear', tops: 'topwear', bottom: 'bottomwear', bottoms: 'bottomwear',
    shoes: 'footwear', shoe: 'footwear', boots: 'footwear', hat: 'headwear', cap: 'headwear',
    socks: 'footunderwear', stockings: 'footunderwear', tights: 'footunderwear',
    bra: 'topunderwear', undershirt: 'topunderwear', underwear: 'bottomunderwear', underpants: 'bottomunderwear', panties: 'bottomunderwear',
    glasses: 'eyes-accessory', necklace: 'neck-accessory', earrings: 'ears-accessory', bracelet: 'arms-accessory', watch: 'arms-accessory',
    ring: 'hands-accessory', gloves: 'hands-accessory', belt: 'waist-accessory', bag: 'bags', backpack: 'bags', handbag: 'bags',
  });
  return m;
})();
export const normalizeSlot = (v) => (typeof v === 'string' ? SLOT_ALIASES[slotKey(v)] : undefined);

// A Kin that ignores the slot names and answers {"clothing":[...],"accessories":[...]} is still understood.
const LOOSE_CLOTHING = new Set(['clothing', 'clothes', 'outfit', 'wearing', 'garments']);
const LOOSE_ACCESSORIES = new Set(['accessories', 'accessory', 'extras', 'jewelry', 'jewellery']);

/** Branches in reading order: head to toe, then accessories, then bags. Underwear goes last (see describe). */
export const CLOTHING_ORDER = ['headwear', 'topwear', 'bottomwear', 'footwear', 'footunderwear', 'clothing'];
export const UNDERWEAR_ORDER = ['topunderwear', 'bottomunderwear'];
export const ACCESSORY_ORDER = [...ACCESSORY_SLOTS, BAG_SLOT, 'accessories'];

const PLACEHOLDER = /^(unknown|unspecified|undefined|null|none|nothing|no\b.*|not (mentioned|specified|stated|known|visible|described)|n\/?a|-+|\?+)$/i;
const MAX_PER_SLOT = 8;
const MAX_LEN = 80;

function cleanPieces(v) {
  const list = Array.isArray(v) ? v : [v];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') return null;
    const s = cleanString(raw, MAX_LEN).replace(/[.;,]+$/, '');
    if (!s || PLACEHOLDER.test(s) || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out.slice(0, MAX_PER_SLOT);
}

/** Slots from a parsed JSON object. `location` belongs to the reading, so it is skipped here without a warning. */
function outfitFromObject(doc) {
  const outfit = {};
  const warnings = [];
  const errors = [];
  for (const [key, value] of Object.entries(doc)) {
    if (key.toLowerCase() === 'location') continue;
    let slot = normalizeSlot(key);
    if (!slot && LOOSE_CLOTHING.has(key.toLowerCase())) slot = 'clothing';
    if (!slot && LOOSE_ACCESSORIES.has(key.toLowerCase())) slot = 'accessories';
    if (!slot) { warnings.push(`"${key}" is not a slot and was ignored`); continue; }
    if (value === null || value === undefined) continue;
    const pieces = cleanPieces(value);
    if (pieces === null) { errors.push(`"${key}" must be a text or a list of texts.`); continue; }
    if (pieces.length) outfit[slot] = [...(outfit[slot] || []), ...pieces];
  }
  return { outfit, warnings, errors };
}

function parseObject(text) {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return parsed;
  const doc = parsed.value;
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'The answer must be a JSON object.' };
  return { ok: true, doc };
}

/**
 * Turns the Kin's answer into { slot: [pieces] }. Unknown keys are ignored with a warning; a wrong value type
 * is an error (nothing is guessed). `{}` is valid and means "no outfit described".
 */
export function parseOutfit(text) {
  const p = parseObject(text);
  if (!p.ok) return p;
  const { outfit, warnings, errors } = outfitFromObject(p.doc);
  if (errors.length) return { ok: false, error: errors.join(' ') };
  return { ok: true, outfit, warnings };
}

// ---- location: a short phrase that already starts with in / at / on ("in the kitchen", "at the hospital")
const PLACE_PREPOSITION = /^(in|inside|at|on|outside|near|nearby|by|under|over|above|below|around|across|along|between|beside|behind|next|close|through|from|to|towards?|back|heading|going|walking|driving|travell?ing|commuting|on the way)\b/i;
const NO_PLACE = /^(unknown|unspecified|undefined|null|none|nothing|not (mentioned|specified|stated|known|visible|described)|n\/?a|-+|\?+)$/i;

/** Cleans the Kin's location. Returns a string, null (nothing stated) or undefined (wrong type). */
export function cleanLocation(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const s = cleanString(v, 100).replace(/[.;,]+$/, '');
  return !s || NO_PLACE.test(s) ? null : s;
}

/** "in the kitchen" -> "In the kitchen." A bare place ("Alfenas") gets "In" in front. */
export function describeLocation(value) {
  if (!value) return 'No location described in the recent chat.';
  return capitalizeFirst(`${PLACE_PREPOSITION.test(value) ? value : `in ${value}`}.`);
}

/** One parse for the whole answer: where the Kin is and what it wears. */
export function parseReading(text) {
  const p = parseObject(text);
  if (!p.ok) return p;
  const { outfit, warnings, errors } = outfitFromObject(p.doc);
  const locKey = Object.keys(p.doc).find((k) => k.toLowerCase() === 'location');
  const location = locKey ? cleanLocation(p.doc[locKey]) : null;
  if (location === undefined) errors.push('"location" must be a text.');
  if (errors.length) return { ok: false, error: errors.join(' ') };
  return { ok: true, outfit, location, warnings };
}

/** The two sentences shown on the card. */
export function describeReading({ outfit, location }) {
  return { location: describeLocation(location), outfit: describeOutfit(outfit) };
}

/** "a" / "a and b" / "a, b and c". */
export function joinNatural(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const LOOSE_SLOTS = new Set(['clothing', 'accessories']); // no layers: keep the order the Kin gave
const inOrder = (outfit, order) => order.flatMap((slot) =>
  // inside a real slot the Kin lists innermost first; the sentence names the outermost piece first
  (LOOSE_SLOTS.has(slot) ? [...(outfit[slot] || [])] : [...(outfit[slot] || [])].reverse()));

/**
 * The sentence: "Wearing a leather jacket, a perfumed white shirt and blue jeans, with glasses."
 * Underwear is only mentioned when there is nothing else to say about clothing.
 */
export function describeOutfit(outfit) {
  let clothing = inOrder(outfit, CLOTHING_ORDER);
  const accessories = inOrder(outfit, ACCESSORY_ORDER);
  if (!clothing.length) clothing = inOrder(outfit, UNDERWEAR_ORDER);
  if (!clothing.length && !accessories.length) return 'No outfit described in the recent chat.';
  if (!clothing.length) return `Accessories: ${joinNatural(accessories)}.`;
  const text = `Wearing ${joinNatural(clothing)}${accessories.length ? `, with ${joinNatural(accessories)}` : ''}.`;
  return capitalizeFirst(text);
}

export { CLOTHING_SLOTS, ACCESSORY_SLOTS };
