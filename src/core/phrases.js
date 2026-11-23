// The short phrases of a reading, cleaned and turned into the card's sentences: where the Kin is, its pose and
// action, its hair and makeup. A roleplay model writes them loosely ("I'm in the kitchen right now", "*smiles*
// sitting", "Bia is cooking", "going to read later"), so the usual slips are repaired here, and plans, speech,
// feelings and placeholders are not kept. Returns null for "nothing new" (the card then keeps the last known one).
import { cleanString, toSentence, clipWords, trimEndPunctuation, stripWrapping, joinNatural, nothingSaid, NOT_STATED_OR_UNSURE } from './text.js';
import { NOT_DESCRIBED } from './constants.js';

// ---- shared first steps
const CLOTHES_CLAUSE = /\s*[,;–—-]?\s*\b(wearing|dressed)\b.*$/i; // "…, wearing a robe"
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Text, a list of texts (joined) or nothing. Returns string | null | undefined (wrong type). */
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

// "the chat does not say", "same as before": nothing new (the last known sentence stays).
const CHAT_SAYS_NOTHING = 'the (recent )?(chat|conversation) (does not|doesn[\'’]t|did not|didn[\'’]t)';

// ---- location: a short phrase that already starts with in / at / on ("in the kitchen", "at the hospital")
const EN_PREP = 'in|inside|at|on|outside|near|nearby|by|under|over|above|below|around|across|along|between|beside|behind|next|close|through|from|to|towards?|back|upstairs|downstairs';
const MOTION = 'heading|going|walking|driving|travell?ing|commuting|returning|coming|leaving|riding|flying|running|jogging|cycling|biking|sailing';
const PT_PREP = 'em|na|no|nas|nos|numa|num|ao|à|aos|às|pra|para|de|da|do|das|dos|perto|dentro|fora|sobre|sob|entre|até';
const STARTS_PLACE = new RegExp(`^(${EN_PREP}|${MOTION}|on the way)\\b`, 'i');
const STARTS_PORTUGUESE = new RegExp(`^(${PT_PREP})(?=\\s|$)`, 'i'); // \b is unreliable with accents
const IS_MOTION = new RegExp(`^(${MOTION})$`, 'i');
const NO_PLACE = nothingSaid({
  extra: ['nowhere', 'somewhere( else)?', 'elsewhere', 'unclear', 'unsure', 'unchanged', '(the )?same', 'no (specific |particular )?(place|location)'],
  notWords: NOT_STATED_OR_UNSURE,
});
// "Not specified in the chat", "unknown location", "same place as before": no new place. (With nothing new, the card
// keeps the last known place: such a sentence must never replace it.)
const NO_PLACE_START = new RegExp(`^(unknown|unspecified|unclear|not (mentioned|specified|stated|known|described|clear|given|said)|no (specific |particular |clear )?(place|location|info)|${CHAT_SAYS_NOTHING}|(the )?same (place|location|room|spot)|still the same|as before)\\b`, 'i');
const MAX_LOCATION = 80;
const ING_PLACE = new Set(['building', 'wedding', 'meeting', 'landing', 'crossing', 'parking', 'clearing', 'gathering', 'evening', 'morning']);
const PLACE_COMPOUND = /^(room|rooms|area|hall|lot|garage|pool|mall|centre|center|alley|lane|rink|deck|booth|station)\b/i;
// A label the Kin wrote into the value: "Location: in the kitchen".
const LABEL = /^(current\s+)?(location|place|where)\s*[:\-–—]\s*/i;
// "Bia is in the kitchen": a roleplay answer in the third person, with the Kin's own name.
const NAMED_PLACE_SUBJECT = new RegExp(`^(?:[A-Z][\\w'’-]*\\s+){1,2}(?:is|was)\\s+(?=(${EN_PREP}|${MOTION}|on the way)\\b)`, 'i');
// In a travel phrase, company may appear before the route ("walking with Isa to work").
const COMPANY_PERSON = "(?:you|me|him|her|them|us|\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*)*|(?:my|his|her|their|our|your)\\s+\\w+|the person|friends|family)";
const COMPANY = new RegExp(`\\s+(?:together\\s+)?with\\s+${COMPANY_PERSON}(?:(?:,\\s*|\\s+and\\s+)${COMPANY_PERSON})*(?=\\s|[,.;!?]|$)`, 'u');
const TRAVEL_ROUTE = /^\s+(?:to|towards?|from|via|through|along|into|onto)\s+/i;
const STARTS_TRAVEL = new RegExp(`^(?:${MOTION}|on the way)\\b`, 'i');
// A caller's location can follow a phone conversation without identifying the Kin's location.
const PHONE_CALL = /(?:^|\s+)(?:on the phone|on a (?:video |voice )?call)\s+with\b.*$/i;
const DEPARTED = /^(?:I\s+)?(?:have\s+)?(?:just\s+)?left\s+(?!(?:wing|bank|field|side)\b)/i;
const ARRIVAL_AFTER_DEPARTURE = /\band\s+(?:now\s+)?(?:I(?:['’]m| am)|am)\s+(?:now\s+)?(.+)$/i;
const NONCURRENT_PLACE = /^(?:maybe|perhaps|possibly|not|no longer|if|I\s+(?:will|would|might|may|was|were)|(?:will|would|might|may)\s+(?:be|go|head)|was|were|(?:I['’]m\s+)?(?:planning|hoping) to)\b/i;

function withoutCompany(s) {
  const company = COMPANY.exec(s);
  if (!company) return s;
  const before = s.slice(0, company.index);
  if (!STARTS_TRAVEL.test(before)) return before;
  const after = s.slice(company.index + company[0].length);
  return TRAVEL_ROUTE.test(after) ? before + after : before;
}

/** The place alone: no label, brackets, subject, time words, clothes, activity or company around it. */
function placeOnly(text) {
  // "in the kitchen (cooking)": an activity in brackets goes; any other bracket becomes a comma clause.
  let s = text.replace(LABEL, '').replace(/\s*\(([^()]*)\)?/g, (m, inner) => (/^\s*[a-z]+ing\b/.test(inner) || !inner.trim() ? '' : `, ${inner.trim()}`));
  s = s.replace(NAMED_PLACE_SUBJECT, '');
  // "I'm in the kitchen right now", "She is at the hospital": the subject and the time words go.
  s = s.replace(/^((currently|right now|still|now)\s+)?((i|she|he|they|we)\s+(am|is|are|['’]?m)|i['’]m|she['’]s|he['’]s|they['’]re|we['’]re)\s+((currently|still|now|just)\s+)?/i, '')
    .replace(/^(currently|right now|still|now)\s+(?=(in|at|on|inside|outside|near)\b)/i, '')
    .replace(/[\s,]+(right now|at the moment|currently|now|still)$/i, '');
  return withoutCompany(s.replace(PHONE_CALL, '')).replace(CLOTHES_CLAUSE, '') // clothes do not belong here
    .replace(/\s*[,;]\s*[a-z]+ing\b.*$/, '')                               // ", cooking dinner" (not ", Spring Street")
    .replace(/\s+(while|as|and)\s+[a-z]+ing\b.*$/i, '')                    // "while reading"
    .replace(/[.;,!?\s]+$/, '');                                             // the clauses above may leave a comma behind
}

/**
 * A posture or activity first ("sitting on the sofa", "cooking in the kitchen") is dropped when a place
 * follows; with no place after it, there is no place (null). "living room", "waiting room", "parking lot" and "a
 * building" are places, not a posture with a place after it.
 */
function withoutLeadingPosture(s) {
  const lead = s.match(/^([a-z]+ing|seated|perched|sat|stood|lay)(?:\s+(.*))?$/i);
  if (!lead || ING_PLACE.has(lead[1].toLowerCase()) || PLACE_COMPOUND.test(lead[2] || '') || IS_MOTION.test(lead[1])) return s;
  const rest = (lead[2] || '').trim();
  if (STARTS_PLACE.test(rest) || STARTS_PORTUGUESE.test(rest)) return rest;
  // A capitalized proper name such as "Reading" or "Spring Hill" can also end in -ing.
  if (/^[A-Z]/.test(s) && !POSTURE_WORD.test(lead[1])) return s;
  return null;
}

/**
 * Cleans the Kin's location. Returns a string, null (nothing stated) or undefined (wrong type).
 * The Kin is asked for the place only, so the usual slips are repaired: markdown and quotes around it, a label, a
 * posture or activity in front of it ("sitting on the sofa in the living room"), a clause after it (", cooking dinner",
 * "while reading", "wearing a robe", "with Ari"), or a list instead of a text.
 */
export function cleanLocation(v) {
  const raw = rawText(v, 400);
  if (raw === null || raw === undefined) return raw;
  let place = placeOnly(raw);
  if (DEPARTED.test(place)) {
    const arrival = ARRIVAL_AFTER_DEPARTURE.exec(place);
    if (!arrival) {
      const from = place.replace(DEPARTED, '').trim();
      return clipWords('left ' + from, MAX_LOCATION);
    }
    if (!STARTS_PLACE.test(arrival[1])) return null;
    place = arrival[1];
  }
  if (NONCURRENT_PLACE.test(place) || (STARTS_TRAVEL.test(place) && scheduledAction(place))) return null;
  const s = withoutLeadingPosture(place);
  if (!s || NO_PLACE.test(s) || NO_PLACE_START.test(s)) return null;
  return clipWords(s, MAX_LOCATION);
}

// Common places written bare ("kitchen", "Living room"): they get "in the". A few get "at" ("at home", "at work").
const COMMON_PLACE = new Set([
  'kitchen', 'kitchenette', 'bedroom', 'bathroom', 'living', 'dining', 'lounge', 'hallway', 'hall', 'garden', 'backyard', 'yard',
  'garage', 'office', 'study', 'library', 'classroom', 'car', 'bus', 'train', 'park', 'cafe', 'café', 'restaurant', 'bar', 'pub',
  'shop', 'store', 'mall', 'gym', 'pool', 'beach', 'street', 'balcony', 'attic', 'basement', 'cellar', 'porch', 'room', 'shower',
  'bath', 'bathtub', 'studio', 'apartment', 'flat', 'house', 'hotel', 'hospital', 'station', 'airport', 'supermarket', 'market',
  'club', 'theater', 'theatre', 'cinema', 'laundry', 'closet', 'terrace', 'rooftop', 'patio', 'lobby', 'elevator', 'stairs',
  'staircase', 'guest', 'master', 'spare', 'kids', 'nursery', 'dressing', 'waiting', 'break', 'meeting', 'locker', 'changing', 'tv',
  'family', 'sitting', 'front', 'back', 'parking', 'swimming', 'shopping', 'bowling', 'building',
]);
const AT_PLACE = new Set(['home', 'work', 'school', 'college', 'university', 'uni', 'church', 'the office']);
// Portuguese place words, shown as written (the question asks for English; this only keeps "Cozinha" from "in Cozinha").
const PT_PLACE = new Set(['cozinha', 'sala', 'quarto', 'banheiro', 'varanda', 'jardim', 'escritório', 'carro', 'casa', 'garagem', 'quintal', 'corredor']);

/** A place written bare gets its preposition: "kitchen" -> "in the kitchen", "home" -> "at home". */
function withPreposition(v, first) {
  if (STARTS_PLACE.test(v) || STARTS_PORTUGUESE.test(v) || PT_PLACE.has(first)) return v;
  if (AT_PLACE.has(v.toLowerCase())) return `at ${v}`;
  if (/^bed$/i.test(v)) return 'in bed';
  if (COMMON_PLACE.has(first)) return `in the ${v}`;
  if (/^(the|a|an|my|our|his|her|their|your)\b/i.test(v) || /^[A-Z]/.test(v)) return `in ${v}`;
  return v;
}

/**
 * "in the kitchen" -> "In the kitchen." A bare noun phrase gets its preposition (articles and proper names "in", common
 * places "in the", "home" and "work" "at"); any other bare word, and anything Portuguese, is shown as written.
 */
export function describeLocation(value) {
  if (!value) return NOT_DESCRIBED.location;
  let v = value.trim();
  const first = v.split(/[\s,]+/)[0].toLowerCase();
  // "Kitchen" and "Living room" are common nouns written with a capital, not names: "in the kitchen", not "in Kitchen".
  if (COMMON_PLACE.has(first) || PT_PLACE.has(first)) v = v[0].toLowerCase() + v.slice(1);
  return toSentence(withPreposition(v, first));
}

// ---- pose and action
const NO_VALUE = nothingSaid({ notWords: NOT_STATED_OR_UNSURE });
const NO_ACTION = /^(nothing( in particular| special)?|doing nothing|idle|no (specific |particular )?(action|activity))$/i;
const PLAN_OR_PAST = /^(will|would|about to|planning to|plans? to|wants? to|wanted to|hoping to|used to|finished|stopped|was|were|had|just (finished|stopped))\b/i;
// "going to the store" is movement in progress; "going to read" is a plan. Future time words are plans too.
const PLANNED_VERBS = [
  'read', 'eat', 'drink', 'sleep', 'take', 'make', 'cook', 'watch', 'play', 'call', 'write', 'study', 'have', 'get', 'buy', 'try',
  'go', 'do', 'see', 'meet', 'visit', 'clean', 'wash', 'work', 'start', 'check', 'lie', 'sit', 'relax', 'rest', 'shower', 'bathe',
  'leave', 'head', 'text', 'ask', 'tell', 'order',
];
const FUTURE_WORD = /\b(later|tomorrow|soon|tonight|afterwards|next (week|time)|in a (bit|moment|while)|in \d+ (minutes?|hours?))\b/i;
const FEELING = /^(feeling|being|seeming)\b/i; // a state of mind is not an action
// A feeling is not an action: "happy", "a bit tired".
const FEELINGS = [
  'happy', 'sad', 'tired', 'sleepy', 'exhausted', 'bored', 'angry', 'mad', 'nervous', 'excited', 'anxious', 'calm', 'relaxed',
  'content', 'annoyed', 'upset', 'embarrassed', 'shy', 'flustered', 'curious', 'confused', 'worried', 'scared', 'afraid', 'hungry',
  'thirsty', 'lonely', 'jealous', 'in love', 'sick', 'comfortable', 'cozy', 'cosy', 'cold', 'warm', 'hot',
];
const FEELING_WORD = new RegExp(`^((very|so|a (bit|little)|quite|really|kind of|slightly|still)\\s+)?(${FEELINGS.join('|')})(\\s+and\\s+[a-z]+)?$`, 'i');
const SUBJECT = /^((currently|right now|now|just)\s+)?((i|she|he|they|we)\s+(am|is|are)|i['’]m|she['’]s|he['’]s|they['’]re|am|is|are)\s+((currently|right now|now|just)\s+)?/i;
const PLACE_ONLY_START = /^(in|at|inside|outside|near|nearby)\b/i;
const POSTURES = [
  'sitting', 'seated', 'standing', 'lying', 'laying', 'leaning', 'kneeling', 'crouching', 'squatting', 'reclining', 'resting',
  'lounging', 'walking', 'sleeping', 'slouching', 'perched', 'curled', 'stretched',
];
const POSTURE_WORD = new RegExp(`\\b(${POSTURES.join('|')})\\b`, 'i');
const MAX_DOING = 80;
// "not mentioned in the chat", "the chat does not say", "same as before": nothing new (the last known one stays).
const NO_VALUE_START = new RegExp(`^(unknown|unspecified|not (mentioned|specified|stated|known|described|clear|given|said)|${CHAT_SAYS_NOTHING}|(the )?same( as (before|earlier))?$|unchanged|as before)\\b`, 'i');
const DOING_LABEL = /^(pose|posture|position|action|activity|doing)\s*[:\-–—]\s*/i;
// "Bia is sitting on the bed": a roleplay answer in the third person, with the Kin's own name.
const NAME_SUBJECT = /^(?:[A-Z][\w'’-]*\s+){1,2}(?:is|was)\s+(?=[a-z]+ing\b|(?:seated|perched|curled|stretched)\b)|^[A-Z][\w'’-]*['’]s\s+(?=[a-z]+ing\b)/;

/** A "pose" that is really a place ("in the kitchen") and names no posture. */
export const isPlaceNotPose = (pose) => PLACE_ONLY_START.test(pose) && !POSTURE_WORD.test(pose);

// Common verbs a Kin writes in another form than "-ing": "sits on the sofa", "cook dinner", "drinks coffee".
const VERBS = new Set([
  'sit', 'stand', 'lie', 'lean', 'kneel', 'crouch', 'sleep', 'rest', 'nap', 'doze', 'lounge', 'curl', 'snuggle', 'cuddle', 'hug',
  'kiss', 'hold', 'read', 'write', 'type', 'text', 'call', 'cook', 'bake', 'eat', 'drink', 'sip', 'stir', 'chop', 'pour', 'prepare',
  'make', 'serve', 'set', 'wash', 'clean', 'tidy', 'fold', 'pack', 'brush', 'comb', 'dress', 'change', 'shower', 'bathe', 'watch',
  'look', 'stare', 'gaze', 'glance', 'smile', 'grin', 'laugh', 'giggle', 'blush', 'talk', 'chat', 'listen', 'wait', 'walk', 'run',
  'jog', 'drive', 'ride', 'play', 'work', 'study', 'draw', 'paint', 'knit', 'sew', 'sing', 'hum', 'dance', 'stretch', 'yawn',
  'relax', 'scroll', 'browse', 'shop', 'pick', 'carry', 'fix', 'adjust', 'check', 'open', 'close', 'think', 'wave', 'nod', 'sigh',
  'pace', 'tie', 'stroke', 'pet', 'feed',
]);
const GOING_TO_VERB = new RegExp(`^going to (?:${[...new Set([...PLANNED_VERBS, ...VERBS])].join('|')})\\b`, 'i');

// In "packing for tomorrow's trip", the time describes the trip. In "packing tomorrow" it dates the action.
function scheduledAction(s) {
  const actionTime = s.replace(/\b(?:for|about|until|before)\s+(?:tomorrow|tonight|later|next (?:week|time))\b|\b(?:tomorrow|tonight)['’]s\b/gi, '');
  return FUTURE_WORD.test(actionTime);
}

// Past forms only for postures ("sat on the sofa" is how many people say "sitting"); a past action may be over.
const PAST_POSTURE = { sat: 'sit', stood: 'stand', lay: 'lie', knelt: 'kneel', crouched: 'crouch', leaned: 'lean', leant: 'lean' };

/** "sits" -> "sit", "carries" -> "carry", "cook" -> "cook"; null for a word that is not one of VERBS. */
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

/** "*smiles* cooking" -> "cooking": a *roleplay* aside goes, before anything trims the stars at the edges. */
function withoutAsides(v) {
  if (typeof v !== 'string') return v;
  const marked = [];
  const outside = v.replace(/(\*{1,2})([^*]+?)\1/g, (_, stars, words) => {
    marked.push(words.trim());
    return ' ';
  }).trim();
  if (!marked.length) return v;
  // A quoted reply is dialogue. Keep the narrated action beside it, but ignore a short aside before plain narration.
  const narration = outside.replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, '').trim();
  return /[\p{L}\p{N}]/u.test(narration) ? narration : marked.join(', ');
}

/** No label, brackets, subject ("I am", "Bia is"), clothes, or clause about someone else ("who is watching TV"). */
function doingOnly(text) {
  let s = text.replace(/\*/g, '').replace(DOING_LABEL, '')
    .replace(/\s*\(([^()]*)\)?/g, (m, inner) => (inner.trim() ? ` ${inner.trim()}` : ''));    // "reading (a novel)"
  let prev;
  do { prev = s; s = s.replace(/^((currently|right now|now|just|still|actually)\s+)+/i, '').replace(NAME_SUBJECT, '').replace(SUBJECT, ''); } while (s !== prev);
  return s.replace(CLOTHES_CLAUSE, '')
    .replace(/,?\s+(who|whom|whose|which)\b.*$/i, '')                         // ", who is watching TV"
    .replace(/\s+that\s+(I|you|he|she|they|we|[A-Z][\w'’-]*)\s.*$/, '')     // "the glass that Ari dropped"
    .replace(/[.;,!?\s]+$/, '');
}

/** The shared repairs of a pose or an action, then the verb form ("sits" -> "sitting"). */
function cleanDoing(v, { posture }) {
  const raw = rawText(withoutAsides(v), 400);
  if (raw === null || raw === undefined) return raw;
  const s = doingOnly(raw);
  if (!s || NO_VALUE.test(s) || NO_VALUE_START.test(s) || NO_ACTION.test(s)) return null;
  const ing = toIng(s, { posture });
  return /^[A-Z][a-z]*(ing|ed)\b/.test(ing) ? ing[0].toLowerCase() + ing.slice(1) : ing;  // "Reading a book" mid-sentence
}

/** The body position ("sitting on the sofa"). Returns string | null | undefined. */
export function cleanPose(v) {
  const s = cleanDoing(v, { posture: true });
  if (!s) return s;
  // An activity after the posture belongs to the action:
  // "leaning on the wall, arms crossed, looking at Ari" -> "leaning on the wall, arms crossed".
  return clipWords(s.replace(/,\s*([a-z]+ing)\b.*$/, (m, w) => (POSTURE_WORD.test(w) ? m : '')), MAX_DOING);
}

// What the Kin says is not what it does (real test: "asking Ari to check whether Marina is in the kitchen").
// A speech clause after the action goes: "ordering pizza and asking Ariel to stop shouting" -> "ordering pizza".
const SPEECH_VERBS = [
  'asking', 'telling', 'saying', 'reminding', 'begging', 'urging', 'warning', 'assuring', 'promising', 'informing', 'instructing',
  'explaining', 'answering', 'replying', 'complaining', 'shouting', 'yelling', 'calling', 'whispering', 'arguing', 'pleading', 'insisting',
];
const SPEECH_CLAUSE = new RegExp(`\\s*(?:,|\\band\\b|\\bwhile\\b)\\s+(?:${SPEECH_VERBS.join('|')})\\b.*$`, 'i');
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

// Placeholders, idleness, plans, things already done and feelings: none of these is what the Kin is doing now.
const NOT_AN_ACTION = [NO_VALUE, NO_ACTION, PLAN_OR_PAST, GOING_TO_VERB, FEELING, FEELING_WORD];

/** What the Kin is doing now ("drinking coffee"). Plans, speech, feelings and things already finished are not an action. */
export function cleanAction(v) {
  const doing = cleanDoing(v, { posture: false });
  if (doing === null || doing === undefined) return doing;
  const s = trimEndPunctuation(withoutSpeech(doing).replace(/\s+(while|as)\s+[a-z]+ing\b.*$/i, '')); // "… while humming a song"
  if (!s || scheduledAction(s) || NOT_AN_ACTION.some((re) => re.test(s))) return null;
  return clipWords(s, MAX_DOING);
}

/**
 * "Sitting on the sofa, drinking coffee." Pose first, then the action; one inside the other ("sitting" and "sitting
 * on the sofa") is said once, the longer one.
 * @param {{ pose?: string|null, action?: string|null }} [doing]
 */
export function describeDoing({ pose, action } = {}) {
  const p = pose ? pose.toLowerCase() : '';
  const a = action ? action.toLowerCase() : '';
  const parts = [];
  if (pose && !(a && a !== p && a.includes(p))) parts.push(pose);
  if (action && !(p && p.includes(a))) parts.push(action);
  return parts.length ? toSentence(parts.join(', ')) : NOT_DESCRIBED.doing;
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

/** A text, a list of texts or an object as one text ("*runs fingers through her hair* long" -> "long"). */
function lookText(v, kind) {
  if (isPlainObject(v) || Array.isArray(v)) return lookFromParts(v, kind);
  if (typeof v === 'string') return v.replace(/\*([^*]+)\*/g, (_, content) =>
    /^(?:(?:I|she|he|they)\s+)?(?:runs?|running|brush(?:es|ing)?|touch(?:es|ing)?|adjust(?:s|ing)?|smil(?:es|ing)|laugh(?:s|ing)?|wink(?:s|ing)?|sigh(?:s|ing)?)\b/i.test(content.trim()) ? ' ' : content).trim();
  return undefined;
}

/** An object or a list of texts as one phrase (hair keeps its words in order). undefined: not texts. */
function lookFromParts(v, kind) {
  if (isPlainObject(v)) {
    const words = (kind === 'hair' ? HAIR_ORDER.map((k) => v[k]) : Object.values(v)).filter((x) => typeof x === 'string' && x.trim());
    if (!words.length) return undefined;
    return kind === 'hair' ? words.join(' ') : joinNatural(words);
  }
  if (v.some((x) => typeof x !== 'string')) return undefined;
  const items = v.map((x) => trimEndPunctuation(cleanString(x, MAX_LOOK))).filter(Boolean).slice(0, 4);
  if (kind !== 'hair') return joinNatural(items);
  if (items.every((x) => !/\s/.test(x))) return items.join(' ');                     // ["long","black","ponytail"]
  return items.reduce((all, x) => (!all ? x : `${all}${GOES_ON.test(x) ? ' ' : ', '}${x}`), '');
}

/** The phrase alone: no label, brackets, subject ("I have", "Bia has") or clause about someone else. */
function lookOnly(text) {
  return trimEndPunctuation(stripWrapping(cleanString(text, 400)).replace(/\*/g, ''))
    .replace(LOOK_LABEL, '')
    .replace(/^(?:hair|make-?up) (?:is|are)\s+/i, '')
    .replace(/\s*\(([^()]*)\)?/g, (m, inner) => (inner.trim() ? ` ${inner.trim()}` : ''))   // "(tied back)"
    .replace(NAME_HAS, '')
    .replace(/^(my|her|his|their) (hair|make-?up) (is|are)\s+/i, '')
    .replace(/^((i|she|he)\s+(have|has|['’]ve got|has got|am wearing|is wearing)|i['’]ve got|(she|he)['’]s got|i['’]m wearing|she['’]s wearing|he['’]s wearing|wearing)\s+/i, '')
    .replace(/,?\s+(who|whom|whose|which)\b.*$/i, '')                         // ", which she keeps adjusting"
    .replace(/\s+that\s+(I|you|he|she|they|we|[A-Z][\w'’-]*)\s.*$/, '')     // "that Ari loves"
    .replace(/[.;,!?\s]+$/, '');
}

/**
 * Hair or makeup: a text, a list of texts or an object, as one short phrase. Returns string | null | undefined (wrong
 * type). A *roleplay* aside, a label, a subject and "not mentioned" or "same as before" are repaired as for a pose.
 */
function lookPhrase(v, kind) {
  if (v === null || v === undefined) return null;
  const text = lookText(v, kind);
  if (text === undefined) return undefined;
  let s = lookOnly(text);
  if (!s || NO_VALUE.test(s) || NO_VALUE_START.test(s) || /^none (mentioned|specified|described|stated)$/i.test(s)) return null;
  if (/^([A-Z][a-z]*[\s,]*)+$/.test(s) && /\s/.test(s)) s = s.toLowerCase();         // "Long Dark Hair, Loose"
  return clipWords(s, MAX_LOOK);
}

/** Hair: one phrase ("long black hair in a ponytail"). Returns string | null | undefined (wrong type). */
export const cleanHair = (v) => lookPhrase(v, 'hair');

/** Like cleanHair; an explicit bare face ("no makeup", "bare-faced") is 'no makeup'. */
export function cleanMakeup(v) {
  if (typeof v === 'string' && BARE_FACE.test(cleanString(v, 200).replace(/[.!\s]+$/, ''))) return 'no makeup';
  const s = lookPhrase(v, 'makeup');
  if (typeof s !== 'string') return s;
  // A completed removal describes the current result only when all makeup is gone or the remainder is explicit.
  const removal = /^(?:(?:I|she|he|they)\s+)?(?:just\s+)?(?:washed off|wiped off|removed|took off)\s+/i;
  if (removal.test(s)) {
    const rest = s.replace(removal, '');
    const remaining = rest.match(/[.;,]\s*(?:only\s+)?([^.;,]+?)\s+(?:remains?|is left)$/i);
    if (remaining) return remaining[1];
    if (/^(?:all (?:of )?)?(?:(?:my|her|his|their|the) )?make-?up$/i.test(rest)) return 'no makeup';
  }
  return BARE_FACE.test(s) ? 'no makeup' : s;
}

/** "Long black hair in a ponytail." */
export const describeHair = (value) => (value ? toSentence(value) : NO_HAIR);
/** "Red lipstick and eyeliner." / "No makeup." */
export const describeMakeup = (value) => (value ? toSentence(value) : NO_MAKEUP);
