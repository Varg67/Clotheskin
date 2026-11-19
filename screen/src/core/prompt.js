import { renderContract, renderCompactContract } from './contract.js';
import { projectForPrompt } from './model.js';

/**
 * Editable extraction prompt. The three {{...}} placeholders from the original
 * brief are kept; {{operation_contract}} is generated from contract.js.
 */
export const DEFAULT_EXTRACTION_PROMPT = `Update the scene tracker for the target character at the end of the supplied exchange.
Read both Portuguese and English. Treat dialogue and narrated actions as scene evidence.
Track only the selected companion. Use the supplied stable ID and speaker metadata
when available. If the actor cannot be identified, leave the affected update unresolved.
Resolve first-person actions using the speaker label. Distinguish the target character
from the user and other people in the scene.

Start from the last confirmed state. Report completed actions and facts established
by the scene. Plans, questions, suggestions, memories and hypothetical outfits do
not change the current state. Keep the last established location until the scene
establishes a move. Keep unwitnessed or unmentioned details unknown.

Return one JSON object with "state_updates", "item_changes" and "unresolved".
Write every generated description and unresolved note in English, preserving proper names. In state_updates, include only changed values for hair, makeup,
position and location. Use "none" for explicitly absent makeup. In item_changes,
describe the garment, accessory or belonging by its known ID when available or
by an ordinary item name on first appearance. Include only supported operations
and known attributes. Record movement of an item separately from movement of
its container. If a reference is ambiguous, describe it in unresolved and leave
the affected item unchanged. With no changes, return empty collections.
Return only the JSON object, with no commentary.

{{operation_contract}}

TARGET CHARACTER: {{target_character}}
PREVIOUS STATE: {{previous_state_json}}
RECENT EXCHANGE: {{speaker_labeled_messages}}
`;

export function formatMessages(messages) {
  return messages.map((m) => `${m.speaker}: ${m.text}`).join('\n');
}

export function describeTarget(profile) {
  const parts = [`${profile.name} (stable ID: ${profile.id}`];
  if (profile.pronouns) parts[0] += `; pronouns: ${profile.pronouns}`;
  return `${parts[0]})`;
}

/** Fills the template. Replacement uses functions so "$" in user text is never interpreted. */
export function buildPrompt({ template = DEFAULT_EXTRACTION_PROMPT, profile, record, messages }) {
  const values = {
    operation_contract: renderContract(),
    target_character: describeTarget(profile),
    previous_state_json: JSON.stringify(projectForPrompt(record, profile)),
    speaker_labeled_messages: `\n${formatMessages(messages)}`,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m));
}

/** kin ask accepts at most 8,000 characters. */
export const KIN_ASK_LIMIT = 8000;

/**
 * Variant for the Kindroid Workshop. The app cannot read the chat: the Kin sees its own recent chat
 * (grant chat:read:<days>) and answers the question. So there is no RECENT EXCHANGE block, and
 * the Kin must answer with data only, not in character.
 */
export const HOST_CHAT_PROMPT = `You are filling in a scene tracker about yourself, {{target_character}}.
Look at your recent chat with the person and update the tracker as of the last message.
Read both Portuguese and English. Dialogue and narrated actions are scene evidence.
Track only yourself, not the person or anyone else in the scene.

Start from PREVIOUS STATE. Report completed actions and facts established by the chat.
Plans, questions, suggestions, memories and hypothetical outfits do not change the state.
Keep the last established location until the chat establishes a move. Leave unmentioned details unknown.
Write every description in English, keeping proper names. Describe items by known id, or by an
ordinary name on first appearance. If a reference is ambiguous, say so in "unresolved" and leave it unchanged.
With no changes, return empty collections.
Answer with the JSON object only: no narration, no roleplay, no commentary.

{{operation_contract}}

PREVIOUS STATE: {{previous_state_json}}
`;

/** Builds the Workshop prompt and shrinks the state until it fits the limit. */
export function buildHostChatPrompt({ template = HOST_CHAT_PROMPT, profile, record, limit = KIN_ASK_LIMIT }) {
  const fill = (opts) => template.replace(/\{\{(\w+)\}\}/g, (m, k) => ({
    operation_contract: renderCompactContract(),
    target_character: profile.name,
    previous_state_json: JSON.stringify(projectForPrompt(record, profile, { compact: true, ...opts })),
  }[k] ?? m));
  for (const maxNotWorn of [Infinity, 20, 10, 5, 0]) {
    const text = fill({ maxNotWorn });
    if (text.length <= limit) return text;
  }
  throw new Error(`The scene state is too large to send in one question (limit ${limit} characters). Remove unused items in the editor and try again.`);
}
