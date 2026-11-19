import { buildOutfitPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { parseOutfit, describeOutfit } from '../screen/src/core/outfit.js';

const clip = (s, n = 480) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * Handles one run. `event` is the JSON the Workshop sends on stdin:
 *   {"trigger":"action","action":"read_outfit","input":{"kin":"<id>","name":"<name>"}}
 * Returns { ok, message }. On success `message` is the outfit as one natural sentence; the caller ends the run
 * with it, so the screen shows it as is. Nothing is stored.
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
  const parsed = parseOutfit(answer);
  if (!parsed.ok) return { ok: false, message: clip(`${parsed.error} Nothing was changed. Try again.`) };
  return { ok: true, message: clip(describeOutfit(parsed.outfit)) };
}
