// The short phrases of a reading, cleaned and turned into the card's sentences: where the Kin is, its pose and
// action, its hair and makeup. A roleplay model writes them loosely ("I'm in the kitchen right now", "**sitting**",
// "going to read later"), so the usual slips are repaired here, and plans, feelings and placeholders are not kept.
import { cleanString, toSentence, clipWords, trimEndPunctuation, stripWrapping, joinNatural } from './text.js';

// ---- shared first step
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
  return trimEndPunctuation(stripWrapping(cleanString(s, max)));
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
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  // "I'm in the kitchen right now", "She is at the hospital": the subject and the time words go.
  s = s.replace(/^((currently|right now|still|now)\s+)?((i|she|he|they|we)\s+(am|is|are|['’]?m)|i['’]m|she['’]s|he['’]s|they['’]re|we['’]re)\s+((currently|still|now|just)\s+)?/i, '')
    .replace(/^(currently|right now|still|now)\s+(?=(in|at|on|inside|outside|near)\b)/i, '')
    .replace(/[\s,]+(right now|at the moment|currently|now|still)$/i, '');
  s = s.replace(CLOTHES_CLAUSE, '')                                          // clothes do not belong here
    .replace(/\s*[,;]\s*[A-Za-z]+ing\b.*$/i, '')                           // ", cooking dinner"
    .replace(/\s+(while|as|and)\s+[A-Za-z]+ing\b.*$/i, '')                 // "while reading"
    .replace(/[.;,!?\s]+$/, ''); // the clauses above may leave a comma behind
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
  return toSentence(phrase);
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

/** A "pose" that is really a place ("in the kitchen") and names no posture. */
export const isPlaceNotPose = (pose) => PLACE_ONLY_START.test(pose) && !POSTURE_WORD.test(pose);

/** The body position ("sitting on the sofa"). Returns string | null | undefined. */
export function cleanPose(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  s = trimEndPunctuation(s.replace(CLOTHES_CLAUSE, ''));
  if (!s || NO_VALUE.test(s) || NO_ACTION.test(s)) return null;
  return clipWords(s, MAX_DOING);
}

// Placeholders, idleness, plans, things already done and feelings: none of these is what the Kin is doing now.
const NOT_AN_ACTION = [NO_VALUE, NO_ACTION, PLAN_OR_PAST, GOING_TO_VERB, FUTURE_WORD, FEELING];

/** What the Kin is doing now ("drinking coffee"). Plans and things already finished are not an action. */
export function cleanAction(v) {
  let s = rawText(v, 400);
  if (s === null || s === undefined) return s;
  let prev;
  do { prev = s; s = s.replace(/^((currently|right now|now|just|still|actually)\s+)+/i, '').replace(SUBJECT, ''); } while (s !== prev);
  s = trimEndPunctuation(s);
  if (!s || NOT_AN_ACTION.some((re) => re.test(s))) return null;
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
  return toSentence(parts.join(', '));
}

// ---- hair and makeup: one short phrase each ("long black hair in a ponytail", "red lipstick and eyeliner")
const NO_HAIR = 'No hair described in the recent chat.';
const NO_MAKEUP = 'No makeup described in the recent chat.';
const MAX_LOOK = 100;
// Saying "none" may mean "not mentioned"; only an explicit "no makeup" means a bare face.
const BARE_FACE = /^(no make-?up( at all)?|without (any )?make-?up|make-?up[- ]free|bare[- ]?faced?|a bare face|natural,? no make-?up|((i|she|he)\s*(['’]m|am|is|['’]s)\s+)?not wearing (any )?make-?up( at all| today)?)$/i;

/** Hair or makeup: text or a list of texts as one phrase. Returns string | null | undefined (wrong type). */
export function cleanHair(v) {
  if (v === null || v === undefined) return null;
  let s;
  if (Array.isArray(v)) {
    if (v.some((x) => typeof x !== 'string')) return undefined;
    s = joinNatural(v.map((x) => trimEndPunctuation(cleanString(x, MAX_LOOK))).filter(Boolean).slice(0, 4));
  } else if (typeof v === 'string') s = v;
  else return undefined;
  s = trimEndPunctuation(stripWrapping(cleanString(s, 400)))
    .replace(/^(my|her|his|their) (hair|make-?up) (is|are)\s+/i, '')
    .replace(/^((i|she|he)\s+(have|has|['’]ve got|has got|am wearing|is wearing)|i['’]ve got|(she|he)['’]s got|i['’]m wearing|she['’]s wearing|he['’]s wearing|wearing)\s+/i, '');
  if (!s || NO_VALUE.test(s)) return null;
  return clipWords(s, MAX_LOOK);
}

/** Like cleanHair; an explicit bare face ("no makeup", "bare-faced") is 'no makeup'. */
export function cleanMakeup(v) {
  if (typeof v === 'string' && BARE_FACE.test(cleanString(v, 200).replace(/[.!\s]+$/, ''))) return 'no makeup';
  const s = cleanHair(v);
  return typeof s === 'string' && BARE_FACE.test(s) ? 'no makeup' : s;
}

/** "Long black hair in a ponytail." */
export const describeHair = (value) => (value ? toSentence(value) : NO_HAIR);
/** "Red lipstick and eyeliner." / "No makeup." */
export const describeMakeup = (value) => (value ? toSentence(value) : NO_MAKEUP);
