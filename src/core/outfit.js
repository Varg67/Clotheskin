// A reading of the Kin: its JSON answer to the reading question, read into the outfit's slots and the short phrases
// (phrases.js), and turned into the card's five sentences: location, pose and action, outfit, hair, makeup.
// Nothing here is saved: every reading stands on its own.
import { ACCESSORY_SLOTS, BAG_SLOT } from './constants.js';
import { readingFieldOf, normalizeSlot, looseGroupOf, isPortugueseKey } from './vocabulary.js';
import { cleanString, capitalizeFirst, joinNatural, nothingSaid } from './text.js';
import { cleanLocation, describeLocation, cleanPose, cleanAction, describeDoing, isPlaceNotPose, cleanHair, cleanMakeup, describeHair, describeMakeup } from './phrases.js';
import { parseJsonObject } from './json.js';
import { looksCopiedFromExample } from './prompt.js';
/** @import { Failure } from './json.js' */

/** Branches in reading order: head to toe, then accessories, then bags. Underwear goes last (see describe). */
const CLOTHING_ORDER = ['headwear', 'topwear', 'bottomwear', 'footwear', 'footunderwear', 'clothing'];
const UNDERWEAR_ORDER = ['topunderwear', 'bottomunderwear'];
const ACCESSORY_ORDER = [...ACCESSORY_SLOTS, BAG_SLOT, 'accessories'];

const PLACEHOLDER = nothingSaid({ extra: ['no\\s.*'] }); // "no shoes" is not a piece either
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

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const LOOSE_SLOTS = new Set(['clothing', 'accessories']); // pieces grouped without a slot: no layers

/**
 * The outfit of a parsed answer: { outfit: { slot: [pieces] }, warnings, errors }. The reading's own keys (location,
 * pose, …) are skipped without a warning; a key that is no slot is ignored with one.
 */
function outfitFromObject(doc, nested = false) {
  /** @type {{ outfit: Outfit, warnings: string[], errors: string[] }} */
  const found = { outfit: {}, warnings: [], errors: [] };
  for (const [key, value] of Object.entries(doc)) readSlot(found, key, value, nested);
  return found;
}

function readSlot(found, key, value, nested) {
  if (readingFieldOf(key)) return;
  const slot = normalizeSlot(key) || looseGroupOf(key);
  if (!slot) { found.warnings.push(`"${key}" is not a slot and was ignored`); return; }
  if (value === null || value === undefined || value === false) return;
  // {"outfit":{"topwear":[…],"bottomwear":[…]}}: a Kin that groups the slots under one key is understood.
  if (LOOSE_SLOTS.has(slot) && isPlainObject(value) && !nested) { mergeFound(found, outfitFromObject(value, true)); return; }
  const pieces = cleanPieces(value);
  if (pieces === null) found.errors.push(`"${key}" must be a text or a list of texts.`);
  else addPieces(found.outfit, slot, pieces);
}

const addPieces = (outfit, slot, pieces) => { if (pieces.length) outfit[slot] = [...(outfit[slot] || []), ...pieces]; };

function mergeFound(found, inner) {
  for (const [slot, pieces] of Object.entries(inner.outfit)) addPieces(found.outfit, slot, pieces);
  found.warnings.push(...inner.warnings);
  found.errors.push(...inner.errors);
}

/** @returns {{ ok: true, doc: Object<string, any> } | Failure} */
function parseObject(text) {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return parsed;
  // A Kin that wraps its one object in a list ([{...}]) is understood.
  const value = Array.isArray(parsed.value) && parsed.value.length === 1 && isPlainObject(parsed.value[0]) ? parsed.value[0] : parsed.value;
  if (!isPlainObject(value)) return { ok: false, error: 'The answer must be a JSON object.' };
  return { ok: true, doc: openWrapper(value) };
}

/** {"Isa":{…}} or {"status":{…}}: one key holding the real answer is opened, if the answer is inside it. */
function openWrapper(doc) {
  const keys = Object.keys(doc);
  if (keys.length !== 1) return doc;
  const [key] = keys;
  const inner = doc[key];
  const isOwnKey = (k) => readingFieldOf(k) || normalizeSlot(k);
  const wraps = isPlainObject(inner) && !normalizeSlot(key) && !looseGroupOf(key) && Object.keys(inner).some(isOwnKey);
  return wraps ? inner : doc;
}

// ---- English only: the Kin is asked to answer in English (fewer tokens, and the sentences are English). Portuguese
// keys and values are still read, but they are reported so the diagnostics show whether the Kin follows the rule.
const PT_WORDS = [
  'uma', 'um', 'umas', 'uns', 'com', 'na', 'nas', 'nos', 'da', 'das', 'dos', 'em', 'sem', 'meu', 'minha', 'seu',
  'sua', 'estou', 'está', 'esta', 'sentada', 'sentado', 'deitada', 'deitado', 'vestindo', 'usando', 'calça', 'calca',
  'camisa', 'camiseta', 'vestido', 'saia', 'jaqueta', 'casaco', 'tênis', 'sapato', 'sapatos', 'bota', 'botas',
  'meia', 'meias', 'bolsa', 'mochila', 'óculos', 'colar', 'brinco', 'brincos', 'cabelo', 'preso', 'presa', 'solto',
  'solta', 'batom', 'maquiagem', 'rímel', 'sala', 'quarto', 'cozinha', 'banheiro', 'casa', 'cama', 'sofá', 'tomando',
  'lendo', 'bebendo', 'olhando', 'conversando', 'cozinhando',
].join('|');
const PT_WORD = new RegExp(`(?<![\\p{L}.])(${PT_WORDS})(?![\\p{L}])`, 'iu');
// ã or õ inside a lowercase word ("algodão", "botões"); a capitalised name ("São Paulo") is a place, not a slip.
// ç alone is not enough: English has "façade". Portuguese words with ç ("calça") are in the list above.
const PT_ACCENT = /(?<!\p{L})[a-zà-ÿ]*[ãõ][a-zà-ÿ]*(?!\p{L})/u;
const PT_TEXT = { test: (t) => PT_WORD.test(t) || PT_ACCENT.test(t) };
const textsOf = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(textsOf) : isPlainObject(v) ? Object.entries(v).flatMap(([k, x]) => [k, ...textsOf(x)]) : []);

/** The keys of an answer that were written (key or value) in Portuguese instead of English. At most 8. */
export function notEnglishKeys(doc) {
  if (!isPlainObject(doc)) return [];
  const portuguese = ([k, v]) => isPortugueseKey(k) || textsOf(v).some((t) => PT_TEXT.test(t));
  return Object.entries(doc).filter(portuguese).map(([k]) => String(k).slice(0, 30)).slice(0, 8);
}

/**
 * @typedef {Object<string, string[]>} Outfit  slot -> pieces, innermost first
 * @typedef {{ ok: true, outfit: Outfit, location: string|null, pose: string|null, action: string|null, hair: string|null,
 *   makeup: string|null, warnings: string[], notEnglish: string[] }} Reading
 */

/**
 * One parse for the whole answer: where the Kin is, how it is positioned, what it is doing and what it wears.
 * Unknown keys are ignored with a warning; a wrong value type is an error (nothing is guessed). `{}` is valid and
 * means "nothing described".
 * @returns {Reading | Failure}
 */
export function parseReading(text) {
  const parsed = parseObject(text);
  if (!parsed.ok) return parsed;
  const { outfit, warnings, errors } = outfitFromObject(parsed.doc);
  const read = (field, clean) => {
    const key = Object.keys(parsed.doc).find((k) => readingFieldOf(k) === field);
    if (!key || parsed.doc[key] === false) return null;
    const v = clean(parsed.doc[key]);
    if (v === undefined) errors.push(`"${field}" must be a text.`);
    return v ?? null;
  };
  let location = read('location', cleanLocation);
  let pose = read('pose', cleanPose);
  const action = read('action', cleanAction);
  const hair = read('hair', cleanHair);
  const makeup = read('makeup', cleanMakeup);
  // A pose that is really a place ("in the kitchen") is not a pose. It becomes the location if there is none.
  if (pose && isPlaceNotPose(pose)) {
    if (!location) location = cleanLocation(pose);
    pose = null;
  }
  if (errors.length) return { ok: false, error: errors.join(' ') };
  // A model may copy the format example instead of describing itself. That is not a reading.
  if (looksCopiedFromExample(parsed.doc)) return { ok: false, error: 'The Kin copied the example from the question instead of describing itself.' };
  return { ok: true, outfit, location, pose, action, hair, makeup, warnings, notEnglish: notEnglishKeys(parsed.doc) };
}

/**
 * The sentences shown on the card. A partial result (nothing read) gives the "nothing described" sentences.
 * @param {Partial<Reading>} [reading]
 * @returns {{ location: string, doing: string, outfit: string, hair: string, makeup: string }}
 */
export function describeReading({ outfit = {}, location = null, pose = null, action = null, hair = null, makeup = null } = {}) {
  return {
    location: describeLocation(location),
    doing: describeDoing({ pose, action }),
    outfit: describeOutfit(outfit),
    hair: describeHair(hair),
    makeup: describeMakeup(makeup),
  };
}

const inOrder = (outfit, order) => order.flatMap((slot) =>
  // inside a real slot the Kin lists innermost first, so the sentence names the outermost first; a loose group keeps the Kin's order
  (LOOSE_SLOTS.has(slot) ? [...(outfit[slot] || [])] : [...(outfit[slot] || [])].reverse()));

/**
 * The sentence: "Wearing a leather jacket, a perfumed white shirt and blue jeans, with glasses."
 * Underwear is only mentioned when there is nothing else to say about clothing.
 */
export function describeOutfit(given) {
  const outfit = isPlainObject(given) ? given : {};
  let clothing = inOrder(outfit, CLOTHING_ORDER);
  const accessories = inOrder(outfit, ACCESSORY_ORDER);
  if (!clothing.length) clothing = inOrder(outfit, UNDERWEAR_ORDER);
  if (!clothing.length && !accessories.length) return 'No outfit described in the recent chat.';
  if (!clothing.length) return `Accessories: ${joinNatural(accessories)}.`;
  const text = `Wearing ${joinNatural(clothing)}${accessories.length ? `, with ${joinNatural(accessories)}` : ''}.`;
  return capitalizeFirst(text);
}
