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

// The Kin may name the key differently; all of these mean "where you are".
const isLocationKey = (k) => ['location', 'place', 'where', 'currentlocation', 'currentplace'].includes(String(k).toLowerCase().replace(/[\s_-]+/g, ''));

const keyName = (k) => String(k).toLowerCase().replace(/[\s_-]+/g, '');
// "position" counts as pose: it was the original name of that field.
const isPoseKey = (k) => ['pose', 'posture', 'position', 'stance', 'bodyposition'].includes(keyName(k));
const isActionKey = (k) => ['action', 'activity', 'doing', 'doingnow', 'currentaction', 'currentactivity', 'currentlydoing'].includes(keyName(k));
const isReadingKey = (k) => isLocationKey(k) || isPoseKey(k) || isActionKey(k);

/** Slots from a parsed JSON object. Location, pose and action belong to the reading, so they are skipped here without a warning. */
function outfitFromObject(doc) {
  const outfit = {};
  const warnings = [];
  const errors = [];
  for (const [key, value] of Object.entries(doc)) {
    if (isReadingKey(key)) continue;
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
  if (v === null || v === undefined) return null;
  let s;
  if (Array.isArray(v)) {
    if (v.some((x) => typeof x !== 'string')) return undefined;
    s = v.map((x) => x.trim()).filter(Boolean).slice(0, 3).join(', ');
  } else if (typeof v === 'string') s = v;
  else return undefined;

  s = cleanString(s, 400)
    .replace(/^[\s*_"'“”‘’()[\]]+/, '').replace(/[\s*_"'“”‘’()[\]]+$/, '')
    .replace(/[.;,!?\s]+$/, '');
  s = s.replace(/\s*[,;–—-]?\s*\b(wearing|dressed)\b.*$/i, '')            // clothes do not belong here
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
  if (s.length > MAX_LOCATION) s = `${s.slice(0, MAX_LOCATION).replace(/\s+\S*$/, '')}…`;
  return s;
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

const capWords = (s) => (s.length > MAX_DOING ? `${s.slice(0, MAX_DOING).replace(/\s+\S*$/, '')}…` : s);

/** The body position ("sitting on the sofa"). Returns string | null | undefined. */
export function cleanPose(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  s = s.replace(/\s*[,;–—-]?\s*\b(wearing|dressed)\b.*$/i, '').replace(/[.;,!?\s]+$/, '');
  if (!s || NO_VALUE.test(s) || NO_ACTION.test(s)) return null;
  return capWords(s);
}

/** What the Kin is doing now ("drinking coffee"). Plans and things already finished are not an action. */
export function cleanAction(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  let prev;
  do { prev = s; s = s.replace(/^((currently|right now|now|just|still|actually)\s+)+/i, '').replace(SUBJECT, ''); } while (s !== prev);
  s = s.replace(/[.;,!?\s]+$/, '');
  if (!s || NO_VALUE.test(s) || NO_ACTION.test(s) || PLAN_OR_PAST.test(s) || GOING_TO_VERB.test(s) || FUTURE_WORD.test(s) || FEELING.test(s)) return null;
  return capWords(s);
}

/** "Sitting on the sofa, drinking coffee." Pose first, then the action; an action already inside the pose is not repeated. */
export function describeDoing({ pose, action } = {}) {
  const parts = [];
  if (pose) parts.push(pose);
  if (action && !(pose && pose.toLowerCase().includes(action.toLowerCase()))) parts.push(action);
  if (!parts.length) return 'No pose or action described in the recent chat.';
  const text = parts.join(', ');
  return capitalizeFirst(text.endsWith('…') ? text : `${text}.`);
}

/** Icon name for the pose row. */
export function poseIcon(pose) {
  const v = pose || '';
  if (/\b(sitting|seated|lying|laying|kneeling|crouching|squatting|reclining|resting|lounging|sleeping|curled)\b/i.test(v)) return 'sitting';
  if (/\b(standing|walking|leaning|stretched)\b/i.test(v)) return 'standing';
  return 'person';
}

/** One parse for the whole answer: where the Kin is, how it is positioned, what it is doing and what it wears. */
export function parseReading(text) {
  const p = parseObject(text);
  if (!p.ok) return p;
  const { outfit, warnings, errors } = outfitFromObject(p.doc);
  const keyOf = (test) => Object.keys(p.doc).find(test);
  const read = (test, clean, label) => {
    const key = keyOf(test);
    if (!key) return null;
    const v = clean(p.doc[key]);
    if (v === undefined) errors.push(`"${label}" must be a text.`);
    return v ?? null;
  };
  let location = read(isLocationKey, cleanLocation, 'location');
  let pose = read(isPoseKey, cleanPose, 'pose');
  const action = read(isActionKey, cleanAction, 'action');
  // A pose that is really a place ("in the kitchen") is not a pose. It becomes the location if there is none.
  if (pose && PLACE_ONLY_START.test(pose) && !POSTURE_WORD.test(pose)) {
    if (!location) location = cleanLocation(pose);
    pose = null;
  }
  if (errors.length) return { ok: false, error: errors.join(' ') };
  return { ok: true, outfit, location, pose, action, warnings };
}

/** The sentences shown on the card. */
export function describeReading({ outfit, location, pose, action }) {
  return { location: describeLocation(location), doing: describeDoing({ pose, action }), outfit: describeOutfit(outfit) };
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
