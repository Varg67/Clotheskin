import { buildOutfitPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { parseReading, describeReading } from '../screen/src/core/outfit.js';

const clip = (s, n = 480) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const KIN_END_LIMIT = 500;

/**
 * The line given back to the screen: both sentences as compact JSON, shortened so the whole line stays within
 * the 500 characters `kin end` allows. Location and pose/action are short by nature, so only the outfit is ever cut.
 */
export function packReading({ location, doing, outfit }) {
  const fits = (o) => JSON.stringify({ location, doing, outfit: o }).length <= KIN_END_LIMIT;
  let text = outfit;
  while (!fits(text) && text.length > 1) text = text.slice(0, Math.max(1, text.length - Math.max(1, JSON.stringify({ location, doing, outfit: text }).length - KIN_END_LIMIT + 1)));
  if (text !== outfit) text = `${text.replace(/[\s,]+\S*$/, '').replace(/[.…]+$/, '')}…`;
  while (!fits(text) && text.length > 1) text = `${text.slice(0, -2)}…`;
  return JSON.stringify({ location, doing, outfit: text });
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
