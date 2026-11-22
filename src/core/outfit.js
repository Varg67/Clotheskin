// The whole "tracker" logic: read the Kin's JSON, put its branches in order, add commas, show a sentence.
// Nothing here is saved: every reading stands on its own.
// Five sentences: location, pose and action, outfit, hair, makeup.
import { ACCESSORY_SLOTS, BAG_SLOT, WEAR_SLOTS, NOT_DESCRIBED } from './constants.js';
import { cleanString, capitalizeFirst } from './text.js';
import { parseJsonObject } from './json.js';
import { looksCopiedFromExample } from './prompt.js';

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

/** Accessories in reading order, then bags. (Clothing is ordered in describeOutfit, with underwear where it shows.) */
const ACCESSORY_ORDER = [...ACCESSORY_SLOTS, BAG_SLOT, 'accessories'];

const PLACEHOLDER = /^(unknown|unspecified|undefined|null|none|nothing|no\s.*|not (mentioned|specified|stated|known|visible|described)|n\/?a|-+|\?+)$/i;
// "unknown top", "none mentioned", "not specified in the chat": no piece.
const PLACEHOLDER_START = /^(unknown|unspecified|none (mentioned|specified|described|stated)|not (mentioned|specified|stated|known|visible|described|given))\b/i;
// Wearing nothing at all (a real roleplay answer): not "no outfit described", which would keep the last clothes.
const NAKED = /^(naked|nude|completely naked|stark naked|undressed|nothing( at all| on)|wearing nothing( at all)?|no clothes( at all)?|not wearing anything)$/i;
// Not a piece but how the Kin is: "Wearing a dress, barefoot."
const BARE_STATES = [
  ['barefoot', /^(barefoot(ed)?|bare ?feet|no (shoes|footwear))$/i],
  ['shirtless', /^(shirtless|bare[- ]chested|no shirt)$/i],
  ['topless', /^(topless|no top)$/i],
];
// A piece the Kin says it took off is not worn: "a jacket (taken off)".
const TAKEN_OFF = /\b(taken off|took (it|them) off|removed|discarded|no longer (worn|wearing|on)|not (worn|wearing)|was wearing|on the (floor|chair|bed)|in (her|his|my|their) (hand|hands|bag))\b/i;
const MAX_PER_SLOT = 8;
const MAX_LEN = 80;

/** A piece the Kin wrote as an object ({"item":"shirt","color":"white"}): its words, in a natural order. */
function pieceFromObject(o) {
  const order = ['color', 'colour', 'pattern', 'material', 'fabric', 'style', 'item', 'name', 'type', 'piece', 'garment'];
  const words = order.map((k) => o[k]).filter((v) => typeof v === 'string' && v.trim());
  return words.length ? words.join(' ') : null;
}

/**
 * One slot's pieces: { pieces, states, naked, nothing } or null (a value that is no text). `states` are "barefoot",
 * "shirtless" and the like; `naked` is an explicit "naked"; `nothing` is a bare "nothing" or "none".
 */
function cleanPieces(v) {
  const list = Array.isArray(v) ? v : [v];
  const out = { pieces: [], states: [], naked: false, nothing: false };
  const seen = new Set();
  for (let raw of list) {
    if (isPlainObject(raw)) raw = pieceFromObject(raw);
    if (typeof raw !== 'string') return null;
    let s = cleanString(raw, MAX_LEN).replace(/[.;,]+$/, '')
      .replace(/^(wearing|dressed in|has on|have on)\s+/i, '')       // "wearing a red dress"
      .replace(/^(A|An|The|My)\b/, (w) => w.toLowerCase());          // "A White Shirt" -> "a White Shirt"
    if (!s) continue;
    if (NAKED.test(s)) { out.naked = true; continue; }
    const state = BARE_STATES.find(([, re]) => re.test(s));
    if (state) { if (!out.states.includes(state[0])) out.states.push(state[0]); continue; }
    if (/^(nothing|none)$/i.test(s)) { out.nothing = true; continue; }
    if (PLACEHOLDER.test(s) || PLACEHOLDER_START.test(s) || TAKEN_OFF.test(s) || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.pieces.push(s);
  }
  out.pieces = out.pieces.slice(0, MAX_PER_SLOT);
  return out;
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
  const nothingIn = []; // clothing slots that said only "nothing" or "none"
  let clothingSlots = 0;
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
      for (const [sl, pieces] of Object.entries(inner.outfit)) outfit[sl] = sl === STATES ? [...new Set([...(outfit[sl] || []), ...pieces])] : [...(outfit[sl] || []), ...pieces];
      if (inner.outfit[NAKED_KEY]) outfit[NAKED_KEY] = true;
      warnings.push(...inner.warnings); errors.push(...inner.errors);
      continue;
    }
    const got = cleanPieces(value);
    if (got === null) { errors.push(`"${key}" must be a text or a list of texts.`); continue; }
    if (got.pieces.length) outfit[slot] = [...(outfit[slot] || []), ...got.pieces];
    if (got.states.length) outfit[STATES] = [...new Set([...(outfit[STATES] || []), ...got.states])];
    if (got.naked) outfit[NAKED_KEY] = true;
    if (CLOTHING_SLOT_SET.has(slot)) { clothingSlots += 1; if (got.nothing && !got.pieces.length) nothingIn.push(slot); }
  }
  // "nothing" in every clothing slot the Kin gave ({"topwear":["nothing"],"bottomwear":["nothing"]}) means naked; a
  // lone "nothing" next to real clothes is taken as "not mentioned".
  if (nothingIn.length && nothingIn.length === clothingSlots) outfit[NAKED_KEY] = true;
  return { outfit, warnings, errors };
}

function parseObject(text) {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return parsed;
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
const NO_PLACE = /^(unknown|unspecified|undefined|null|none|nothing|nowhere|somewhere( else)?|elsewhere|unclear|unsure|unchanged|(the )?same|no (specific |particular )?(place|location)|not (mentioned|specified|stated|known|visible|described|sure|clear)|n\/?a|-+|\?+)$/i;
// "Not specified in the chat", "unknown location", "the chat does not say", "same place as before": no new place.
// (With nothing new, the card keeps the last known place: such a sentence must never replace it.)
const NO_PLACE_START = /^(unknown|unspecified|unclear|not (mentioned|specified|stated|known|described|clear|given|said)|no (specific |particular |clear )?(place|location|info)|the (recent )?(chat|conversation) (does not|doesn['’]t|did not|didn['’]t)|(the )?same (place|location|room|spot)|still the same|as before)\b/i;
const MAX_LOCATION = 80;
const ING_PLACE = new Set(['building', 'wedding', 'meeting', 'landing', 'crossing', 'parking', 'clearing', 'gathering', 'evening', 'morning']);
const PLACE_COMPOUND = /^(room|rooms|area|hall|lot|garage|pool|mall|centre|center|alley|lane|rink|deck|booth|station)\b/i;
// A label the Kin wrote into the value: "Location: in the kitchen".
const LABEL = /^(current\s+)?(location|place|where)\s*[:\-–—]\s*/i;
// Who is there is not the place: "in the kitchen with Ari and Marina" -> "in the kitchen" ("a room with a view" stays).
const COMPANY = /\s+(together\s+)?with\s+(you|me|him|her|them|us|[A-Z][\w'’-]*|(my|his|her|their|our|your)\s+\w+|the person|friends|family)\b.*$/;

/**
 * Cleans the Kin's location. Returns a string, null (nothing stated) or undefined (wrong type).
 * The Kin is asked for the place only, so the usual slips are repaired: markdown and quotes around it, a posture or
 * activity in front of it ("sitting on the sofa in the living room"), a clause after it (", cooking dinner",
 * "while reading", "wearing a robe"), or a list instead of a text.
 */
export function cleanLocation(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  s = s.replace(LABEL, '');
  // "in the kitchen (cooking)": an activity in brackets goes; any other bracket becomes a comma clause.
  s = s.replace(/\s*\(([^()]*)\)?/g, (m, inner) => (/^\s*[a-z]+ing\b/.test(inner) || !inner.trim() ? '' : `, ${inner.trim()}`));
  // "Bia is in the kitchen": a roleplay answer in the third person, with the Kin's own name.
  s = s.replace(new RegExp(`^(?:[A-Z][\\w'’-]*\\s+){1,2}(?:is|was)\\s+(?=(${EN_PREP}|${MOTION}|on the way)\\b)`, 'i'), '');
  // "I'm in the kitchen right now", "She is at the hospital": the subject and the time words go.
  s = s.replace(/^((currently|right now|still|now)\s+)?((i|she|he|they|we)\s+(am|is|are|['’]?m)|i['’]m|she['’]s|he['’]s|they['’]re|we['’]re)\s+((currently|still|now|just)\s+)?/i, '')
    .replace(/^(currently|right now|still|now)\s+(?=(in|at|on|inside|outside|near)\b)/i, '')
    .replace(/[\s,]+(right now|at the moment|currently|now|still)$/i, '');
  s = s.replace(CLOTHES_CLAUSE, '')                                          // clothes do not belong here
    .replace(/\s*[,;]\s*[a-z]+ing\b.*$/, '')                               // ", cooking dinner" (not ", Spring Street")
    .replace(/\s+(while|as|and)\s+[a-z]+ing\b.*$/i, '')                    // "while reading"
    .replace(COMPANY, '')                                                     // "with Ari and Marina"
    .replace(/[.;,!?\s]+$/, '');
  // A lowercase posture or activity first ("sitting on the sofa", "cooking in the kitchen") is dropped when a place follows.
  const lead = s.match(/^([a-z]+ing|seated|perched|sat|stood|lay)(?:\s+(.*))?$/);
  // …but "living room", "waiting room", "parking lot" and "a building" are places, not a posture with a place after it.
  const placeNoun = lead && (ING_PLACE.has(lead[1]) || PLACE_COMPOUND.test(lead[2] || ''));
  if (lead && !placeNoun && !IS_MOTION.test(lead[1])) {
    const rest = (lead[2] || '').trim();
    if (STARTS_PLACE.test(rest) || STARTS_PORTUGUESE.test(rest)) s = rest;
    else return null; // a posture with no place in it
  }
  if (!s || NO_PLACE.test(s) || NO_PLACE_START.test(s)) return null;
  return clipWords(s, MAX_LOCATION);
}

// Common places written bare ("kitchen", "Living room"): they get "in the". A few get "at" ("at home", "at work").
const COMMON_PLACE = new Set(['kitchen', 'kitchenette', 'bedroom', 'bathroom', 'living', 'dining', 'lounge', 'hallway', 'hall', 'garden', 'backyard', 'yard', 'garage', 'office', 'study', 'library', 'classroom', 'car', 'bus', 'train', 'park', 'cafe', 'café', 'restaurant', 'bar', 'pub', 'shop', 'store', 'mall', 'gym', 'pool', 'beach', 'street', 'balcony', 'attic', 'basement', 'cellar', 'porch', 'room', 'shower', 'bath', 'bathtub', 'studio', 'apartment', 'flat', 'house', 'hotel', 'hospital', 'station', 'airport', 'supermarket', 'market', 'club', 'theater', 'theatre', 'cinema', 'laundry', 'closet', 'terrace', 'rooftop', 'patio', 'lobby', 'elevator', 'stairs', 'staircase', 'guest', 'master', 'spare', 'kids', 'nursery', 'dressing', 'waiting', 'break', 'meeting', 'locker', 'changing', 'tv', 'family', 'sitting', 'front', 'back', 'parking', 'swimming', 'shopping', 'bowling', 'building']);
const AT_PLACE = new Set(['home', 'work', 'school', 'college', 'university', 'uni', 'church', 'the office']);
// Portuguese place words, shown as written (the question asks for English; this only keeps "Cozinha" from "in Cozinha").
const PT_PLACE = new Set(['cozinha', 'sala', 'quarto', 'banheiro', 'varanda', 'jardim', 'escritório', 'carro', 'casa', 'garagem', 'quintal', 'corredor']);

/**
 * "in the kitchen" -> "In the kitchen." Only a bare noun phrase is adjusted: articles and proper names get "in",
 * "home" gets "at"; any other bare word, and anything Portuguese, is shown as written.
 */
export function describeLocation(value) {
  if (!value) return NOT_DESCRIBED.location;
  let v = value.trim();
  const first = v.split(/[\s,]+/)[0].toLowerCase();
  // "Kitchen" and "Living room" are common nouns written with a capital, not names: "in the kitchen", not "in Kitchen".
  if (COMMON_PLACE.has(first) || PT_PLACE.has(first)) v = v[0].toLowerCase() + v.slice(1);
  let phrase = v;
  if (STARTS_PLACE.test(v) || STARTS_PORTUGUESE.test(v) || PT_PLACE.has(first)) phrase = v;
  else if (AT_PLACE.has(v.toLowerCase())) phrase = `at ${v}`;
  else if (/^bed$/i.test(v)) phrase = 'in bed';
  else if (COMMON_PLACE.has(first)) phrase = `in the ${v}`;
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
// "not mentioned in the chat", "the chat does not say", "same as before": nothing new (the last known one stays).
const NO_VALUE_START = /^(unknown|unspecified|not (mentioned|specified|stated|known|described|clear|given|said)|the (recent )?(chat|conversation) (does not|doesn['’]t|did not|didn['’]t)|(the )?same( as (before|earlier))?$|unchanged|as before)\b/i;
const DOING_LABEL = /^(pose|posture|position|action|activity|doing)\s*[:\-–—]\s*/i;
// "Bia is sitting on the bed": a roleplay answer in the third person, with the Kin's own name.
const NAME_SUBJECT = /^(?:[A-Z][\w'’-]*\s+){1,2}(?:is|was)\s+(?=[a-z]+ing\b|(?:seated|perched|curled|stretched)\b)|^[A-Z][\w'’-]*['’]s\s+(?=[a-z]+ing\b)/;
// A feeling is not an action: "happy", "a bit tired".
const FEELING_WORD = /^((very|so|a (bit|little)|quite|really|kind of|slightly|still)\s+)?(happy|sad|tired|sleepy|exhausted|bored|angry|mad|nervous|excited|anxious|calm|relaxed|content|annoyed|upset|embarrassed|shy|flustered|curious|confused|worried|scared|afraid|hungry|thirsty|lonely|jealous|in love|sick|comfortable|cozy|cosy|cold|warm|hot)(\s+and\s+[a-z]+)?$/i;

// Common verbs a Kin writes in another form than "-ing": "sits on the sofa", "cook dinner", "drinks coffee".
const VERBS = new Set(['sit', 'stand', 'lie', 'lean', 'kneel', 'crouch', 'sleep', 'rest', 'nap', 'doze', 'lounge', 'curl', 'snuggle', 'cuddle', 'hug', 'kiss', 'hold', 'read', 'write', 'type', 'text', 'call', 'cook', 'bake', 'eat', 'drink', 'sip', 'stir', 'chop', 'pour', 'prepare', 'make', 'serve', 'set', 'wash', 'clean', 'tidy', 'fold', 'pack', 'brush', 'comb', 'dress', 'change', 'shower', 'bathe', 'watch', 'look', 'stare', 'gaze', 'glance', 'smile', 'grin', 'laugh', 'giggle', 'blush', 'talk', 'chat', 'listen', 'wait', 'walk', 'run', 'jog', 'drive', 'ride', 'play', 'work', 'study', 'draw', 'paint', 'knit', 'sew', 'sing', 'hum', 'dance', 'stretch', 'yawn', 'relax', 'scroll', 'browse', 'shop', 'pick', 'carry', 'fix', 'adjust', 'check', 'open', 'close', 'think', 'wave', 'nod', 'sigh', 'pace', 'tie', 'stroke', 'pet', 'feed']);
// Past forms only for postures ("sat on the sofa" is how many people say "sitting"); a past action may be over.
const PAST_POSTURE = { sat: 'sit', stood: 'stand', lay: 'lie', knelt: 'kneel', crouched: 'crouch', leaned: 'lean', leant: 'lean' };
function verbBase(w) {
  const x = w.toLowerCase();
  if (VERBS.has(x)) return x;
  if (/ies$/.test(x) && VERBS.has(`${x.slice(0, -3)}y`)) return `${x.slice(0, -3)}y`;
  if (/es$/.test(x) && VERBS.has(x.slice(0, -2))) return x.slice(0, -2);
  if (/s$/.test(x) && VERBS.has(x.slice(0, -1))) return x.slice(0, -1);
  return null;
}
function ingOf(base) {
  if (/ie$/.test(base)) return `${base.slice(0, -2)}ying`; // lie -> lying
  if (/[^e]e$/.test(base)) return `${base.slice(0, -1)}ing`; // write -> writing
  if (/^[^aeiou]*[aeiou][bdgmnprt]$/.test(base)) return `${base}${base.slice(-1)}ing`; // sit -> sitting
  return `${base}ing`;
}
/** "sits on the sofa" -> "sitting on the sofa", "cook dinner" -> "cooking dinner"; anything else as it is. */
function toIng(s, { posture = false } = {}) {
  const m = s.match(/^([A-Za-z]+)(.*)$/);
  if (!m) return s;
  const base = (posture && PAST_POSTURE[m[1].toLowerCase()]) || verbBase(m[1]);
  return base ? `${ingOf(base)}${m[2]}` : s;
}

/**
 * The shared repairs of a pose or an action: *roleplay* asides, a label, brackets, a subject ("I am", "Bia is"), a
 * clause about someone else ("who is watching TV"), the verb form, and "not mentioned" or "same as before".
 */
function cleanDoing(v, { posture }) {
  // "*smiles* cooking" -> "cooking": a *roleplay* aside goes, before anything trims the stars at the edges.
  if (typeof v === 'string') { const unstarred = v.replace(/\*[^*]+\*/g, ' ').trim(); if (unstarred) v = unstarred; }
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  s = s.replace(/\*/g, '');
  s = s.replace(DOING_LABEL, '')
    .replace(/\s*\(([^()]*)\)?/g, (m, inner) => (inner.trim() ? ` ${inner.trim()}` : ''));       // "reading (a novel)"
  let prev;
  do { prev = s; s = s.replace(/^((currently|right now|now|just|still|actually)\s+)+/i, '').replace(NAME_SUBJECT, '').replace(SUBJECT, ''); } while (s !== prev);
  s = s.replace(CLOTHES_CLAUSE, '')
    .replace(/,?\s+(who|whom|whose|which)\b.*$/i, '')                         // ", who is watching TV"
    .replace(/\s+that\s+(I|you|he|she|they|we|[A-Z][\w'’-]*)\s.*$/, '')     // "the glass that Ari dropped"
    .replace(/[.;,!?\s]+$/, '');
  if (!s || NO_VALUE.test(s) || NO_VALUE_START.test(s) || NO_ACTION.test(s)) return null;
  s = toIng(s, { posture });
  return /^[A-Z][a-z]*(ing|ed)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;  // "Reading a book" mid-sentence
}

/** The body position ("sitting on the sofa"). Returns string | null | undefined. */
export function cleanPose(v) {
  let s = cleanDoing(v, { posture: true });
  if (!s) return s;
  // An activity after the posture belongs to the action: "leaning on the wall, arms crossed, looking at Ari" -> "leaning on the wall, arms crossed".
  s = s.replace(/,\s*([a-z]+ing)\b.*$/, (m, w) => (POSTURE_WORD.test(w) ? m : ''));
  return clipWords(s, MAX_DOING);
}

/** What the Kin is doing now ("drinking coffee"). Plans and things already finished are not an action. */
// What the Kin says is not what it does (real test: "asking Ari to check whether Marina is in the kitchen").
// A speech clause after the action goes: "ordering pizza and asking Ariel to stop shouting" -> "ordering pizza".
const SPEECH_CLAUSE = /\s*(?:,|\band\b|\bwhile\b)\s+(?:asking|telling|saying|reminding|begging|urging|warning|assuring|promising|informing|instructing|explaining|answering|replying|complaining|shouting|yelling|calling|whispering|arguing|pleading|insisting)\b.*$/i;
// An action that is only speech to someone becomes talking with them: "asking Ari to check …" -> "talking with Ari".
const SPEECH_TO = /^(?:asking|telling|reminding|begging|urging|warning|assuring|promising|informing|instructing|ordering|convincing|persuading)\s+((?:\S+\s+){0,2}?\S+?)\s+(?:to|that|whether|if|about|why|how|what|where|when|not)\b/i;
const SPEECH_WORD = /^(to|that|whether|if|about|why|how|what|where|when|not|for|me|it|this)$/i;

function withoutSpeech(s) {
  const t = s.replace(SPEECH_CLAUSE, '');
  if (t !== s && t.trim()) return t.trim();
  const m = s.match(SPEECH_TO);
  if (m && !SPEECH_WORD.test(m[1].split(/\s+/)[0])) return `talking with ${m[1]}`;
  return s;
}

export function cleanAction(v) {
  let s = cleanDoing(v, { posture: false });
  if (s === null || s === undefined) return s;
  s = withoutSpeech(s)
    .replace(/\s+(while|as)\s+[a-z]+ing\b.*$/i, '')   // "cooking dinner while humming a song" -> "cooking dinner"
    .replace(/[.;,!?\s]+$/, '');
  if (!s || NO_VALUE.test(s) || NO_ACTION.test(s) || PLAN_OR_PAST.test(s) || GOING_TO_VERB.test(s) || FUTURE_WORD.test(s) || FEELING.test(s) || FEELING_WORD.test(s)) return null;
  return clipWords(s, MAX_DOING);
}

/** "Sitting on the sofa, drinking coffee." Pose first, then the action; an action already inside the pose is not repeated. */
export function describeDoing({ pose, action } = {}) {
  const parts = [];
  // One inside the other ("sitting" and "sitting on the sofa"): the longer one alone.
  const p = pose && pose.toLowerCase(); const a = action && action.toLowerCase();
  if (pose && !(a && a !== p && a.includes(p))) parts.push(pose);
  if (action && !(p && p.includes(a))) parts.push(action);
  if (!parts.length) return NOT_DESCRIBED.doing;
  const text = parts.join(', ');
  return capitalizeFirst(text.endsWith('…') ? text : `${text}.`);
}

// ---- hair and makeup: one short phrase each ("long black hair in a ponytail", "red lipstick and eyeliner")
const NO_HAIR = 'No hair described in the recent chat.';
const NO_MAKEUP = 'No makeup described in the recent chat.';
const MAX_LOOK = 100;
// Saying "none" may mean "not mentioned"; only an explicit "no makeup" means a bare face.
const BARE_FACE = /^(no make-?up( at all)?|without (any )?make-?up|make-?up[- ]free|bare[- ]?faced?|a bare face|natural,? no make-?up|((i|she|he)\s*(['’]m|am|is|['’]s)\s+)?not wearing (any )?make-?up( at all| today)?)$/i;

// Hair written as an object ({"length":"long","color":"black","style":"ponytail"}): its words, in a natural order.
const HAIR_ORDER = ['length', 'color', 'colour', 'texture', 'type', 'style', 'state'];
// A list item that goes on the phrase before it: ["long black hair", "in a ponytail"] -> "long black hair in a ponytail".
const GOES_ON = /^(in|on|up|down|with|tied|pulled|swept|tucked|held|braided|loose|wet|messy|half)\b/i;
const LOOK_LABEL = /^(hair|hairstyle|make-?up)\s*[:\-–—]\s*/i;
// "Bia has long dark hair", "Bia is wearing red lipstick", "Bia's hair is up": the Kin's own name in front.
const NAME_HAS = /^(?:[A-Z][\w'’-]*\s+){1,2}(?:has|has got|is wearing|wears|is in)\s+|^[A-Z][\w'’-]*['’]s\s+(?:hair|make-?up)\s+(?:is|are)\s+/;

/**
 * Text, a list of texts, or an object, as one short phrase. Returns string | null | undefined (wrong type).
 * The same repairs as a pose: a *roleplay* aside, a label, brackets, a subject ("I have", "Bia has"), a clause about
 * someone else, and "not mentioned" or "same as before" (nothing new: the last known one stays).
 */
function lookPhrase(v, kind) {
  if (v === null || v === undefined) return null;
  let s;
  if (isPlainObject(v)) {
    const words = (kind === 'hair' ? HAIR_ORDER.map((k) => v[k]) : Object.values(v)).filter((x) => typeof x === 'string' && x.trim());
    if (!words.length) return undefined;
    s = kind === 'hair' ? words.join(' ') : joinNatural(words);
  } else if (Array.isArray(v)) {
    if (v.some((x) => typeof x !== 'string')) return undefined;
    const items = v.map((x) => cleanString(x, MAX_LOOK).replace(/[.;,!?\s]+$/, '')).filter(Boolean).slice(0, 4);
    if (kind === 'hair' && items.every((x) => !/\s/.test(x))) s = items.join(' ');           // ["long","black","ponytail"]
    else if (kind === 'hair') s = items.reduce((a, x) => (!a ? x : `${a}${GOES_ON.test(x) ? ' ' : ', '}${x}`), '');
    else s = joinNatural(items);
  } else if (typeof v === 'string') {
    s = v.replace(/\*[^*]+\*/g, ' ').trim() || v;                                          // "*runs fingers through her hair* long"
  } else return undefined;
  s = cleanString(s, 400).replace(/^[\s*_"'“”‘’()[\]]+/, '').replace(/[\s*_"'“”‘’()[\]]+$/, '').replace(/\*/g, '').replace(/[.;,!?\s]+$/, '')
    .replace(LOOK_LABEL, '')
    .replace(/\s*\(([^()]*)\)?/g, (m, inner) => (inner.trim() ? ` ${inner.trim()}` : ''))   // "(tied back)"
    .replace(NAME_HAS, '')
    .replace(/^(my|her|his|their) (hair|make-?up) (is|are)\s+/i, '')
    .replace(/^((i|she|he)\s+(have|has|['’]ve got|has got|am wearing|is wearing)|i['’]ve got|(she|he)['’]s got|i['’]m wearing|she['’]s wearing|he['’]s wearing|wearing)\s+/i, '')
    .replace(/,?\s+(who|whom|whose|which)\b.*$/i, '')                         // ", which she keeps adjusting"
    .replace(/\s+that\s+(I|you|he|she|they|we|[A-Z][\w'’-]*)\s.*$/, '')     // "that Ari loves"
    .replace(/[.;,!?\s]+$/, '');
  if (!s || NO_VALUE.test(s) || NO_VALUE_START.test(s) || /^none (mentioned|specified|described|stated)$/i.test(s)) return null;
  if (/^([A-Z][a-z]*[\s,]*)+$/.test(s) && /\s/.test(s)) s = s.toLowerCase();         // "Long Dark Hair, Loose"
  return s.length > MAX_LOOK ? `${s.slice(0, MAX_LOOK).replace(/\s+\S*$/, '')}…` : s;
}

const cleanHair = (v) => lookPhrase(v, 'hair');
function cleanMakeup(v) {
  if (typeof v === 'string' && BARE_FACE.test(cleanString(v, 200).replace(/[.!\s]+$/, ''))) return 'no makeup';
  const s = lookPhrase(v, 'makeup');
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

/** One parse for the whole answer: where the Kin is, how it is positioned, what it is doing and what it wears. */
export function parseReading(text) {
  const p = parseObject(text);
  if (!p.ok) return p;
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
  const hair = read(isHairKey, cleanHair, 'hair');
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

/** The sentences shown on the card. */
export function describeReading({ outfit, location, pose, action, hair = null, makeup = null }) {
  return { location: describeLocation(location), doing: describeDoing({ pose, action }), outfit: describeOutfit(outfit), hair: describeHair(hair), makeup: describeMakeup(makeup) };
}

/** "a" / "a and b" / "a, b and c". */
export function joinNatural(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const STATES = '_states'; // "barefoot", "shirtless": how the Kin is, not a piece
const NAKED_KEY = '_naked';
const CLOTHING_SLOT_SET = new Set(['headwear', 'topwear', 'bottomwear', 'footwear', 'topunderwear', 'bottomunderwear', 'clothing']);
// A top that also covers the legs: underpants under it are not mentioned.
const ONE_PIECE = /\b(dress|gown|jumpsuit|romper|playsuit|overalls|robe|bathrobe|kimono|onesie|nightgown|nightie|nightdress|sundress|towel|pyjamas|pajamas|pjs)\b/i;

const LOOSE_SLOTS = new Set(['clothing', 'accessories']); // no layers: keep the order the Kin gave
const inOrder = (outfit, order) => order.flatMap((slot) =>
  // inside a real slot the Kin lists innermost first; the sentence names the outermost piece first
  (LOOSE_SLOTS.has(slot) ? [...(outfit[slot] || [])] : [...(outfit[slot] || [])].reverse()));

/**
 * The sentence: "Wearing a leather jacket, a perfumed white shirt and blue jeans, with glasses."
 * Underwear is mentioned where nothing covers it: a bra with no top, underpants with no trousers, skirt or dress
 * (real test: "a purple shirt" alone hid that the Kin wore no trousers). A piece in two slots is said once.
 * "Not wearing anything" for a Kin that says it is naked; "barefoot" or "shirtless" after the pieces.
 */
export function describeOutfit(outfit) {
  const tops = [...(outfit.topwear || []), ...(outfit.clothing || [])];
  const coversTop = tops.length > 0;
  const coversBottom = (outfit.bottomwear || []).length > 0 || (outfit.clothing || []).length > 0 || tops.some((p) => ONE_PIECE.test(p));
  const order = ['headwear', 'topwear', ...(coversTop ? [] : ['topunderwear']), 'bottomwear', ...(coversBottom ? [] : ['bottomunderwear']), 'footwear', 'footunderwear', 'clothing'];
  const once = (list) => list.filter((p, i) => list.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  const clothing = once(inOrder(outfit, order));
  const accessories = once(inOrder(outfit, ACCESSORY_ORDER));
  // "barefoot" with shoes or socks is a contradiction: the pieces win.
  const footed = (outfit.footwear || []).length > 0 || (outfit.footunderwear || []).length > 0;
  const states = (outfit[STATES] || []).filter((s) => !(s === 'barefoot' && footed));
  const extra = (s) => `${s}${states.length ? `, ${joinNatural(states)}` : ''}.`;
  const withAcc = accessories.length ? `, with ${joinNatural(accessories)}` : '';
  if (!clothing.length && outfit[NAKED_KEY]) return extra(`Not wearing anything${withAcc}`);
  if (!clothing.length && !accessories.length && !states.length) return NOT_DESCRIBED.outfit;
  if (!clothing.length && !accessories.length) return capitalizeFirst(`${joinNatural(states)}.`);
  if (!clothing.length) return extra(`Accessories: ${joinNatural(accessories)}`);
  return capitalizeFirst(extra(`Wearing ${joinNatural(clothing)}${withAcc}`));
}
