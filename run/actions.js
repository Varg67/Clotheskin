import { buildOutfitPrompt, buildFollowUpPrompt, SLEEP_PROMPT, DREAM_PROMPT, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { parseSleepAnswer, parseDreamAnswer, errorKind } from '../screen/src/core/auto.js';
import { parseReading, describeReading } from '../screen/src/core/outfit.js';

const clip = (s, n = 480) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const KIN_END_LIMIT = 500;

/**
 * The line given back to the screen: the three sentences as compact JSON, shortened so the whole line stays within
 * the 500 characters `kin end` allows. Location and pose/action are short by nature, so only the outfit is ever cut.
 * `kin` (optional) names the Kin the reading is for, so the screen can tell a late reply for another Kin apart.
 */
export function packReading({ kin, location, doing, outfit }) {
  const pack = (o) => JSON.stringify({ kin, location, doing, outfit: o });
  if (pack(outfit).length <= KIN_END_LIMIT) return pack(outfit);
  // JSON escaping only makes text longer, so the room left for the raw text is an upper bound.
  let text = outfit.slice(0, Math.max(0, KIN_END_LIMIT - pack('…').length));
  text = text.replace(/[\s,]+\S*$/, '').replace(/[.…]+$/, ''); // end on a whole word
  while (text && pack(`${text}…`).length > KIN_END_LIMIT) text = text.slice(0, -1);
  return pack(`${text.replace(/[\s,]+$/, '')}…`);
}

/** A failure line for the screen: {"kin","error","kind"}. kind: server (Kindroid did not answer), answer (the Kin did). */
function packFailure({ kin, error, kind }) {
  const pack = (e) => JSON.stringify({ kin, kind, error: e });
  let text = String(error);
  while (text.length > 1 && pack(text).length > KIN_END_LIMIT) text = `${text.slice(0, -2)}…`;
  return pack(text);
}

/** Each action: the prompt to send and how to read the answer into the line given back to the screen. */
const ACTIONS = {
  read_outfit: {
    prompt: (input) => buildOutfitPrompt({ name: input.name }),
    read: (answer, kin) => {
      const parsed = parseReading(answer);
      return parsed.ok ? { ok: true, message: packReading({ kin, ...describeReading(parsed) }) } : { ok: false, error: `${parsed.error} Nothing was changed. Try again.` };
    },
  },
  ask_sleep: {
    prompt: (input) => buildFollowUpPrompt(SLEEP_PROMPT, input),
    read: (answer, kin) => {
      const p = parseSleepAnswer(answer);
      return p.ok ? { ok: true, message: JSON.stringify({ kin, sleeping: p.sleeping, wake_at: p.wakeAt }) } : { ok: false, error: `${p.error} Try again.` };
    },
  },
  ask_dream: {
    prompt: (input) => buildFollowUpPrompt(DREAM_PROMPT, input),
    read: (answer, kin) => {
      const p = parseDreamAnswer(answer);
      return p.ok ? { ok: true, message: packDream({ kin, dream: p.dream, remembered: p.remembered }) } : { ok: false, error: `${p.error} Try again.` };
    },
  },
};

function packDream({ kin, dream, remembered }) {
  const pack = (d) => JSON.stringify({ kin, dream: d, remembered });
  let text = dream;
  while (text && pack(text).length > KIN_END_LIMIT) text = `${text.slice(0, -2)}…`;
  return pack(text);
}

/**
 * Handles one run. `event` is the JSON the Workshop sends on stdin:
 *   {"trigger":"action","action":"read_outfit"|"ask_sleep"|"ask_dream","input":{"kin":"<id>","name":"<name>","now":"23:10 on Friday"}}
 * Returns { ok, message }. `message` is one line of JSON the caller ends the run with:
 *   read_outfit -> {"kin","location","doing","outfit"} (three sentences)
 *   ask_sleep   -> {"kin","sleeping":true|false,"wake_at":"HH:MM"|null}
 *   ask_dream   -> {"kin","dream":"…"|null,"remembered":"all|most|some|little|nothing"}
 *   failure     -> {"kin","kind":"server"|"answer"|"input","error":"…"}
 * Nothing is stored.
 */
export async function handleRun({ event, provider }) {
  const input = event?.input || {};
  const kinId = event?.kin || input.kin;
  const fail = (error, kind) => ({ ok: false, message: packFailure({ kin: kinId, error, kind }) });
  if (event?.trigger !== 'action') return fail(`Unsupported trigger: ${event?.trigger}`, 'input');
  const action = Object.hasOwn(ACTIONS, String(event.action)) ? ACTIONS[event.action] : null;
  if (!action) return fail(`Unknown action: ${event.action}`, 'input');
  if (!kinId) return fail('No Kin was given for this action.', 'input');

  const prompt = action.prompt(input);
  if (prompt.length > KIN_ASK_LIMIT) return fail('The question to the Kin is too long.', 'input');
  let answer;
  try {
    answer = await provider.extract({ prompt, kinId });
  } catch (e) {
    return fail(clip(e.message), errorKind(e.message, 'server'));
  }
  const r = action.read(answer, kinId);
  return r.ok ? r : fail(clip(r.error), 'answer');
}
