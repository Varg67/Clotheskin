import { CLOTHING_SLOTS, ACCESSORY_SLOTS, BAG_SLOT } from './constants.js';
import { cleanString } from './text.js';

/** kin ask accepts at most 8,000 characters (Workshop guide). This prompt is far below that. */
export const KIN_ASK_LIMIT = 8000;

const SLOT_LIST = [...CLOTHING_SLOTS, ...ACCESSORY_SLOTS, BAG_SLOT].join(', ');

/** The format example of the reading question; its values also tell a Kin that copied them instead of answering. */
const EXAMPLE = {
  location: 'at a bookstore', pose: 'standing by a shelf', action: 'flipping through a book', hair: 'a loose braid',
  topwear: ['a grey hoodie'], bottomwear: ['black leggings'], footwear: ['white sneakers'],
};

/**
 * The reading question. The Kin sees its own recent chat with the person (grants kin:read and chat:read:<days>), so
 * the prompt carries no messages: only what to say and how.
 */
export const OUTFIT_PROMPT = `[DIRECTIVE — OUT OF CHARACTER. This is not a roleplay message and the person never sees it. Do not answer as {{name}} speaking: no *actions*, no dialogue, no narration.]
English only: every key and value in English, whatever language the chat is in; translate it ("na cozinha", "en la cocina" -> "in the kitchen").
Task: you are {{name}}. From your recent chat with the person, report where you are, your pose, what you are doing, what you are wearing, and your hair and makeup, as of your last message.
Only what the recent chat states; never guess or invent: if the recent chat does not say it, leave that key out, and {} is a correct answer. Not from your memories, journal, backstory or earlier days, unless the recent chat says it is still so. Apply later changes: something taken off is no longer worn, a place you have left is no longer where you are, a finished action is no longer what you are doing. Ignore plans, wishes and hypothetical outfits. Describe only yourself.
Format: minified JSON only, on one line; no code fence or comment.
"location": the place only, at most 8 words, starting with in, at or on ("in the kitchen", "on the bus to college"); not your posture, activity or who is with you. Travelling is a place ("on the way to the hospital"); planning to go is not.
"pose": your body position, at most 6 words ("sitting on the sofa"); it may name the furniture, "location" is the room or place.
"action": what you are doing now, a short -ing phrase of at most 5 words ("drinking coffee", "talking with Ari"); not what you say or what others do, not plans, finished things or feelings.
"hair": at most 8 words, e.g. "long black hair in a ponytail". "makeup": e.g. "red lipstick and eyeliner"; "no makeup" only if the chat says so.
Other keys are slots: arrays of short noun phrases with article and key traits, at most 6 words ("a perfumed white shirt"), innermost layer first. Slots: ${SLOT_LIST}.
topwear = shirts, sweaters, jackets, coats, dresses; bottomwear = trousers, jeans, skirts, shorts; footwear = shoes, boots; footunderwear = socks, tights; topunderwear, bottomunderwear = bra, undershirt, underpants only; eyes-accessory = glasses; bags = backpack, handbag. Wearing nothing: "clothing":["naked"]; no shoes: "footwear":["barefoot"].
The example shows the format only; never copy its values.
Example: ${JSON.stringify(EXAMPLE)}
[END DIRECTIVE] Your whole reply is one line of minified JSON in English: it starts with { and ends with }.`;

const flat = (v) => (Array.isArray(v) ? v.join('|') : String(v ?? '')).trim().toLowerCase();

/** True when at least three of the example's values come back unchanged: a copy, not a reading. */
export function looksCopiedFromExample(doc) {
  if (!doc || typeof doc !== 'object') return false;
  const same = Object.entries(EXAMPLE).filter(([k, v]) => flat(doc[k]) === flat(v)).length;
  return same >= 3;
}

/** The Kin's name for a prompt: one line, at most 60 characters. */
const kinName = (name) => cleanString(name, 60) || 'the character';

/** The reading question for a Kin (its name, one line, at most 60 characters). */
export function buildOutfitPrompt({ name, template = OUTFIT_PROMPT }) {
  const who = kinName(name);
  return template.replace(/\{\{name\}\}/g, () => who); // a function: "$&" in a name is not a replacement pattern
}

const SLEEP_QUESTION = 'Question: are you asleep right now, and if so, at what time do you plan to wake up?';
const DREAM_QUESTION = 'Question: what did you dream, and how much of that dream do you still remember now that the day starts?';

/**
 * Asked when a reading says the Kin is asleep. {{now}} is the person's clock ("23:10 on Friday"): the wake-up time
 * is read against it, so the Kin must answer on that clock.
 */
export const SLEEP_PROMPT = `[DIRECTIVE — OUT OF CHARACTER. This is not a roleplay message and the person never sees it. Do not answer as {{name}} speaking: no *actions*, no dialogue, no narration.]
You are {{name}}. It is now {{now}} for the person. Look at your recent chat with the person, as of your last message.
${SLEEP_QUESTION}
Answer in English only, with minified JSON only, on one line: no code fence, no narration, no roleplay, no commentary.
If you are asleep (sleeping, napping, dozing): {"sleeping":true,"wake_at":"HH:MM"}. wake_at is a 24-hour clock time on the person's clock, for example "07:30". If the chat does not say when you will wake up, give the time you would normally wake up.
If you are not asleep (awake, only resting, lying in bed awake, or going to sleep later): {"sleeping":false}
[END DIRECTIVE] Your whole reply is one line of minified JSON: it starts with { and ends with }.`;

/** Asked a little before the wake-up time the Kin gave. */
export const DREAM_PROMPT = `[DIRECTIVE — OUT OF CHARACTER. This is not a roleplay message and the person never sees it. Do not answer as {{name}} speaking: no *actions*, no dialogue, no narration.]
You are {{name}}. It is now {{now}} for the person. You fell asleep in your recent chat with the person and you are waking up now.
${DREAM_QUESTION}
Answer in English only, with minified JSON only, on one line: no code fence, no narration, no roleplay, no commentary.
Format: {"dream":"<a short summary of the dream, at most 25 words, in the first person, past tense>","remembered":"<all|most|some|little|nothing>"}
If you remember no dream at all: {"dream":"","remembered":"nothing"}
[END DIRECTIVE] Your whole reply is one line of minified JSON in English: it starts with { and ends with }.`;

/**
 * Asked once more, in the same run, when the Kin's answer could not be read (roleplay, narration, another language):
 * the same question, after a short correction. Self-contained: it does not rely on the Kin remembering the first ask.
 */
const CORRECTION = '[DIRECTIVE — OUT OF CHARACTER] Your previous reply to this directive could not be used: it was roleplay, narration or not the JSON asked for. Do not continue the roleplay. Answer the directive below with the JSON line only.';
export function buildCorrectionPrompt(prompt) {
  return `${CORRECTION}\n${prompt}`;
}

/** Fills a follow-up prompt (sleep or dream) with the Kin's name and the person's current time. */
export function buildFollowUpPrompt(template, { name, now }) {
  const who = kinName(name);
  const when = cleanString(now, 40) || 'unknown';
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => ({ name: who, now: when }[k] ?? m));
}

/**
 * Which of the three questions a prompt is: 'sleep', 'dream' or 'reading' (a correction keeps the question it
 * repeats). For stand-ins of the Kin (the dev harness and the tests), which answer each question differently.
 */
export function promptKind(prompt) {
  if (prompt.includes(SLEEP_QUESTION)) return 'sleep';
  if (prompt.includes(DREAM_QUESTION)) return 'dream';
  return 'reading';
}
