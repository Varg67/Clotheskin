import { CLOTHING_SLOTS, ACCESSORY_SLOTS, BAG_SLOT } from './constants.js';

/** kin ask accepts at most 8,000 characters (Workshop guide). This prompt is far below that. */
export const KIN_ASK_LIMIT = 8000;

const SLOT_LIST = [...CLOTHING_SLOTS, ...ACCESSORY_SLOTS, BAG_SLOT].join(', ');

/**
 * The one prompt. In the Workshop the Kin sees its own recent chat (grant chat:read), so {{recent_chat}} is empty.
 * In local mode the pasted chat goes there.
 */
export const OUTFIT_PROMPT = `You are {{name}}. From your recent chat with the person, say where you are, your pose, what you are doing, what you are wearing, and your hair and makeup, as of your last message.
English only: every key and value in English, even when the chat is in Portuguese; translate it ("na cozinha" -> "in the kitchen").
Only what the recent chat states; never guess. Not from your memories, journal, backstory or earlier days, unless the recent chat says it is still so. Apply later changes: something taken off is no longer worn, a place you have left is no longer where you are, a finished action is no longer what you are doing. Ignore plans, wishes and hypothetical outfits. Describe only yourself.
Reply with minified JSON only, on one line: no code fence, narration, roleplay or comment. Leave out keys with nothing; if the chat says nothing about any of this, reply {}.
"location": the place only, starting with in, at or on ("in the kitchen", "on the bus to college"); not your posture or activity. Travelling is a place ("on the way to the hospital"); planning to go is not.
"pose": your body position ("sitting on the sofa"); it may name the furniture, "location" is the room or place.
"action": what you are doing now, a short -ing phrase ("drinking coffee"); not plans, finished things or feelings.
"hair": e.g. "long black hair in a ponytail". "makeup": e.g. "red lipstick and eyeliner"; "no makeup" only if the chat says so.
Other keys are slots: arrays of short noun phrases with article and key traits, at most 6 words ("a perfumed white shirt"), innermost layer first. Slots: ${SLOT_LIST}.
topwear = shirts, sweaters, jackets, coats, dresses; bottomwear = trousers, jeans, skirts, shorts; footwear = shoes, boots; footunderwear = socks, tights; topunderwear, bottomunderwear = bra, undershirt, underpants only; eyes-accessory = glasses; bottom-accessory = hips; bags = backpack, handbag.
The example shows the format only; never copy its values.
Example: {"location":"at a bookstore","pose":"standing by a shelf","action":"flipping through a book","hair":"a loose braid","topwear":["a grey hoodie"],"bottomwear":["black leggings"],"footwear":["white sneakers"]}
{{recent_chat}}`;export function buildOutfitPrompt({ name, chat = '', template = OUTFIT_PROMPT }) {
  const who = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'the character';
  const recent = String(chat ?? '').trim();
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => ({
    name: who,
    recent_chat: recent ? `\nRECENT CHAT:\n${recent}\n` : '',
  }[k] ?? m));
}


/** The example's values, to notice a Kin that copied them instead of answering. */
const EXAMPLE = JSON.parse(OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1]);
const flat = (v) => (Array.isArray(v) ? v.join('|') : String(v ?? '')).trim().toLowerCase();

/** True when at least three of the example's values come back unchanged: a copy, not a reading. */
export function looksCopiedFromExample(doc) {
  if (!doc || typeof doc !== 'object') return false;
  const same = Object.entries(EXAMPLE).filter(([k, v]) => flat(doc[k]) === flat(v)).length;
  return same >= 3;
}
