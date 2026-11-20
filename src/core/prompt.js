import { CLOTHING_SLOTS, ACCESSORY_SLOTS, BAG_SLOT } from './constants.js';

/** kin ask accepts at most 8,000 characters (Workshop guide). This prompt is far below that. */
export const KIN_ASK_LIMIT = 8000;

const SLOT_LIST = [...CLOTHING_SLOTS, ...ACCESSORY_SLOTS, BAG_SLOT].join(', ');

/**
 * The reading question. The Kin sees its own recent chat with the person (grants kin:read and chat:read:<days>), so
 * the prompt carries no messages: only what to say and how.
 */
export const OUTFIT_PROMPT = `You are {{name}}. Look at your recent chat with the person and say where you are, how you are positioned, what you are doing and what you are wearing, as of your last message.
The chat may be in Portuguese or English: understand both, but answer in English only.
Include only what the chat states; never guess. Apply later changes: something taken off is no longer worn, a place you have left is no longer where you are, and an action you have finished is no longer what you are doing.
Ignore plans, wishes and hypothetical outfits. Describe only yourself.
Be concise: write each piece as a short noun phrase with its article and key traits ("a perfumed white shirt", "blue jeans", "a leather jacket"), at most 6 words.
Answer with minified JSON only, on one line: no code fence, no narration, no roleplay, no commentary.
"location": where you are right now, as a short phrase starting with in, at or on ("in the kitchen", "at the hospital", "on the bus to college"). The place only, not your posture or what you are doing. If you are travelling, say so ("on the way to the hospital"); planning to go somewhere is not being there.
"pose": your body position right now, as a short phrase ("sitting on the sofa", "standing by the window", "lying on the bed"). It may name the furniture or spot you are on; "location" is the room or place.
"action": what you are doing right now, as a short -ing phrase ("drinking coffee", "reading a book", "talking with the person"). Not plans, not things already finished, not feelings.
Other keys are slots, values are arrays of pieces, innermost layer first. Slots: ${SLOT_LIST}.
topwear = shirts, sweaters, jackets, coats, dresses; bottomwear = trousers, jeans, skirts, shorts; footwear = shoes, boots; footunderwear = socks, tights; topunderwear and bottomunderwear = bra, undershirt, underpants only; eyes-accessory = glasses; bottom-accessory = hips; bags = backpack, handbag.
Leave out keys with nothing. If the chat says nothing about either, answer {}.
The example only shows the format; never copy its values.
Example: {"location":"at a bookstore","pose":"standing by a shelf","action":"flipping through a book","topwear":["a grey hoodie"],"bottomwear":["black leggings"],"footwear":["white sneakers"]}`;

/** The Kin's name for a prompt: one line, at most 60 characters. */
const kinName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'the character';

/** The reading question for a Kin (its name, one line, at most 60 characters). */
export function buildOutfitPrompt({ name, template = OUTFIT_PROMPT }) {
  const who = kinName(name);
  return template.replace(/\{\{name\}\}/g, () => who); // a function: "$&" in a name is not a replacement pattern
}

/**
 * Asked when a reading says the Kin is asleep. {{now}} is the person's clock ("23:10 on Friday"): the wake-up time
 * is read against it, so the Kin must answer on that clock.
 */
export const SLEEP_PROMPT = `You are {{name}}. It is now {{now}} for the person. Look at your recent chat with the person, as of your last message.
Question: are you asleep right now, and if so, at what time do you plan to wake up?
Answer in English only, with minified JSON only, on one line: no code fence, no narration, no roleplay, no commentary.
If you are asleep (sleeping, napping, dozing): {"sleeping":true,"wake_at":"HH:MM"}. wake_at is a 24-hour clock time on the person's clock, for example "07:30". If the chat does not say when you will wake up, give the time you would normally wake up.
If you are not asleep (awake, only resting, lying in bed awake, or going to sleep later): {"sleeping":false}
Nothing else.`;

/** Asked a little before the wake-up time the Kin gave. */
export const DREAM_PROMPT = `You are {{name}}. It is now {{now}} for the person. You fell asleep in your recent chat with the person and you are waking up now.
Question: what did you dream, and how much of that dream do you still remember now that the day starts?
Answer in English only, with minified JSON only, on one line: no code fence, no narration, no roleplay, no commentary.
Format: {"dream":"<a short summary of the dream, at most 25 words, in the first person, past tense>","remembered":"<all|most|some|little|nothing>"}
If you remember no dream at all: {"dream":"","remembered":"nothing"}
Nothing else.`;

/** Fills a follow-up prompt (sleep or dream) with the Kin's name and the person's current time. */
export function buildFollowUpPrompt(template, { name, now }) {
  const who = kinName(name);
  const when = String(now ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'unknown';
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => ({ name: who, now: when }[k] ?? m));
}
