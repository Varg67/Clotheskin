import { buildOutfitPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { parseReading, describeReading, NO_HAIR, NO_MAKEUP } from '../screen/src/core/outfit.js';
import { Settings, MemoryStorage, flag } from '../screen/src/core/store.js';
import { ReadingStore, JournalStore, afterAttempt } from '../screen/src/core/readings.js';
import { normalizeInterval, pickDue, AUTO_MAX_KINS_PER_RUN } from '../screen/src/core/auto.js';
import { classifyFailure, KINDS } from '../screen/src/core/errors.js';
import { dropHalfChar } from '../screen/src/core/text.js';

const clip = (s, n = 480) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const KIN_END_LIMIT = 500;
// A run has a time limit (kin.json: 4 minutes). One question can take up to ~70 s, so a beat stops starting new
// questions when there is not room for another; whoever is left stays due and goes first on the next beat.
export const RUN_BUDGET_MS = 200_000;
export const ASK_BUDGET_MS = 75_000;
const RETRY_DELAY_MS = 2000;
// The screen gives up on an action after 150 s. A manual run that is already this late skips the journal (history and
// diagnostics), so the person still gets the reading in time.
export const MANUAL_JOURNAL_DEADLINE_MS = 110_000;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The line given back to the screen: the sentences as compact JSON, within the 500 characters `kin end` allows.
 * `at` is the time the run stored the reading under, so the screen can pick up the stored (never shortened) copy.
 * Hair and makeup are left out when nothing was said about them (the screen knows the default). If the line is too
 * long, the longest of outfit, hair and makeup is shortened at a word, with "…", until it fits, and `cut` says so.
 * Location and pose/action are cut only if nothing else is left to cut (see below).
 */
export function packReading({ location, doing, outfit, hair, makeup }, { at } = {}) {
  const o = {};
  if (at) o.at = at;
  Object.assign(o, { location, doing, outfit });
  if (hair && hair !== NO_HAIR) o.hair = hair;
  if (makeup && makeup !== NO_MAKEUP) o.makeup = makeup;
  const len = () => JSON.stringify(o).length;
  if (len() <= KIN_END_LIMIT) return JSON.stringify(o);
  o.cut = true;
  // Outfit, hair and makeup are shortened first. Location and pose/action are short by nature; only text full of
  // characters JSON must escape (quotes, backslashes, control codes) can make them too long, and only then are they cut.
  // Lengths are measured as JSON (escaped), which is what has to fit.
  const size = (k) => JSON.stringify(o[k]).length;
  for (const group of [['outfit', 'hair', 'makeup'], ['location', 'doing']]) {
    for (let guard = 0; len() > KIN_END_LIMIT && guard < 5000; guard += 1) {
      const open = group.filter((k) => typeof o[k] === 'string' && o[k].length > 2);
      if (!open.length) break;
      const k = open.reduce((x, y) => (size(y) > size(x) ? y : x));
      const was = o[k];
      const base = was.replace(/…$/, '');
      let t = base.slice(0, Math.max(1, base.length - Math.max(1, Math.ceil((len() - KIN_END_LIMIT) / Math.max(1, size(k) / was.length)))));
      if (t.length < base.length) t = t.replace(/[\s,]+\S*$/, '') || t; // end at a word
      t = `${dropHalfChar(t.replace(/[\s,.…]+$/, ''))}…`;
      o[k] = t.length < was.length ? t : `${dropHalfChar(was.slice(0, -2))}…`;
    }
  }
  return JSON.stringify(o);
}

/** What kind of failure an error was: its own label if it has one, otherwise guessed from its message. */
function failureOf(e) {
  if (e && e.kind) return { kind: e.kind, transient: e.transient !== false, retrySoon: !!e.retrySoon, message: e.message };
  return classifyFailure({ message: e?.message || String(e) });
}

/** One question to one Kin and its answer as three sentences. Never throws. */
async function readOnce({ kinId, name, provider }) {
  const prompt = buildOutfitPrompt({ name });
  if (prompt.length > KIN_ASK_LIMIT) return { ok: false, kind: KINDS.TOO_LONG, error: 'The question to the Kin is too long.' };
  let answer;
  try {
    answer = await provider.extract({ prompt, kinId });
  } catch (e) {
    const f = failureOf(e);
    return { ok: false, kind: f.kind, retrySoon: f.retrySoon, error: clip(f.message) };
  }
  const chars = String(answer ?? '').length;
  const parsed = parseReading(answer);
  if (!parsed.ok) return { ok: false, kind: KINDS.BAD_ANSWER, chars, error: clip(`${parsed.error} Nothing was changed. Try again.`) };
  return { ok: true, chars, sentences: describeReading(parsed) };
}

/**
 * Asks, and once more right away if the failure was a fast one worth retrying (a connection blip, a model that is
 * momentarily down or busy, a rate limit). Timeouts and bad answers are not retried here: they already took long, or
 * would give the same result. The pause is injectable so tests do not wait.
 */
async function readOne({ kinId, name, provider, retries = 0, sleep = defaultSleep, clock = () => new Date() }) {
  const t0 = clock().getTime();
  let r = await readOnce({ kinId, name, provider });
  let tries = 1;
  for (let attempt = 1; !r.ok && r.retrySoon && attempt <= retries; attempt += 1) {
    await sleep(RETRY_DELAY_MS * attempt);
    r = await readOnce({ kinId, name, provider });
    tries += 1;
  }
  return { ...r, tries, ms: clock().getTime() - t0 };
}

/** One line of the diagnostics log: what happened, how long it took, how big the answer was. No answer text. */
const logEntry = (r, { at, source, cut = false, unchanged = false }) => ({
  at, source, ok: !!r.ok, kind: r.ok ? null : (r.kind || KINDS.UNKNOWN), ms: r.ms, tries: r.tries, chars: r.chars ?? null, cut, unchanged, error: r.ok ? null : r.error,
});

/** Saving the latest reading is a convenience: if it fails, the reading itself still counts. */
async function remember(readings, kinId, value) {
  try { await readings.put(kinId, value); } catch { /* the screen can still show the answer it was given */ }
}

/**
 * The schedule beat: for each Kin the person ticked, ask again if it is due. Normally that is one interval after the
 * last attempt; after a failure it is sooner (a short backoff that doubles), because a blip should not cost an hour.
 */
async function runScheduled({ provider, storage, journalStorage, clock, sleep }) {
  const start = clock().getTime();
  let settings;
  try {
    settings = await new Settings(storage).load({ strict: true });
  } catch (e) {
    // Do not guess: unreadable settings are not "off" and not "on". Say so, and the next beat tries again.
    return { ok: false, message: clip(`Could not read the settings: ${e.message}`) };
  }
  if (!flag(settings.autoUpdate, false)) return { ok: true, message: 'Automatic updates are off.' };
  const interval = normalizeInterval(settings.autoIntervalMinutes);
  const kins = Array.isArray(settings.autoKins) ? settings.autoKins : [];
  if (!kins.length) return { ok: true, message: 'Automatic updates are on, but no Kin is ticked.' };

  const readings = new ReadingStore(storage);
  const known = {};
  const unreadable = [];
  for (const k of kins) {
    if (!k || typeof k.id !== 'string') continue;
    try { known[k.id] = await readings.get(k.id, { strict: true }); } catch { unreadable.push(k.id); }
  }
  // A Kin whose stored reading cannot be read is skipped: asking and saving would overwrite sentences that may be fine.
  const readable = kins.filter((k) => k && typeof k.id === 'string' && !unreadable.includes(k.id));
  const due = pickDue({ now: clock(), kins: readable, readings: known, intervalMinutes: interval, max: AUTO_MAX_KINS_PER_RUN, adaptive: flag(settings.autoAdaptive, true) });
  const journals = new JournalStore(journalStorage);
  if (!due.length) {
    return { ok: !unreadable.length, message: unreadable.length ? `Could not read the stored reading of ${unreadable.length} Kin(s); they were skipped.` : 'No Kin is due yet.' };
  }

  const done = [];
  let leftover = 0;
  for (const kin of due) {
    if (clock().getTime() - start > RUN_BUDGET_MS - ASK_BUDGET_MS) { leftover += 1; continue; } // no room for another question
    // Claim first: mark the attempt BEFORE the (slow) question, so a beat that starts while this one is still waiting
    // for the Kin sees it as attempted and skips it. If this run dies midway, the Kin is retried at the next due time.
    await remember(readings, kin.id, afterAttempt(known[kin.id], { now: clock(), source: 'auto', sentences: null, error: known[kin.id]?.error ?? null, claim: true }));
    const r = await readOne({ kinId: kin.id, name: kin.name, provider, retries: 0, sleep, clock });
    const next = afterAttempt(known[kin.id], { now: clock(), source: 'auto', sentences: r.sentences, error: r.error, kind: r.kind });
    await remember(readings, kin.id, next);
    if (clock().getTime() - start < RUN_BUDGET_MS) {
      const unchanged = r.ok && next.stableCount > 0;
      await journals.record(kin.id, { log: logEntry(r, { at: next.attemptedAt, source: 'auto', unchanged }), reading: r.ok && !unchanged ? next : null });
    }
    done.push({ name: kin.name, ok: r.ok, error: r.error });
  }
  const failed = done.filter((d) => !d.ok);
  const parts = [`Checked ${done.length}: ${done.map((d) => `${d.name} ${d.ok ? 'updated' : 'failed'}`).join(', ')}.`];
  if (failed[0]) parts.push(failed[0].error);
  if (leftover) parts.push(`${leftover} more next time.`);
  if (unreadable.length) parts.push(`${unreadable.length} skipped (stored reading unreadable).`);
  return { ok: done.length === 0 || failed.length < done.length, message: clip(parts.join(' ')) };
}

/**
 * Handles one run. `event` is the JSON the Workshop sends on stdin:
 *   {"trigger":"action","action":"read_outfit","input":{"kin":"<id>","name":"<name>"}}   (the Update status button)
 *   {"trigger":"schedule"}                                                              (every few minutes)
 * Returns { ok, message }. For the button, on success `message` is
 * {"at":"…","location":"…","doing":"…","outfit":"…","hair":"…","makeup":"…"} (see packReading).
 * `journalStorage` holds history and diagnostics; it may use shorter timeouts than `storage`.
 */
export async function handleRun({ event, provider, storage = new MemoryStorage(), journalStorage = storage, clock = () => new Date(), sleep = defaultSleep }) {
  if (event?.trigger === 'schedule') return runScheduled({ provider, storage, journalStorage, clock, sleep });
  if (event?.trigger !== 'action') return { ok: false, message: `Unsupported trigger: ${event?.trigger}` };
  if (event.action !== 'read_outfit') return { ok: false, message: `Unknown action: ${event.action}` };
  const input = event.input || {};
  const kinId = event.kin || input.kin;
  if (!kinId) return { ok: false, message: 'No Kin was given for this action.' };

  const start = clock().getTime();
  const journals = new JournalStore(journalStorage);
  const inTime = () => clock().getTime() - start < MANUAL_JOURNAL_DEADLINE_MS;
  // The person is waiting: one quick retry for a blip is worth it here.
  const r = await readOne({ kinId, name: input.name, provider, retries: 1, sleep, clock });
  if (!r.ok) {
    if (inTime()) await journals.record(kinId, { log: logEntry(r, { at: clock().toISOString(), source: 'manual' }) });
    return { ok: false, message: r.error };
  }
  // A manual reading is the newest reading: remember it, which also restarts the automatic interval.
  const stored = afterAttempt(null, { now: clock(), source: 'manual', sentences: r.sentences });
  await remember(new ReadingStore(storage), kinId, stored);
  const line = packReading(r.sentences, { at: stored.at });
  if (inTime()) await journals.record(kinId, { log: logEntry(r, { at: stored.at, source: 'manual', cut: line.includes('"cut":true') }), reading: stored });
  return { ok: true, message: line };
}

export { AUTO_MAX_KINS_PER_RUN };
