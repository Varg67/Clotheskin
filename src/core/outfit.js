// The whole "tracker" logic: read the Kin's JSON, put its branches in order, add commas, show a sentence.
// Nothing here is saved: every reading stands on its own.
// Five sentences: location, pose and action, outfit, hair, makeup.
import { ACCESSORY_SLOTS, BAG_SLOT, WEAR_SLOTS } from './constants.js';
import { cleanString, capitalizeFirst } from './text.js';
import { parseJsonObject } from './json.js';
import { looksCopiedFromExample } from './prompt.js';
/** @import { Failure } from './json.js' */

/** Key matching ignores case, spaces, underscores and hyphens: "Top Wear", "top_wear" and "topwear" are one key. */
// Accents are dropped so a Kin that translates the keys ("localização", "maquiagem") still matches.
const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const keyName = (k) => fold(k).replace(/[\s_-]+/g, '');

// ---- slot words: the identifiers are obscure ("topunderwear"), so common slips are understood
const SLOT_ALIASES = (() => {
  const m = Object.fromEntries(WEAR_SLOTS.map((s) => [keyName(s), s]));
  Object.assign(m, {
    top: 'topwear', tops: 'topwear', bottom: 'bottomwear', bottoms: 'bottomwear',
    shoes: 'footwear', shoe: 'footwear', boots: 'footwear', hat: 'headwear', cap: 'headwear',
    socks: 'footunderwear', stockings: 'footunderwear', tights: 'footunderwear',
    bra: 'topunderwear', undershirt: 'topunderwear', underwear: 'bottomunderwear', underpants: 'bottomunderwear', panties: 'bottomunderwear',
    glasses: 'eyes-accessory', necklace: 'neck-accessory', earrings: 'ears-accessory', bracelet: 'arms-accessory', watch: 'arms-accessory',
    ring: 'hands-accessory', gloves: 'hands-accessory', belt: 'waist-accessory', bag: 'bags', backpack: 'bags', handbag: 'bags',
    // a Kin chatting in Portuguese may translate the slot names
    sapatos: 'footwear', calcados: 'footwear', tenis: 'footwear', chapeu: 'headwear', bone: 'headwear', meias: 'footunderwear',
    oculos: 'eyes-accessory', colar: 'neck-accessory', brincos: 'ears-accessory', pulseira: 'arms-accessory', relogio: 'arms-accessory',
    anel: 'hands-accessory', cinto: 'waist-accessory', bolsa: 'bags', mochila: 'bags', bolsas: 'bags',
  });
  return m;
})();
// Own keys only: "constructor" or "toString" from the Kin must not find Object's built-ins.
export const normalizeSlot = (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(SLOT_ALIASES, keyName(v)) ? SLOT_ALIASES[keyName(v)] : undefined);

// A Kin that ignores the slot names and answers {"clothing":[...],"accessories":[...]} is still understood.
const LOOSE_CLOTHING = new Set(['clothing', 'clothes', 'outfit', 'wearing', 'garments', 'roupa', 'roupas', 'vestindo', 'traje', 'vestuario']);
const LOOSE_ACCESSORIES = new Set(['accessories', 'accessory', 'extras', 'jewelry', 'jewellery', 'acessorios', 'acessorio', 'joias']);

/** Branches in reading order: head to toe, then accessories, then bags. Underwear goes last (see describe). */
const CLOTHING_ORDER = ['headwear', 'topwear', 'bottomwear', 'footwear', 'footunderwear', 'clothing'];
const UNDERWEAR_ORDER = ['topunderwear', 'bottomunderwear'];
const ACCESSORY_ORDER = [...ACCESSORY_SLOTS, BAG_SLOT, 'accessories'];

const PLACEHOLDER = /^(unknown|unspecified|undefined|null|none|nothing|no\s.*|not (mentioned|specified|stated|known|visible|described)|n\/?a|-+|\?+)$/i;
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

// The Kin may name the key differently; all of these mean "where you are".
const isLocationKey = (k) => ['location', 'place', 'where', 'currentlocation', 'currentplace', 'localizacao', 'local', 'lugar', 'onde'].includes(keyName(k));
// "position" counts as pose: it was the original name of that field.
const isPoseKey = (k) => ['pose', 'posture', 'position', 'stance', 'bodyposition', 'postura', 'posicao'].includes(keyName(k));
const isActionKey = (k) => ['action', 'activity', 'doing', 'doingnow', 'currentaction', 'currentactivity', 'currentlydoing', 'acao', 'atividade', 'fazendo'].includes(keyName(k));
const isHairKey = (k) => ['hair', 'hairstyle', 'hairdo', 'haircut', 'cabelo', 'penteado'].includes(keyName(k));
const isMakeupKey = (k) => ['makeup', 'cosmetics', 'facemakeup', 'maquiagem', 'maquilhagem'].includes(keyName(k));
const isReadingKey = (k) => isLocationKey(k) || isPoseKey(k) || isActionKey(k) || isHairKey(k) || isMakeupKey(k);

/** Slots from a parsed JSON object. Location, pose and action belong to the reading, so they are skipped here without a warning. */
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function outfitFromObject(doc, nested = false) {
  const outfit = {};
  const warnings = [];
  const errors = [];
  for (const [key, value] of Object.entries(doc)) {
    if (isReadingKey(key)) continue;
    let slot = normalizeSlot(key);
    if (!slot && LOOSE_CLOTHING.has(keyName(key))) slot = 'clothing';
    if (!slot && LOOSE_ACCESSORIES.has(keyName(key))) slot = 'accessories';
    if (!slot) { warnings.push(`"${key}" is not a slot and was ignored`); continue; }
    if (value === null || value === undefined || value === false) continue;
    // {"outfit":{"topwear":[…],"bottomwear":[…]}}: a Kin that groups the slots under one key is understood.
    if ((slot === 'clothing' || slot === 'accessories') && isPlainObject(value) && !nested) {
      const inner = outfitFromObject(value, true);
      for (const [sl, pieces] of Object.entries(inner.outfit)) outfit[sl] = [...(outfit[sl] || []), ...pieces];
      warnings.push(...inner.warnings); errors.push(...inner.errors);
      continue;
    }
    const pieces = cleanPieces(value);
    if (pieces === null) { errors.push(`"${key}" must be a text or a list of texts.`); continue; }
    if (pieces.length) outfit[slot] = [...(outfit[slot] || []), ...pieces];
  }
  return { outfit, warnings, errors };
}

/** @returns {{ ok: true, doc: Object<string, any> } | Failure} */
function parseObject(text) {
  const parsed = parseJsonObject(text);
  if (parsed.ok === false) return parsed;
  let doc = parsed.value;
  // A Kin that wraps its one object in a list ([{...}]) is understood.
  if (Array.isArray(doc) && doc.length === 1 && doc[0] && typeof doc[0] === 'object' && !Array.isArray(doc[0])) doc = doc[0];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'The answer must be a JSON object.' };
  // {"Isa":{…}} or {"status":{…}}: one key holding the real answer is opened, if the answer is inside it.
  const keys = Object.keys(doc);
  if (keys.length === 1 && isPlainObject(doc[keys[0]]) && !normalizeSlot(keys[0]) && !LOOSE_CLOTHING.has(keyName(keys[0])) && !LOOSE_ACCESSORIES.has(keyName(keys[0]))
    && Object.keys(doc[keys[0]]).some((k) => isReadingKey(k) || normalizeSlot(k))) doc = doc[keys[0]];
  return { ok: true, doc };
}

// ---- shared cleanup for location, pose and action
const CLOTHES_CLAUSE = /\s*[,;–—-]?\s*\b(wearing|dressed)\b.*$/i; // "…, wearing a robe"

/** Shared first step: text, a list of texts (joined) or nothing. Returns string | null | undefined (wrong type). */
function rawText(v, max) {
  if (v === null || v === undefined) return null;
  let s;
  if (Array.isArray(v)) {
    if (v.some((x) => typeof x !== 'string')) return undefined;
    s = v.map((x) => x.trim()).filter(Boolean).slice(0, 3).join(', ');
  } else if (typeof v === 'string') s = v;
  else return undefined;
  return cleanString(s, max).replace(/^[\s*_"'“”‘’()[\]]+/, '').replace(/[\s*_"'“”‘’()[\]]+$/, '').replace(/[.;,!?\s]+$/, '');
}

/** Cuts at a word boundary and marks the cut with "…". */
const clipWords = (s, max) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s);

// ---- location: a short phrase that already starts with in / at / on ("in the kitchen", "at the hospital")
const EN_PREP = 'in|inside|at|on|outside|near|nearby|by|under|over|above|below|around|across|along|between|beside|behind|next|close|through|from|to|towards?|back|upstairs|downstairs';
const MOTION = 'heading|going|walking|driving|travell?ing|commuting|returning|coming|leaving|riding|flying|running|jogging|cycling|biking|sailing';
const PT_PREP = 'em|na|no|nas|nos|numa|num|ao|à|aos|às|pra|para|de|da|do|das|dos|perto|dentro|fora|sobre|sob|entre|até';
const STARTS_PLACE = new RegExp(`^(${EN_PREP}|${MOTION}|on the way)\\b`, 'i');
const STARTS_PORTUGUESE = new RegExp(`^(${PT_PREP})(?=\\s|$)`, 'i'); // \b is unreliable with accents
const IS_MOTION = new RegExp(`^(${MOTION})$`, 'i');
const NO_PLACE = /^(unknown|unspecified|undefined|null|none|nothing|nowhere|somewhere( else)?|elsewhere|unclear|unsure|no (specific |particular )?(place|location)|not (mentioned|specified|stated|known|visible|described|sure|clear)|n\/?a|-+|\?+)$/i;
const MAX_LOCATION = 120;

/**
 * Cleans the Kin's location. Returns a string, null (nothing stated) or undefined (wrong type).
 * The Kin is asked for the place only, so the usual slips are repaired: markdown and quotes around it, a posture or
 * activity in front of it ("sitting on the sofa in the living room"), a clause after it (", cooking dinner",
 * "while reading", "wearing a robe"), or a list instead of a text.
 */
export function cleanLocation(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  // "I'm in the kitchen right now", "She is at the hospital": the subject and the time words go.
  s = s.replace(/^((currently|right now|still|now)\s+)?((i|she|he|they|we)\s+(am|is|are|['’]?m)|i['’]m|she['’]s|he['’]s|they['’]re|we['’]re)\s+((currently|still|now|just)\s+)?/i, '')
    .replace(/^(currently|right now|still|now)\s+(?=(in|at|on|inside|outside|near)\b)/i, '')
    .replace(/[\s,]+(right now|at the moment|currently|now|still)$/i, '');
  s = s.replace(CLOTHES_CLAUSE, '')                                          // clothes do not belong here
    .replace(/\s*[,;]\s*[A-Za-z]+ing\b.*$/i, '')                           // ", cooking dinner"
    .replace(/\s+(while|as|and)\s+[A-Za-z]+ing\b.*$/i, '')                 // "while reading"
    .replace(/[.;,!?\s]+$/, '');
  // A lowercase posture or activity first ("sitting on the sofa", "cooking in the kitchen") is dropped when a place follows.
  const lead = s.match(/^([a-z]+ing|seated|perched|sat|stood|lay)(?:\s+(.*))?$/);
  if (lead && !IS_MOTION.test(lead[1])) {
    const rest = (lead[2] || '').trim();
    if (STARTS_PLACE.test(rest) || STARTS_PORTUGUESE.test(rest)) s = rest;
    else return null; // a posture with no place in it
  }
  if (!s || NO_PLACE.test(s)) return null;
  return clipWords(s, MAX_LOCATION);
}

/**
 * "in the kitchen" -> "In the kitchen." Only a bare noun phrase is adjusted: articles and proper names get "in",
 * "home" gets "at"; any other bare word, and anything Portuguese, is shown as written.
 */
export function describeLocation(value) {
  if (!value) return 'No location described in the recent chat.';
  const v = value.trim();
  let phrase = v;
  if (STARTS_PLACE.test(v) || STARTS_PORTUGUESE.test(v)) phrase = v;
  else if (/^home$/i.test(v)) phrase = 'at home';
  else if (/^(the|a|an|my|our|his|her|their|your)\b/i.test(v) || /^[A-Z]/.test(v)) phrase = `in ${v}`;
  return capitalizeFirst(phrase.endsWith('…') ? phrase : `${phrase}.`);
}

// ---- pose and action
const NO_VALUE = /^(unknown|unspecified|undefined|null|none|nothing|not (mentioned|specified|stated|known|visible|described|sure|clear)|n\/?a|-+|\?+)$/i;
const NO_ACTION = /^(nothing( in particular| special)?|doing nothing|idle|no (specific |particular )?(action|activity))$/i;
const PLAN_OR_PAST = /^(will|would|about to|planning to|plans? to|wants? to|wanted to|hoping to|used to|finished|stopped|was|were|had|just (finished|stopped))\b/i;
// "going to the store" is movement in progress; "going to read" is a plan. Future time words are plans too.
const GOING_TO_VERB = /^going to (read|eat|drink|sleep|take|make|cook|watch|play|call|write|study|have|get|buy|try|go|do|see|meet|visit|clean|wash|work|start|check|lie|sit|relax|rest|shower|bathe|leave|head|text|ask|tell|order)\b/i;
const FUTURE_WORD = /\b(later|tomorrow|soon|tonight|afterwards|next (week|time)|in a (bit|moment|while)|in \d+ (minutes?|hours?))\b/i;
const FEELING = /^(feeling|being|seeming)\b/i; // a state of mind is not an action
const SUBJECT = /^((currently|right now|now|just)\s+)?((i|she|he|they|we)\s+(am|is|are)|i['’]m|she['’]s|he['’]s|they['’]re|am|is|are)\s+((currently|right now|now|just)\s+)?/i;
const PLACE_ONLY_START = /^(in|at|inside|outside|near|nearby)\b/i;
const POSTURE_WORD = /\b(sitting|seated|standing|lying|laying|leaning|kneeling|crouching|squatting|reclining|resting|lounging|walking|sleeping|slouching|perched|curled|stretched)\b/i;
const MAX_DOING = 80;

/** The body position ("sitting on the sofa"). Returns string | null | undefined. */
export function cleanPose(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  s = s.replace(CLOTHES_CLAUSE, '').replace(/[.;,!?\s]+$/, '');
  if (!s || NO_VALUE.test(s) || NO_ACTION.test(s)) return null;
  return clipWords(s, MAX_DOING);
}

/** What the Kin is doing now ("drinking coffee"). Plans and things already finished are not an action. */
export function cleanAction(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  let prev;
  do { prev = s; s = s.replace(/^((currently|right now|now|just|still|actually)\s+)+/i, '').replace(SUBJECT, ''); } while (s !== prev);
  s = s.replace(/[.;,!?\s]+$/, '');
  if (!s || NO_VALUE.test(s) || NO_ACTION.test(s) || PLAN_OR_PAST.test(s) || GOING_TO_VERB.test(s) || FUTURE_WORD.test(s) || FEELING.test(s)) return null;
  return clipWords(s, MAX_DOING);
}

/**
 * "Sitting on the sofa, drinking coffee." Pose first, then the action; an action already inside the pose is not repeated.
 * @param {{ pose?: string|null, action?: string|null }} [doing]
 */
export function describeDoing({ pose, action } = {}) {
  const parts = [];
  if (pose) parts.push(pose);
  if (action && !(pose && pose.toLowerCase().includes(action.toLowerCase()))) parts.push(action);
  if (!parts.length) return 'No pose or action described in the recent chat.';
  const text = parts.join(', ');
  return capitalizeFirst(text.endsWith('…') ? text : `${text}.`);
}

// ---- hair and makeup: one short phrase each ("long black hair in a ponytail", "red lipstick and eyeliner")
const NO_HAIR = 'No hair described in the recent chat.';
const NO_MAKEUP = 'No makeup described in the recent chat.';
const MAX_LOOK = 100;
// Saying "none" may mean "not mentioned"; only an explicit "no makeup" means a bare face.
const BARE_FACE = /^(no make-?up( at all)?|without (any )?make-?up|make-?up[- ]free|bare[- ]?faced?|a bare face|natural,? no make-?up|((i|she|he)\s*(['’]m|am|is|['’]s)\s+)?not wearing (any )?make-?up( at all| today)?)$/i;

/** Text or a list of texts as one phrase. Returns string | null | undefined (wrong type). */
function lookPhrase(v) {
  if (v === null || v === undefined) return null;
  let s;
  if (Array.isArray(v)) {
    if (v.some((x) => typeof x !== 'string')) return undefined;
    s = joinNatural(v.map((x) => cleanString(x, MAX_LOOK).replace(/[.;,!?\s]+$/, '')).filter(Boolean).slice(0, 4));
  } else if (typeof v === 'string') s = v;
  else return undefined;
  s = cleanString(s, 400).replace(/^[\s*_"'“”‘’()[\]]+/, '').replace(/[\s*_"'“”‘’()[\]]+$/, '').replace(/[.;,!?\s]+$/, '')
    .replace(/^(my|her|his|their) (hair|make-?up) (is|are)\s+/i, '')
    .replace(/^((i|she|he)\s+(have|has|['’]ve got|has got|am wearing|is wearing)|i['’]ve got|(she|he)['’]s got|i['’]m wearing|she['’]s wearing|he['’]s wearing|wearing)\s+/i, '');
  if (!s || NO_VALUE.test(s)) return null;
  return s.length > MAX_LOOK ? `${s.slice(0, MAX_LOOK).replace(/\s+\S*$/, '')}…` : s;
}

function cleanMakeup(v) {
  if (typeof v === 'string' && BARE_FACE.test(cleanString(v, 200).replace(/[.!\s]+$/, ''))) return 'no makeup';
  const s = lookPhrase(v);
  return typeof s === 'string' && BARE_FACE.test(s) ? 'no makeup' : s;
}

const sentence = (s) => capitalizeFirst(s.endsWith('…') ? s : `${s}.`);
/** "Long black hair in a ponytail." */
const describeHair = (value) => (value ? sentence(value) : NO_HAIR);
/** "Red lipstick and eyeliner." / "No makeup." */
const describeMakeup = (value) => (value ? sentence(value) : NO_MAKEUP);

// ---- English only: the Kin is asked to answer in English (fewer tokens, and the sentences are English). Portuguese
// keys and values are still read, but they are reported so the diagnostics show whether the Kin follows the rule.
const PT_KEYS = new Set(['localizacao', 'local', 'lugar', 'onde', 'postura', 'posicao', 'acao', 'atividade', 'fazendo', 'cabelo', 'penteado', 'maquiagem', 'maquilhagem',
  'roupa', 'roupas', 'vestindo', 'traje', 'vestuario', 'acessorios', 'acessorio', 'joias', 'sapatos', 'calcados', 'tenis', 'chapeu', 'bone', 'meias', 'oculos', 'colar',
  'brincos', 'pulseira', 'relogio', 'anel', 'cinto', 'bolsa', 'bolsas', 'mochila']);
const PT_WORDS = 'uma|um|umas|uns|com|na|nas|nos|da|das|dos|em|sem|meu|minha|seu|sua|estou|está|esta|sentada|sentado|deitada|deitado|vestindo|usando|calça|calca|camisa|camiseta|vestido|saia|jaqueta|casaco|tênis|sapato|sapatos|bota|botas|meia|meias|bolsa|mochila|óculos|colar|brinco|brincos|cabelo|preso|presa|solto|solta|batom|maquiagem|rímel|sala|quarto|cozinha|banheiro|casa|cama|sofá|tomando|lendo|bebendo|olhando|conversando|cozinhando';
const PT_WORD = new RegExp(`(?<![\\p{L}.])(${PT_WORDS})(?![\\p{L}])`, 'iu');
// ã or õ inside a lowercase word ("algodão", "botões"); a capitalised name ("São Paulo") is a place, not a slip.
// ç alone is not enough: English has "façade". Portuguese words with ç ("calça") are in the list above.
const PT_ACCENT = /(?<!\p{L})[a-zà-ÿ]*[ãõ][a-zà-ÿ]*(?!\p{L})/u;
const PT_TEXT = { test: (t) => PT_WORD.test(t) || PT_ACCENT.test(t) };
const textsOf = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(textsOf) : isPlainObject(v) ? Object.entries(v).flatMap(([k, x]) => [k, ...textsOf(x)]) : []);

/** The keys of an answer that were written (key or value) in Portuguese instead of English. At most 8. */
export function notEnglishKeys(doc) {
  if (!isPlainObject(doc)) return [];
  return Object.entries(doc).filter(([k, v]) => PT_KEYS.has(keyName(k)) || textsOf(v).some((t) => PT_TEXT.test(t))).map(([k]) => String(k).slice(0, 30)).slice(0, 8);
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
  const p = parseObject(text);
  if (p.ok === false) return p;
  const { outfit, warnings, errors } = outfitFromObject(p.doc);
  const keyOf = (test) => Object.keys(p.doc).find(test);
  const read = (test, clean, label) => {
    const key = keyOf(test);
    if (!key || p.doc[key] === false) return null;
    const v = clean(p.doc[key]);
    if (v === undefined) errors.push(`"${label}" must be a text.`);
    return v ?? null;
  };
  let location = read(isLocationKey, cleanLocation, 'location');
  let pose = read(isPoseKey, cleanPose, 'pose');
  const action = read(isActionKey, cleanAction, 'action');
  const hair = read(isHairKey, lookPhrase, 'hair');
  const makeup = read(isMakeupKey, cleanMakeup, 'makeup');
  // A pose that is really a place ("in the kitchen") is not a pose. It becomes the location if there is none.
  if (pose && PLACE_ONLY_START.test(pose) && !POSTURE_WORD.test(pose)) {
    if (!location) location = cleanLocation(pose);
    pose = null;
  }
  if (errors.length) return { ok: false, error: errors.join(' ') };
  // A model may copy the format example instead of describing itself. That is not a reading.
  if (looksCopiedFromExample(p.doc)) return { ok: false, error: 'The Kin copied the example from the question instead of describing itself.' };
  return { ok: true, outfit, location, pose, action, hair, makeup, warnings, notEnglish: notEnglishKeys(p.doc) };
}

/** The sentences shown on the card. A partial result (nothing read) gives the "nothing described" sentences. */
export function describeReading({ outfit = {}, location = null, pose = null, action = null, hair = null, makeup = null } = {}) {
  return { location: describeLocation(location), doing: describeDoing({ pose, action }), outfit: describeOutfit(outfit), hair: describeHair(hair), makeup: describeMakeup(makeup) };
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
