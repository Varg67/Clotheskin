// A reading of the Kin: its JSON answer to the reading question, read into the outfit's slots and the short phrases
// (phrases.js), and turned into the card's five sentences: location, pose and action, outfit, hair, makeup.
// Nothing here is saved: every reading stands on its own.
import { ACCESSORY_SLOTS, BAG_SLOT, CLOTHING_SLOTS, NOT_DESCRIBED } from './constants.js';
import { readingFieldOf, normalizeSlot, looseGroupOf, isPortugueseKey } from './vocabulary.js';
import { cleanString, capitalizeFirst, joinNatural, nothingSaid } from './text.js';
import { cleanLocation, describeLocation, cleanPose, cleanAction, describeDoing, isPlaceNotPose, cleanHair, cleanMakeup, describeHair, describeMakeup } from './phrases.js';
import { currentObservation } from './scene.js';
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
const union = (a, b = []) => [...new Set([...(a || []), ...b])];

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
  if (state) return { state: state[0], shoesOff: /^no (shoes|footwear)$/i.test(s) };
  if (/^(nothing|none)$/i.test(s)) return { nothing: true };
  if (TAKEN_OFF.test(s)) {
    const item = s.split(TAKEN_OFF)[0].replace(/[,;( -]+$/, '').trim() || s.replace(/^(?:removed|not wearing|no longer wearing)\s+/i, '');
    return item && !TAKEN_OFF.test(item) ? { removed: item } : {};
  }
  if (/^no (?:earrings|jewelry|rings|necklace|bracelet|hat|gloves|bag|socks|underwear|pants|trousers)$/i.test(s)) return { nothing: true };
  if (PLACEHOLDER.test(s) || PLACEHOLDER_START.test(s)) return {};
  return { piece: s };
}

function addPiece(out, kind, seen) {
  if (kind.shoesOff) out.shoesOff = true;
  if (kind.naked) out.naked = true;
  else if (kind.state) out.states = union(out.states, [kind.state]);
  else if (kind.nothing) out.nothing = true;
  else if (kind.removed) out.removed.push(kind.removed);
  else if (kind.piece && !seen.has(kind.piece.toLowerCase())) { seen.add(kind.piece.toLowerCase()); out.pieces.push(kind.piece); }
}

/**
 * One slot's pieces: { pieces, states, naked, nothing } or null (a value that is no text). `states` are "barefoot",
 * "shirtless" and the like; `naked` is an explicit "naked"; `nothing` is a bare "nothing" or "none".
 */
function cleanPieces(v, name) {
  const out = { pieces: /** @type {string[]} */ ([]), states: /** @type {string[]} */ ([]),
    removed: /** @type {string[]} */ ([]), naked: false, nothing: false, shoesOff: false };
  const seen = new Set();
  for (const raw of Array.isArray(v) ? v : [v]) {
    const piece = pieceText(raw);
    const s = typeof piece === 'string' && name ? currentObservation(piece, name) : piece;
    if (piece !== null && s === null) continue;
    if (s === null) return null;
    const kind = s ? kindOfPiece(s) : {};
    addPiece(out, kind, seen);
  }
  out.pieces = out.pieces.slice(0, MAX_PER_SLOT);
  return out;
}

/**
 * The outfit of a parsed answer: { outfit: { slot: [pieces], _states, _naked }, warnings, errors }. The reading's own
 * keys (location, pose, …) are skipped without a warning; a key that is no slot is ignored with one.
 */
function outfitFromObject(doc, name, nested = false) {
  /** @type {{ outfit: Outfit, warnings: string[], errors: string[], clothingSlots: number, nothingIn: number }} */
  const found = { outfit: {}, warnings: [], errors: [], clothingSlots: 0, nothingIn: 0 };
  for (const [key, value] of Object.entries(doc)) readSlot(found, key, value, { nested, name });
  // "nothing" in every clothing slot the Kin gave ({"topwear":["nothing"],"bottomwear":["nothing"]}) means naked; a
  // lone "nothing" next to real clothes is taken as "not mentioned".
  if (!found.outfit[NAKED_KEY] && found.nothingIn && found.nothingIn === found.clothingSlots) {
    found.outfit[NAKED_KEY] = true;
    found.outfit._inferredNaked = true;
  }
  return { outfit: found.outfit, warnings: found.warnings, errors: found.errors };
}

function readSlot(found, key, value, { nested, name }) {
  if (readingFieldOf(key)) return;
  const slot = normalizeSlot(key) || looseGroupOf(key);
  if (!slot) { found.warnings.push(`"${key}" is not a slot and was ignored`); return; }
  if (value === null || value === undefined || value === false) return;
  // {"outfit":{"topwear":[…],"bottomwear":[…]}}: a Kin that groups the slots under one key is understood.
  if (LOOSE_SLOTS.has(slot) && isPlainObject(value) && !nested) { mergeFound(found, outfitFromObject(value, name, true)); return; }
  const got = cleanPieces(value, name);
  if (got === null) found.errors.push(`"${slot}" must be a text or a list of texts.`);
  else addSlot(found, slot, got);
}

/** One slot's pieces, states and "naked" into the outfit; clothing slots that said only "nothing" are counted. */
function addSlot(found, slot, got) {
  addPieces(found.outfit, slot, got.pieces);
  if (got.states.length) found.outfit[STATES] = union(found.outfit[STATES], got.states);
  if (got.naked) found.outfit[NAKED_KEY] = true;
  if (got.nothing && !got.pieces.length) found.outfit._empty = union(found.outfit._empty, [slot]);
  if (got.shoesOff) found.outfit._shoesOff = true;
  if (got.removed.length) {
    found.outfit._removed ??= {};
    addPieces(found.outfit._removed, slot, got.removed);
  }
  if (!CLOTHING_SLOT_SET.has(slot)) return;
  found.clothingSlots += 1;
  if (got.nothing && !got.pieces.length) found.nothingIn += 1;
}

const addPieces = (outfit, slot, pieces) => { if (pieces.length) outfit[slot] = [...(outfit[slot] || []), ...pieces]; };

/** A group's outfit into the answer's: pieces added, states joined, "naked" kept (a flag, not a list of pieces). */
function mergeFound(found, inner) {
  for (const [slot, value] of Object.entries(inner.outfit)) {
    if (slot === NAKED_KEY || slot === '_shoesOff' || slot === '_inferredNaked') found.outfit[slot] = true;
    else if (slot === STATES || slot === '_empty') found.outfit[slot] = union(found.outfit[slot], value);
    else if (slot === '_removed') {
      found.outfit._removed ??= {};
      for (const [which, items] of Object.entries(value)) addPieces(found.outfit._removed, which, items);
    } else addPieces(found.outfit, slot, value);
  }
  found.warnings.push(...inner.warnings);
  found.errors.push(...inner.errors);
}

/** @returns {{ ok: true, doc: Object<string, any> } | Failure} */
function parseObject(text, name) {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return parsed;
  // A Kin that wraps its one object in a list ([{...}]) is understood.
  const value = Array.isArray(parsed.value) && parsed.value.length === 1 && isPlainObject(parsed.value[0]) ? parsed.value[0] : parsed.value;
  if (!isPlainObject(value)) return { ok: false, error: 'The answer must be a JSON object.' };
  return { ok: true, doc: openWrapper(value, name) };
}

/** {"Isa":{…}} or {"status":{…}}: one key holding the real answer is opened, if the answer is inside it. */
function openWrapper(doc, name) {
  const keys = Object.keys(doc);
  if (keys.length !== 1) return doc;
  const [key] = keys;
  const inner = doc[key];
  const isOwnKey = (k) => readingFieldOf(k) || normalizeSlot(k);
  const wraps = isPlainObject(inner) && !normalizeSlot(key) && !looseGroupOf(key) && Object.keys(inner).some(isOwnKey);
  if (!wraps) return doc;
  if (name && key.toLowerCase() !== name.toLowerCase() && !/^(status|reading|result|response|data|kin|character|scene)$/i.test(key)) return {};
  return inner;
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
 *   makeup: string|null, endedAction?: string, excludedLocation?: string, warnings: string[], notEnglish: string[] }} Reading
 */

/**
 * One parse for the whole answer: where the Kin is, how it is positioned, what it is doing and what it wears.
 * Unknown keys are ignored with a warning; a wrong value type is an error (nothing is guessed). `{}` is valid and
 * means "nothing described".
 * @returns {Reading | Failure}
 */
export function parseReading(text, name = '') {
  const parsed = parseObject(text, name);
  if (!parsed.ok) return parsed;
  const { outfit, warnings, errors } = outfitFromObject(parsed.doc, name);
  let endedAction = null;
  let excludedLocation = null;
  const read = (field, clean) => {
    const key = Object.keys(parsed.doc).find((k) => readingFieldOf(k) === field);
    if (!key || parsed.doc[key] === false) return null;
    const value = currentObservation(parsed.doc[key], name);
    if (field === 'location' && typeof value === 'string') {
      const absent = value.match(/^(?:(?:I am|I'm|I’m)\s+)?(?:not|no longer)\s+((?:at|in|on|inside|outside)\s+.+)$/i);
      if (absent) { excludedLocation = describeLocation(cleanLocation(absent[1])); return null; }
    }
    if (field === 'action' && typeof value === 'string') {
      const end = value.replace(/^[*\s]+|[*.!\s]+$/g, '').match(/^(?:(?:I|she|he|they)\s+)?(?:just\s+)?(?:stopped|finished|no longer)\s+(.+)$/i);
      if (end) { endedAction = cleanAction(end[1]); return null; }
    }
    const v = clean(value);
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
  return { ok: true, outfit, location, pose, action, hair, makeup, ...(endedAction ? { endedAction } : {}),
    ...(excludedLocation ? { excludedLocation } : {}), warnings, notEnglish: notEnglishKeys(parsed.doc) };
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
// Earlier versions saved only the rendered sentence. Keep its clothing and accessories as loose groups
// until an observation identifies individual slots. Do not guess what an older English item belongs to.
function legacyWardrobe(sentence) {
  if (typeof sentence !== 'string') return {};
  const [main, accessories] = sentence.replace(/\.$/, '').split(', with ');
  const outfit = {};
  if (main.startsWith('Wearing ')) outfit.clothing = [main.slice(8)];
  if (main.startsWith('Not wearing anything')) outfit._naked = true;
  if (accessories) outfit.accessories = [accessories];
  else if (main.startsWith('Accessories: ')) outfit.accessories = [main.slice(13)];
  return outfit;
}

const GARMENTS = [...CLOTHING_SLOTS, 'clothing'];
const stateSlots = { barefoot: ['footwear', 'footunderwear'], shirtless: ['topwear'], topless: ['topwear', 'topunderwear'] };
const garmentName = (s) => s.toLowerCase().replace(/^(?:a|an|the|my|her|his|their)\s+/, '');

/** A loose group and its individually named slots are alternate representations of the same clothes. */
function replaceGroups(wardrobe, observation) {
  /** @type {Array<[string[], string]>} */
  const groups = [[GARMENTS, 'clothing'], [ACCESSORY_ORDER, 'accessories']];
  for (const [slots, group] of groups) {
    if (observation[group]) for (const slot of slots) delete wardrobe[slot];
    else if (slots.some((slot) => observation[slot])) delete wardrobe[group];
  }
}

function removeItem(wardrobe, slot, item) {
  const name = garmentName(item);
  const matches = (p) => garmentName(p) === name || garmentName(p).endsWith(' ' + name);
  if (wardrobe[slot]) wardrobe[slot] = wardrobe[slot].filter((p) => !matches(p));
  // A legacy aggregate cannot safely be edited item by item.
  const group = GARMENTS.includes(slot) ? 'clothing' : 'accessories';
  if (wardrobe[group]?.some((p) => garmentName(p).includes(name))) delete wardrobe[group];
}

function removeClothes(wardrobe, observation) {
  const removed = [];
  for (const [slot, items] of Object.entries(observation._removed || {})) {
    for (const item of items) {
      removed.push(item);
      removeItem(wardrobe, slot, item);
    }
  }
  for (const slot of observation._empty || []) {
    if (wardrobe[slot]) removed.push(...wardrobe[slot]);
    delete wardrobe[slot];
  }
  return removed;
}

function applyBareStates(wardrobe, observation, naked) {
  if (naked) {
    for (const slot of GARMENTS) delete wardrobe[slot];
    delete wardrobe._states;
    wardrobe._naked = true;
  }
  for (const state of observation._states || []) {
    const slots = state === 'barefoot' && observation._shoesOff ? ['footwear'] : stateSlots[state];
    for (const slot of slots) delete wardrobe[slot];
    delete wardrobe.clothing;
  }
}

function applyPieces(wardrobe, observation) {
  if (observation.topwear?.some((p) => ONE_PIECE.test(p))) delete wardrobe.bottomwear;
  if (observation.bottomwear && wardrobe.topwear?.some((p) => ONE_PIECE.test(p))) delete wardrobe.topwear;
  for (const slot of [...GARMENTS, ...ACCESSORY_ORDER]) {
    if (observation[slot]) wardrobe[slot] = observation[slot];
    else if (!wardrobe[slot]?.length) delete wardrobe[slot];
  }
  if (GARMENTS.some((slot) => observation[slot])) delete wardrobe._naked;
  const visible = union(wardrobe._states, observation._states)
    .filter((state) => !stateSlots[state].some((slot) => wardrobe[slot]?.length));
  if (visible.length) wardrobe._states = visible;
  else delete wardrobe._states;
}

/** Apply only the slots observed this turn. An omitted slot is still the last known one. */
export function updateWardrobe(observation, previous) {
  if (!Object.keys(observation).length) return {};
  const wardrobe = { ...(previous?.wardrobe || legacyWardrobe(previous?.outfit)) };
  // One empty slot doesn't contradict a known garment elsewhere. An explicit "naked" still clears all garments.
  const inferred = observation._inferredNaked && !observation._empty.includes('clothing');
  const otherClothes = inferred && GARMENTS.some((slot) => wardrobe[slot] && !observation._empty.includes(slot));
  const removed = removeClothes(wardrobe, observation);
  replaceGroups(wardrobe, observation);
  applyBareStates(wardrobe, observation, observation._naked && !otherClothes);
  applyPieces(wardrobe, observation);
  const outfit = describeOutfit(wardrobe);
  // Removing the last known piece doesn't establish nudity. The negative fact also replaces its old memory.
  return { wardrobe, outfit: outfit === NOT_DESCRIBED.outfit && removed.length ? `No longer wearing ${joinNatural(removed)}.` : outfit };
}

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
