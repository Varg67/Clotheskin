// What one run of the program does. Kindroid starts it every 15 minutes (schedule trigger) and when the screen asks
// (the action update_status). It never spawns anything and imports nothing from Node: the `kin` functions, the clock
// and the log are given to it, so the same code runs inside Kindroid (main.js + run/kin.js) and in the dev harness.
//
//   reading ──(pose and action say "asleep")──> sleep question ──(asleep, wakes at 07:30)──> night
//      ^                                              │ (not asleep)                            │ (from 07:20)
//      └──────────────────────────────────────────────┴────────── dream question <──────────────┘
//
// Files (src/core/state.js): settings.json is the screen's, status.json is the run's. The run reads both, changes
// only its Kin's entry, re-reads status.json just before writing, and never writes over a file it could not read.
import { buildOutfitPrompt, buildFollowUpPrompt, SLEEP_PROMPT, DREAM_PROMPT, KIN_ASK_LIMIT } from '../src/core/prompt.js';
import { parseReading, describeReading } from '../src/core/outfit.js';
import { looksAsleep, sentenceMark, planSleep, parseSleepAnswer, parseDreamAnswer, describeDream, dreamFact, DREAM_TTL_HOURS } from '../src/core/sleep.js';
import { errorKind, isDue, ERROR } from '../src/core/schedule.js';
import { normalizeSettings, normalizeStatus, normalizeEntry, plannedAt, afterStop, readingText, succeeded, failedEntry, postponedEntry, mergeConcurrent,
  SETTINGS_FILE, STATUS_FILE, ACTION, OPS, AUTO } from '../src/core/state.js';
import { describeNow } from '../src/core/time.js';
import { oneLine, errorMessage } from '../src/core/text.js';

const RETRY_AFTER_MS = 3000; // a fast Kindroid failure (a 502, a dropped connection) is tried once more
const ASK_TIMEOUT_MS = 90000; // one question to the Kin never waits longer than this
const RUN_BUDGET_MS = 100000; // the whole run fits well inside kin.json's 2 minutes (main.js stops it at 110 s)
const RESERVE_MS = 10000; // kept at the end of the budget for saving status.json and kin end
const MIN_ASK_MS = 15000; // a question with less time than this left waits for the next start

/**
 * The `kin` command as functions: run/kin.js inside Kindroid, a stand-in in the dev harness and the tests.
 * @typedef {object} KinApi
 * @property {(prompt: string, options: { kin?: string, timeoutMs?: number }) => Promise<string>} ask
 * @property {(fact: string, options: { kin?: string, key?: string, ttl?: number, reachOut?: boolean }) => Promise<void>} tell
 * @property {(path: string) => Promise<string|null>} get a file of the program's folder, or null when there is none yet
 * @property {(path: string, text: string) => Promise<void>} put
 * @property {() => Promise<Who[]>} kins the Kins attached to the program
 *
 * What every step gets: the kin functions, the clock, the log, the settings and the run's deadline (ms).
 * @typedef {{ kin: KinApi, clock: () => Date, log: (line: string) => void, settings: Settings, retryAfterMs: number, deadline: number }} Ctx
 * @typedef {{ id: string, name: string }} Who
 * @typedef {{ ok: true, text: string } | { ok: false, kind: ErrorKind, error: string }} AskResult
 * @typedef {{ kind?: ErrorKind, error: string, length?: number }} Outcome  what went wrong in a step
 * @typedef {{ ok: boolean, message: string }} Result  what the run ends with (kin end [--failed] message)
 */
/** @import { Settings, Status, Entry } from '../src/core/state.js' */
/** @import { ErrorKind } from '../src/core/schedule.js' */
/** @import { Reading } from '../src/core/outfit.js' */

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
/** @returns {Result} */
const ok = (message) => ({ ok: true, message: oneLine(message) });
/** @returns {Result} */
const failed = (message) => ({ ok: false, message: oneLine(message) });

/**
 * One run. `event` is the JSON Kindroid sends on stdin: {"trigger":"schedule"} or
 * {"trigger":"action","action":"update_status","input":{"kin":"<id>","op":"read"|"wake"}}.
 * Returns { ok, message }: the caller ends the run with `kin end [--failed] message`. Throws only when status.json
 * could not be saved (the caller then ends with --failed).
 */
/**
 * @param {{ event: any, kin: KinApi, clock?: () => Date, log?: (line: string) => void, retryAfterMs?: number, budgetMs?: number }} run
 * @returns {Promise<Result>}
 */
export async function runProgram({ event, kin, ...options }) {
  const files = await readFiles(kin);
  if (!files.ok) return failed(`Could not read the app's files, so nothing was changed: ${files.error}`);
  return dispatch(context(kin, files.settings, options), files.status, event);
}

/**
 * What every step gets: the kin functions, the clock, the log, the settings and the run's deadline (from now).
 * @param {KinApi} kin
 * @param {Settings} settings
 * @param {{ clock?: () => Date, log?: (line: string) => void, retryAfterMs?: number, budgetMs?: number }} options
 * @returns {Ctx}
 */
function context(kin, settings, { clock = () => new Date(), log = () => {}, retryAfterMs = RETRY_AFTER_MS, budgetMs = RUN_BUDGET_MS }) {
  return { kin, clock, log, settings, retryAfterMs, deadline: Date.now() + budgetMs };
}

/**
 * The trigger to its step: the 15-minute start, or the screen's action.
 * @param {Ctx} ctx
 * @param {Status} status
 * @param {any} event
 * @returns {Promise<Result>|Result}
 */
function dispatch(ctx, status, event) {
  const trigger = event && event.trigger;
  if (trigger === 'schedule') return scheduled(ctx, status);
  if (trigger === 'action' && event.action === ACTION) return onAction(ctx, status, event);
  return failed(`Nothing to do for ${trigger === 'action' ? `the action "${event.action}"` : `the trigger "${trigger}"`}.`);
}

/** settings.json and status.json, normalised; { ok: false, error } when either could not be read. */
/**
 * @param {KinApi} kin
 * @returns {Promise<{ ok: true, settings: Settings, status: Status } | { ok: false, error: string }>}
 */
async function readFiles(kin) {
  try {
    const settings = normalizeSettings(await kin.get(SETTINGS_FILE));
    const status = normalizeStatus(await kin.get(STATUS_FILE));
    return { ok: true, settings, status };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ---------------------------------------------------------------- triggers

async function scheduled(ctx, status) {
  const { settings, clock } = ctx;
  if (settings.autoState === AUTO.STOPPED) return ok('Automatic update is stopped.');
  if (settings.autoState === AUTO.PAUSED) return ok('Automatic update is paused.');
  if (!settings.kinId) return ok('No Kin is selected.');

  const entry = afterStop(status.kins[settings.kinId] || normalizeEntry(), settings); // Stop forgot the night before it
  const at = plannedAt(entry, settings);
  if (!isDue(at, clock())) return ok(`Nothing due before ${at}.`); // most starts end here, without asking anything

  const who = await attachedKin(ctx, settings.kinId, entry);
  if (!who.ok) return who.result;
  return entry.sleep ? wake(ctx, who.kin, entry) : read(ctx, who.kin, entry);
}

async function onAction(ctx, status, event) {
  const input = event.input && typeof event.input === 'object' ? event.input : {};
  const id = typeof event.kin === 'string' && event.kin ? event.kin : (typeof input.kin === 'string' ? input.kin : '');
  if (!id) return failed('No Kin was given.');
  const op = OPS.includes(input.op) ? input.op : 'read';
  const entry = afterStop(status.kins[id] || normalizeEntry(), ctx.settings);
  const who = await attachedKin(ctx, id, entry);
  if (!who.ok) return who.result;
  // Wake now asks about the dream at once; Update status reads, and if the Kin turns out awake its night ends.
  return op === 'wake' && entry.sleep ? wake(ctx, who.kin, entry) : read(ctx, who.kin, entry);
}

/**
 * The Kin, if it is attached to the program (a Kin that was detached is never asked anything). When Kindroid cannot
 * list the Kins, that is a Kindroid error like any other: counted, slowed down, and shown on the screen.
 * @param {Ctx} ctx
 * @param {string} id
 * @param {Entry} entry
 * @returns {Promise<{ ok: true, kin: Who } | { ok: false, result: Result }>}
 */
async function attachedKin(ctx, id, entry) {
  let kins;
  try { kins = await ctx.kin.kins(); } catch (e) {
    const who = { id, name: entry.name || id };
    const now = ctx.clock();
    const outcome = { kind: ERROR.SERVER, error: `Could not list the Kins: ${errorMessage(e)}` };
    return { ok: false, result: await fail(ctx, { who, entry: { ...entry, lastRunAt: now.toISOString() }, outcome, now, base: entry }) };
  }
  const kin = kins.find((k) => k.id === id);
  if (!kin) return { ok: false, result: failed('The selected Kin is not attached to Clotheskin any more.') };
  return { ok: true, kin };
}

// ---------------------------------------------------------------- steps

/** Reads where the Kin is, its pose and action and its outfit; then, if it is asleep, asks until when. */
async function read(ctx, who, entry) {
  const now = ctx.clock();
  const updated = { ...entry, name: who.name, lastRunAt: now.toISOString() };
  const reply = await ask(ctx, who, buildOutfitPrompt({ name: who.name }));
  if (!reply.ok && reply.kind === ERROR.TIME) return postpone(ctx, { who, entry: updated, now, base: entry, note: 'The reading waits for the next start of the app.' });
  if (!reply.ok) return fail(ctx, { who, entry: updated, outcome: reply, now, base: entry });
  const parsed = parseReading(reply.text);
  if (!parsed.ok) {
    const outcome = { kind: ERROR.ANSWER, error: `${parsed.error} Nothing was changed.`, length: reply.text.length };
    return fail(ctx, { who, entry: updated, outcome, now, base: entry });
  }
  const withReading = { ...updated, reading: storedReading(parsed, now), serverFailures: 0 }; // Kindroid answered
  return afterReading(ctx, { who, entry: withReading, base: entry, now, line: `${who.name}: ${readingText(withReading.reading)}` });
}

/**
 * The card's sentences as stored: hair and makeup only when the Kin described them (the card shows those rows only then).
 * @param {Reading} parsed
 * @param {Date} now
 */
function storedReading(parsed, now) {
  const reading = describeReading(parsed);
  return { ...reading, hair: parsed.hair ? reading.hair : null, makeup: parsed.makeup ? reading.makeup : null, at: now.toISOString() };
}

/** After a reading: awake ends any night; a new "asleep" sentence starts the sleep question. */
async function afterReading(ctx, { who, entry, base, now, line }) {
  if (!looksAsleep(entry.reading.doing)) {
    await save(ctx, who.id, succeeded({ ...entry, sleep: null, sleptOn: null }), base); // awake: any night is over
    return ok(line);
  }
  if (entry.sleep) { await save(ctx, who.id, succeeded(entry), base); return ok(`${line} Still asleep.`); } // read by hand during the night
  const mark = sentenceMark(entry.reading.doing); // a fingerprint, never the sentence: nothing about the scene in the night's data
  if (entry.sleptOn === mark) { await save(ctx, who.id, succeeded(entry), base); return ok(line); } // the chat has not moved since
  // The reading is kept before the sleep question: if the run is cut short, it is not lost.
  await save(ctx, who.id, entry, base);
  return askSleep(ctx, { who, entry, now, mark, line });
}

/** Asks whether the Kin is asleep and until when; a believable wake-up time starts the night. */
async function askSleep(ctx, { who, entry, now, mark, line }) {
  const reply = await ask(ctx, who, buildFollowUpPrompt(SLEEP_PROMPT, { name: who.name, now: describeNow(now, ctx.settings.tz) }));
  if (!reply.ok && reply.kind === ERROR.TIME) {
    const note = 'The sleep question waits for the next start of the app.';
    return postpone(ctx, { who, entry: succeeded(entry), now, base: entry, note, message: `${line} The sleep question waits for the next start.` });
  }
  if (!reply.ok) {
    const note = `The sleep question could not be asked (${reply.error}). It is asked again at the next update.`;
    return fail(ctx, { who, entry, outcome: reply, now, note, base: entry });
  }
  const answer = parseSleepAnswer(reply.text);
  if (!answer.ok) {
    const note = `The sleep question did not get a clear answer (${answer.error}) It is asked again at the next update.`;
    return fail(ctx, { who, entry, outcome: { kind: ERROR.ANSWER, error: answer.error }, now, note, base: entry });
  }
  const plan = answer.sleeping ? planSleep(answer.wakeAt, now, ctx.settings.tz) : null;
  const sleep = plan ? { wakeAt: plan.wakeAt.toISOString(), until: plan.until.toISOString() } : null;
  await save(ctx, who.id, succeeded({ ...entry, sleptOn: mark, sleep }), entry);
  if (plan) return ok(`${line} Asleep until ${answer.wakeAt}.`);
  return ok(answer.sleeping ? `${line} Asleep, but the wake-up time ${answer.wakeAt} is too soon or too far away to wait for; readings go on.` : `${line} Not asleep after all.`);
}

/** The night is over: asks what the Kin dreamt, and (if the person wants) tells the Kin so it remembers it. */
async function wake(ctx, who, entry) {
  const { settings, clock, log } = ctx;
  const now = clock();
  const updated = { ...entry, name: who.name, lastRunAt: now.toISOString() };
  const reply = await ask(ctx, who, buildFollowUpPrompt(DREAM_PROMPT, { name: who.name, now: describeNow(now, settings.tz) }));
  // the night goes on in both cases below
  if (!reply.ok && reply.kind === ERROR.TIME) return postpone(ctx, { who, entry: updated, now, base: entry, note: 'The dream question waits for the next start of the app.' });
  if (!reply.ok) {
    const note = `The dream question could not be asked (${reply.error}). It is asked again at the next update.`;
    return fail(ctx, { who, entry: updated, outcome: reply, now, note, base: entry });
  }
  const dream = parseDreamAnswer(reply.text);
  let told = '';
  if (dream.ok) {
    updated.dream = { dream: dream.dream, remembered: dream.remembered, at: now.toISOString() };
    const fact = settings.tellDream ? dreamFact(dream) : null;
    if (fact) {
      try {
        await ctx.kin.tell(fact, { kin: who.id, key: 'dream', ttl: DREAM_TTL_HOURS, reachOut: settings.reachOut });
        told = ` ${who.name} was told, to remember it today.`;
      } catch (err) { log(`kin tell (dream) failed: ${errorMessage(err)}`); }
    }
  } else log('the dream answer was not usable'); // a Kin that cannot answer is let go: awake, without a dream
  await save(ctx, who.id, succeeded({ ...updated, sleep: null }), entry); // sleptOn stays: the still chat does not start a new night
  return ok(dream.ok ? `${who.name} woke up. ${describeDream(dream)}${told}` : `${who.name} woke up (no usable dream answer).`);
}

// ---------------------------------------------------------------- helpers

/**
 * Asks the Kin within the run's time budget; a fast Kindroid failure (not maintenance) is tried once more if there is
 * time. { ok, text } or { ok: false, kind, error } with kind server | maintenance | input | time (no time left).
 */
/**
 * @param {Ctx} ctx
 * @param {Who} who
 * @param {string} prompt
 * @returns {Promise<AskResult>}
 */
async function ask(ctx, who, prompt) {
  if (prompt.length > KIN_ASK_LIMIT) return { ok: false, kind: ERROR.INPUT, error: 'The question to the Kin is too long.' };
  for (let attempt = 1; ; attempt += 1) {
    const left = ctx.deadline - Date.now() - RESERVE_MS;
    if (left < MIN_ASK_MS) return { ok: false, kind: ERROR.TIME, error: 'Not enough time left in this run.' };
    const started = Date.now();
    try {
      const text = await ctx.kin.ask(prompt, { kin: who.id, timeoutMs: Math.min(ASK_TIMEOUT_MS, left) });
      ctx.log(`kin ask: ${text.length} characters in ${Date.now() - started} ms`);
      return { ok: true, text };
    } catch (e) {
      const kind = errorKind(errorMessage(e), ERROR.SERVER);
      ctx.log(`kin ask failed (${kind}, try ${attempt}, ${Date.now() - started} ms)`);
      if (attempt >= 2 || kind === ERROR.MAINTENANCE || ctx.deadline - Date.now() - RESERVE_MS - ctx.retryAfterMs < MIN_ASK_MS) return { ok: false, kind, error: errorMessage(e) };
      await sleepMs(ctx.retryAfterMs);
    }
  }
}

/**
 * Records a failure: errors in a row slow the next try down; only Kindroid errors count towards the server warning.
 * `entry` is what this run would save, `base` the entry it started from (see save), `note` the words for the person.
 */
/**
 * @param {Ctx} ctx
 * @param {{ who: Who, entry: Entry, outcome: Outcome, now: Date, note?: string|null, base?: Entry|null }} failure
 * @returns {Promise<Result>}
 */
async function fail(ctx, { who, entry, outcome, now, note = null, base }) {
  if (outcome.kind === ERROR.ANSWER && outcome.length !== undefined) ctx.log(`answer not usable (${outcome.length} characters)`);
  const next = failedEntry(entry, { kind: outcome.kind, error: outcome.error, note, now, intervalS: ctx.settings.intervalS });
  await save(ctx, who.id, next, base);
  return failed(note || next.error);
}

/**
 * The run's own time ran out before a question could be asked: nothing failed (no error is counted, nothing slows
 * down), the step is tried again at the next start of the program.
 */
/**
 * @param {Ctx} ctx
 * @param {{ who: Who, entry: Entry, now: Date, note: string, base?: Entry|null, message?: string }} later
 * @returns {Promise<Result>}
 */
async function postpone(ctx, { who, entry, now, note, base, message = note }) {
  await save(ctx, who.id, postponedEntry(entry, { now, note }), base);
  return ok(message);
}

/**
 * Writes one Kin's entry on top of a fresh copy of status.json. `base` is the entry this run started from: if another
 * run saved this Kin meanwhile, mergeConcurrent (state.js) decides what is kept. A failed save throws: the run then
 * ends with --failed instead of claiming a result that was not kept.
 */
/**
 * @param {Ctx} ctx
 * @param {string} id
 * @param {Entry} entry
 * @param {Entry|null} [base]
 */
async function save(ctx, id, entry, base) {
  let fresh;
  try { fresh = normalizeStatus(await ctx.kin.get(STATUS_FILE)); } catch (e) { throw new Error(`status.json could not be read before saving, so nothing was saved: ${errorMessage(e)}`); }
  const current = fresh.kins[id];
  const merged = mergeConcurrent({ current, start: base && normalizeEntry(base), next: normalizeEntry(entry) });
  if (merged.concurrent) ctx.log(`another run saved this Kin meanwhile: ${merged.theirs ? 'its' : 'this'} night is kept`);
  fresh.kins[id] = merged.entry;
  try { await ctx.kin.put(STATUS_FILE, JSON.stringify(fresh)); } catch (e) { throw new Error(`status.json could not be saved: ${errorMessage(e)}`); }
}
