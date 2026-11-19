import { CLOTHING_SLOTS, ACCESSORY_SLOTS, BAG_SLOT } from './constants.js';

/** kin ask accepts at most 8,000 characters (Workshop guide). This prompt is far below that. */
export const KIN_ASK_LIMIT = 8000;

const SLOT_LIST = [...CLOTHING_SLOTS, ...ACCESSORY_SLOTS, BAG_SLOT].join(', ');

/**
 * The one prompt. In the Workshop the Kin sees its own recent chat (grant chat:read), so {{recent_chat}} is empty.
 * In local mode the pasted chat goes there.
 */
export const OUTFIT_PROMPT = `You are {{name}}. Look at your recent chat with the person and say where you are and what you are wearing as of your last message.
The chat may be in Portuguese or English: understand both, but answer in English only.
Include only what the chat states; never guess. Apply later changes: something taken off is no longer worn, and a place you have left is no longer where you are.
Ignore plans, wishes and hypothetical outfits. Describe only yourself.
Be concise: write each piece as a short noun phrase with its article and key traits ("a perfumed white shirt", "blue jeans", "a leather jacket"), at most 6 words.
Answer with minified JSON only, on one line: no code fence, no narration, no roleplay, no commentary.
"location": where you are right now, as a short phrase starting with in, at or on ("in the kitchen", "at the hospital", "on the bus to college"). The place only, not your posture or what you are doing. If you are travelling, say so ("on the way to the hospital"); planning to go somewhere is not being there.
Other keys are slots, values are arrays of pieces, innermost layer first. Slots: ${SLOT_LIST}.
topwear = shirts, sweaters, jackets, coats, dresses; bottomwear = trousers, jeans, skirts, shorts; footwear = shoes, boots; footunderwear = socks, tights; topunderwear and bottomunderwear = bra, undershirt, underpants only; eyes-accessory = glasses; bottom-accessory = hips; bags = backpack, handbag.
Leave out keys with nothing. If the chat says nothing about either, answer {}.
Example: {"location":"in the living room","topwear":["a perfumed white shirt","a leather jacket"],"bottomwear":["blue jeans"],"eyes-accessory":["round glasses"]}
{{recent_chat}}`;export function buildOutfitPrompt({ name, chat = '', template = OUTFIT_PROMPT }) {
  const who = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'the character';
  const recent = String(chat ?? '').trim();
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => ({
    name: who,
    recent_chat: recent ? `\nRECENT CHAT:\n${recent}\n` : '',
  }[k] ?? m));
}
