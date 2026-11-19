import { buildOutfitPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { parseReading, describeReading } from '../screen/src/core/outfit.js';

const clip = (s, n = 480) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const KIN_END_LIMIT = 500;

/**
 * The line given back to the screen: the three sentences as compact JSON, shortened so the whole line stays within
 * the 500 characters `kin end` allows. Location and pose/action are short by nature, so only the outfit is ever cut.
 */
export function packReading({ location, doing, outfit }) {
  const pack = (o) => JSON.stringify({ location, doing, outfit: o });
  if (pack(outfit).length <= KIN_END_LIMIT) return pack(outfit);
  // JSON escaping only makes text longer, so the room left for the raw text is an upper bound.
  let text = outfit.slice(0, Math.max(0, KIN_END_LIMIT - pack('…').length));
  text = text.replace(/[\s,]+\S*$/, '').replace(/[.…]+$/, ''); // end on a whole word
  while (text && pack(`${text}…`).length > KIN_END_LIMIT) text = text.slice(0, -1);
  return pack(`${text.replace(/[\s,]+$/, '')}…`);
}

/**
 * Handles one run. `event` is the JSON the Workshop sends on stdin:
 *   {"trigger":"action","action":"read_outfit","input":{"kin":"<id>","name":"<name>"}}
 * Returns { ok, message }. On success `message` is {"location":"...","doing":"...","outfit":"..."} (three natural sentences) and the
 * caller ends the run with it, so the screen shows them as they are. Nothing is stored.
 */
export async function handleRun({ event, provider }) {
  if (event?.trigger !== 'action') return { ok: false, message: `Unsupported trigger: ${event?.trigger}` };
  if (event.action !== 'read_outfit') return { ok: false, message: `Unknown action: ${event.action}` };
  const input = event.input || {};
  const kinId = event.kin || input.kin;
  if (!kinId) return { ok: false, message: 'No Kin was given for this action.' };

  const prompt = buildOutfitPrompt({ name: input.name });
  if (prompt.length > KIN_ASK_LIMIT) return { ok: false, message: 'The question to the Kin is too long.' };
  let answer;
  try {
    answer = await provider.extract({ prompt, kinId });
  } catch (e) {
    return { ok: false, message: clip(e.message) };
  }
  const parsed = parseReading(answer);
  if (!parsed.ok) return { ok: false, message: clip(`${parsed.error} Nothing was changed. Try again.`) };
  return { ok: true, message: packReading(describeReading(parsed)) };
}
