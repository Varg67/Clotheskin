// A reading of the Kin: its JSON answer to the reading question, read into the outfit's slots and the short phrases
// (phrases.js), and turned into the card's five sentences: location, pose and action, outfit, hair, makeup.
// Nothing here is saved: every reading stands on its own.
import { ACCESSORY_SLOTS, BAG_SLOT, NOT_DESCRIBED } from './constants.js';
import { readingFieldOf, normalizeSlot, looseGroupOf, isPortugueseKey } from './vocabulary.js';
import { cleanString, capitalizeFirst, joinNatural, nothingSaid } from './text.js';
import { cleanLocation, describeLocation, cleanPose, cleanAction, describeDoing, isPlaceNotPose, cleanHair, cleanMakeup, describeHair, describeMakeup } from './phrases.js';
import { parseJsonObject } from './json.js';
import { looksCopiedFromExample } from './prompt.js';
/** @import { Failure } from './json.js' */

/** Accessories in reading order, then bags. (Clothing is ordered in describeOutfit, with underwear where it shows.) */
const ACCESSORY_ORDER = [...ACCESSORY_SLOTS, BAG_SLOT, 'accessories'];
const CLOTHING_SLOT_SET = new Set(['headwear', 'topwear', 'bottomwear', 'footwear', 'topunderwear', 'bottomunderwear', 'clothing']);
// Beside the slots, an outfit holds how the Kin is ("barefoot", "shirtless") and whether it said it wears nothing.
const STATES = '_states';
const NAKED_KEY = '_naked';

const PLACEHOLDER = nothingSaid({ extra: ['no\\s.*'] }); // "no shoes" is not a piece either
// "unknown top", "none mentioned", "not specified in the chat": no piece.
const PLACEHOLDER_START = /^(unknown|unspecified|none (mentioned|specified|described|stated)|not (mentioned|specified|stated|known|visible|described|given))\b/i;
// Wearing nothing at all (a real roleplay answer): not "no outfit described", which would keep the last clothes.
const NAKED = /^(naked|nude|completely naked|stark naked|undressed|nothing( at all| on)|wearing nothing( at all)?|no clothes( at all)?|not wearing anything)$/i;
// Not a piece but how the Kin is: "Wearing a dress, barefoot."
/** @type {Array<[string, RegExp]>} */
const BARE_STATES = [
  ['barefoot', /^(barefoot(ed)?|bare ?feet|no (shoes|footwear))$/i],
  ['shirtless', /^(shirtless|bare[- ]chested|no shirt)$/i],
  ['topless', /^(topless|no top)$/i],
];
// A piece the Kin says it took off is not worn: "a jacket (taken off)".
const TAKEN_OFF = /\b(taken off|took (it|them) off|removed|discarded|no longer (worn|wearing|on)|not (worn|wearing)|was wearing|on the (floor|chair|bed)|in (her|his|my|their) (hand|hands|bag))\b/i;
const MAX_PER_SLOT = 8;
const MAX_LEN = 80;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const LOOSE_SLOTS = new Set(['clothing', 'accessories']); // pieces grouped without a slot: no layers
const union = (a, b) => [...new Set([...(a || []), ...b])];

/** A piece the Kin wrote as an object ({"item":"shirt","color":"white"}): its words, in a natural order. */
function pieceFromObject(o) {
  const order = ['color', 'colour', 'pattern', 'material', 'fabric', 'style', 'item', 'name', 'type', 'piece', 'garment'];
  const words = order.map((k) => o[k]).filter((v) => typeof v === 'string' && v.trim());
  return words.length ? words.join(' ') : null;
}

/** One written piece as text ("wearing A White Shirt." -> "a White Shirt"), or null when it is no text. */
function pieceText(raw) {
  const text = isPlainObject(raw) ? pieceFromObject(raw) : raw;
  if (typeof text !== 'string') return null;
  return cleanString(text, MAX_LEN).replace(/[.;,]+$/, '')
    .replace(/^(wearing|dressed in|has on|have on)\s+/i, '')       // "wearing a red dress"
    .replace(/^(A|An|The|My)\b/, (w) => w.toLowerCase());          // "A White Shirt" -> "a White Shirt"
}

/** What a written piece is: { piece }, { state } ("barefoot"), { naked }, { nothing } (a bare "none"), or {} (no piece). */
function kindOfPiece(s) {
  if (NAKED.test(s)) return { naked: true };
  const state = BARE_STATES.find(([, re]) => re.test(s));
  if (state) return { state: state[0] };
  if (/^(nothing|none)$/i.test(s)) return { nothing: true };
  if (PLACEHOLDER.test(s) || PLACEHOLDER_START.test(s) || TAKEN_OFF.test(s)) return {};
  return { piece: s };
}

/**
 * One slot's pieces: { pieces, states, naked, nothing } or null (a value that is no text). `states` are "barefoot",
 * "shirtless" and the like; `naked` is an explicit "naked"; `nothing` is a bare "nothing" or "none".
 */
function cleanPieces(v) {
  const out = { pieces: /** @type {string[]} */ ([]), states: /** @type {string[]} */ ([]), naked: false, nothing: false };
  const seen = new Set();
  for (const raw of Array.isArray(v) ? v : [v]) {
    const s = pieceText(raw);
    if (s === null) return null;
    const kind = s ? kindOfPiece(s) : {};
    if (kind.naked) out.naked = true;
    else if (kind.state) out.states = union(out.states, [kind.state]);
    else if (kind.nothing) out.nothing = true;
    else if (kind.piece && !seen.has(kind.piece.toLowerCase())) { seen.add(kind.piece.toLowerCase()); out.pieces.push(kind.piece); }
  }
  out.pieces = out.pieces.slice(0, MAX_PER_SLOT);
  return out;
}

/**
 * The outfit of a parsed answer: { outfit: { slot: [pieces], _states, _naked }, warnings, errors }. The reading's own
 * keys (location, pose, …) are skipped without a warning; a key that is no slot is ignored with one.
 */
function outfitFromObject(doc, nested = false) {
  /** @type {{ outfit: Outfit, warnings: string[], errors: string[], clothingSlots: number, nothingIn: number }} */
  const found = { outfit: {}, warnings: [], errors: [], clothingSlots: 0, nothingIn: 0 };
  for (const [key, value] of Object.entries(doc)) readSlot(found, key, value, nested);
  // "nothing" in every clothing slot the Kin gave ({"topwear":["nothing"],"bottomwear":["nothing"]}) means naked; a
  // lone "nothing" next to real clothes is taken as "not mentioned".
  if (found.nothingIn && found.nothingIn === found.clothingSlots) found.outfit[NAKED_KEY] = true;
  return { outfit: found.outfit, warnings: found.warnings, errors: found.errors };
}

function readSlot(found, key, value, nested) {
  if (readingFieldOf(key)) return;
  const slot = normalizeSlot(key) || looseGroupOf(key);
  if (!slot) { found.warnings.push(`"${key}" is not a slot and was ignored`); return; }
  if (value === null || value === undefined || value === false) return;
  // {"outfit":{"topwear":[…],"bottomwear":[…]}}: a Kin that groups the slots under one key is understood.
  if (LOOSE_SLOTS.has(slot) && isPlainObject(value) && !nested) { mergeFound(found, outfitFromObject(value, true)); return; }
  const got = cleanPieces(value);
  if (got === null) found.errors.push(`"${key}" must be a text or a list of texts.`);
  else addSlot(found, slot, got);
}

/** One slot's pieces, states and "naked" into the outfit; clothing slots that said only "nothing" are counted. */
function addSlot(found, slot, got) {
  addPieces(found.outfit, slot, got.pieces);
  if (got.states.length) found.outfit[STATES] = union(found.outfit[STATES], got.states);
  if (got.naked) found.outfit[NAKED_KEY] = true;
  if (!CLOTHING_SLOT_SET.has(slot)) return;
  found.clothingSlots += 1;
  if (got.nothing && !got.pieces.length) found.nothingIn += 1;
}

const addPieces = (outfit, slot, pieces) => { if (pieces.length) outfit[slot] = [...(outfit[slot] || []), ...pieces]; };

/** A group's outfit into the answer's: pieces added, states joined, "naked" kept (a flag, not a list of pieces). */
function mergeFound(found, inner) {
  for (const [slot, value] of Object.entries(inner.outfit)) {
    if (slot === NAKED_KEY) found.outfit[NAKED_KEY] = true;
    else if (slot === STATES) found.outfit[STATES] = union(found.outfit[STATES], value);
    else addPieces(found.outfit, slot, value);
  }
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
 * @typedef {Object<string, any>} Outfit  slot -> pieces, innermost first; also _states ("barefoot"...) and _naked (true)
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
// A top that also covers the legs: underpants under it are not mentioned.
const ONE_PIECE = /\b(dress|gown|jumpsuit|romper|playsuit|overalls|robe|bathrobe|kimono|onesie|nightgown|nightie|nightdress|sundress|towel|pyjamas|pajamas|pjs)\b/i;
const once = (list) => list.filter((p, i) => list.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);

/** The clothing slots in reading order; underwear only where nothing covers it (a bra with no top, underpants with no bottom). */
function clothingOrder(outfit) {
  const tops = [...(outfit.topwear || []), ...(outfit.clothing || [])];
  const coversTop = tops.length > 0;
  const coversBottom = (outfit.bottomwear || []).length > 0 || (outfit.clothing || []).length > 0 || tops.some((p) => ONE_PIECE.test(p));
  return ['headwear', 'topwear', ...(coversTop ? [] : ['topunderwear']), 'bottomwear', ...(coversBottom ? [] : ['bottomunderwear']), 'footwear', 'footunderwear', 'clothing'];
}

/** "barefoot", "shirtless": how the Kin is. "barefoot" with shoes or socks is a contradiction: the pieces win. */
function statesOf(outfit) {
  const footed = (outfit.footwear || []).length > 0 || (outfit.footunderwear || []).length > 0;
  return (outfit[STATES] || []).filter((s) => !(s === 'barefoot' && footed));
}

/**
 * The sentence: "Wearing a leather jacket, a perfumed white shirt and blue jeans, with glasses."
 * Underwear is mentioned where nothing covers it (real test: "a purple shirt" alone hid that the Kin wore no
 * trousers). A piece in two slots is said once. "Not wearing anything" for a Kin that says it is naked; "barefoot"
 * or "shirtless" after the pieces.
 */
export function describeOutfit(given) {
  const outfit = isPlainObject(given) ? given : {};
  const clothing = once(inOrder(outfit, clothingOrder(outfit)));
  const accessories = once(inOrder(outfit, ACCESSORY_ORDER));
  const states = statesOf(outfit);
  const extra = (s) => `${s}${states.length ? `, ${joinNatural(states)}` : ''}.`;
  const withAcc = accessories.length ? `, with ${joinNatural(accessories)}` : '';
  if (!clothing.length && outfit[NAKED_KEY]) return extra(`Not wearing anything${withAcc}`);
  if (!clothing.length && !accessories.length && !states.length) return NOT_DESCRIBED.outfit;
  if (!clothing.length && !accessories.length) return capitalizeFirst(`${joinNatural(states)}.`);
  if (!clothing.length) return extra(`Accessories: ${joinNatural(accessories)}`);
  return capitalizeFirst(extra(`Wearing ${joinNatural(clothing)}${withAcc}`));
}
