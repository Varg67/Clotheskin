import { buildOutfitPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { parseReading, describeReading } from '../screen/src/core/outfit.js';
import { Settings, MemoryStorage } from '../screen/src/core/store.js';
import { ReadingStore, afterAttempt } from '../screen/src/core/readings.js';
import { normalizeInterval, pickDue, AUTO_MAX_KINS_PER_RUN } from '../screen/src/core/auto.js';

const clip = (s, n = 480) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const KIN_END_LIMIT = 500;

/**
 * The line given back to the screen: the three sentences as compact JSON, shortened so the whole line stays within
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

/** One question to one Kin and its answer as three sentences. Never throws. */
async function readOne({ kinId, name, provider }) {
  const prompt = buildOutfitPrompt({ name });
  if (prompt.length > KIN_ASK_LIMIT) return { ok: false, error: 'The question to the Kin is too long.' };
  let answer;
  try {
    answer = await provider.extract({ prompt, kinId });
  } catch (e) {
    return { ok: false, error: clip(e.message) };
  }
  const parsed = parseReading(answer);
  if (!parsed.ok) return { ok: false, error: clip(`${parsed.error} Nothing was changed. Try again.`) };
  return { ok: true, sentences: describeReading(parsed) };
}

/** Saving the latest reading is a convenience: if it fails, the reading itself still counts. */
async function remember(readings, kinId, value) {
  try { await readings.put(kinId, value); } catch { /* the screen can still show the answer it was given */ }
}

/**
 * The schedule beat: for each Kin the person ticked, ask again if the interval has passed since the last attempt.
 * A failure is recorded as an attempt, so it is retried at the next interval, not on every beat.
 */
async function runScheduled({ provider, storage, clock }) {
  const settings = await new Settings(storage).load();
  if (!settings.autoUpdate) return { ok: true, message: 'Automatic updates are off.' };
  const interval = normalizeInterval(settings.autoIntervalMinutes);
  const kins = Array.isArray(settings.autoKins) ? settings.autoKins : [];
  if (!kins.length) return { ok: true, message: 'Automatic updates are on, but no Kin is ticked.' };

  const readings = new ReadingStore(storage);
  const known = {};
  for (const k of kins) if (k && typeof k.id === 'string') known[k.id] = await readings.get(k.id);
  const now = clock();
  const due = pickDue({ now, kins, readings: known, intervalMinutes: interval, max: AUTO_MAX_KINS_PER_RUN });
  if (!due.length) return { ok: true, message: 'No Kin is due yet.' };

  const done = [];
  for (const kin of due) {
    // Claim first: mark the attempt BEFORE the (slow) question, so a beat that starts while this one is still waiting
    // for the Kin sees it as attempted and skips it. If this run dies midway, the Kin is retried at the next interval.
    await remember(readings, kin.id, afterAttempt(known[kin.id], { now: clock(), source: 'auto', sentences: null, error: known[kin.id]?.error ?? null, claim: true }));
    const r = await readOne({ kinId: kin.id, name: kin.name, provider });
    await remember(readings, kin.id, afterAttempt(known[kin.id], { now: clock(), source: 'auto', sentences: r.sentences, error: r.error }));
    done.push({ name: kin.name, ok: r.ok, error: r.error });
  }
  const failed = done.filter((d) => !d.ok);
  const message = `Checked ${done.length}: ${done.map((d) => `${d.name} ${d.ok ? 'updated' : 'failed'}`).join(', ')}.${failed[0] ? ` ${failed[0].error}` : ''}`;
  return { ok: failed.length < done.length, message: clip(message) };
}

/**
 * Handles one run. `event` is the JSON the Workshop sends on stdin:
 *   {"trigger":"action","action":"read_outfit","input":{"kin":"<id>","name":"<name>"}}   (the Update status button)
 *   {"trigger":"schedule"}                                                              (every few minutes)
 * Returns { ok, message }. For the button, on success `message` is {"location":"…","doing":"…","outfit":"…"}.
 */
export async function handleRun({ event, provider, storage = new MemoryStorage(), clock = () => new Date() }) {
  if (event?.trigger === 'schedule') return runScheduled({ provider, storage, clock });
  if (event?.trigger !== 'action') return { ok: false, message: `Unsupported trigger: ${event?.trigger}` };
  if (event.action !== 'read_outfit') return { ok: false, message: `Unknown action: ${event.action}` };
  const input = event.input || {};
  const kinId = event.kin || input.kin;
  if (!kinId) return { ok: false, message: 'No Kin was given for this action.' };

  const r = await readOne({ kinId, name: input.name, provider });
  if (!r.ok) return { ok: false, message: r.error };
  // A manual reading is the newest reading: remember it, which also restarts the automatic interval.
  await remember(new ReadingStore(storage), kinId, afterAttempt(null, { now: clock(), source: 'manual', sentences: r.sentences }));
  return { ok: true, message: packReading(r.sentences) };
}

export { AUTO_MAX_KINS_PER_RUN };
