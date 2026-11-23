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
import { buildOutfitPrompt, buildFollowUpPrompt, buildCorrectionPrompt, SLEEP_PROMPT, DREAM_PROMPT, KIN_ASK_LIMIT } from '../src/core/prompt.js';
import { parseReading, describeReading, updateWardrobe } from '../src/core/outfit.js';
import { looksAsleep, sleepCompatiblePosture, confirmedAwake, sentenceMark, planSleep, parseSleepAnswer, parseDreamAnswer, describeDream, dreamFact, DREAM_TTL_HOURS } from '../src/core/sleep.js';
import { errorKind, serviceProblem, isDue, ERROR } from '../src/core/schedule.js';
import {
  normalizeSettings, normalizeStatus, normalizeEntry, plannedAt, forgetOld, carryOver, lookFacts, lookSummary,
  succeeded, failedEntry, postponedEntry, mergeConcurrent, LOOK_TTL_HOURS, LOOK_RETRY_HOURS,
  SETTINGS_FILE, STATUS_FILE, ACTION, OPS, AUTO,
} from '../src/core/state.js';
import { NOT_DESCRIBED, APP_VERSION } from '../src/core/constants.js';
import { formatWhen } from '../src/core/format.js';
import { describeNow } from '../src/core/time.js';
import { oneLine, isPlainFact } from '../src/core/text.js';

const RETRY_AFTER_MS = 3000; // a fast Kindroid failure (a 502, a dropped connection) is tried once more
const ASK_TIMEOUT_MS = 90000; // one question to the Kin never waits longer than this
const RUN_BUDGET_MS = 100000; // the whole run fits well inside kin.json's 2 minutes (main.js stops it at 110 s)
const RESERVE_MS = 10000; // kept at the end of the budget for saving status.json and kin end
const MIN_ASK_MS = 15000; // a question with less time than this left waits for the next start
const TELL_TIMEOUT_MS = 15000; // telling the Kin its look waits no longer than this, and only with this much time left

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
 * @typedef {{ kin: KinApi, clock: () => Date, log: (line: string) => void, settings: Settings,
 *   retryAfterMs: number, deadline: number }} Ctx
 * @typedef {{ id: string, name: string }} Who
 * @typedef {{ ok: true, text: string } | { ok: false, kind: ErrorKind, error: string }} AskResult
 * @typedef {{ kind?: ErrorKind, error: string, length?: number }} Outcome  what went wrong in a step
 * @typedef {{ ok: boolean, message: string }} Result  what the run ends with (kin end [--failed] message)
 * @typedef {{ kind: 'look', fresh: Sentences } | { kind: 'dream', dream: import('../src/core/sleep.js').Dream }} SharedDetail
 * @typedef {{ ok: boolean, notice: keyof typeof NOTICES, nextAt?: string|null, detail?: SharedDetail }} Step
 * @typedef {{ location: string, doing: string, outfit: string, hair: string|null, makeup: string|null,
 *   endedAction?: string, excludedLocation?: string }} Sentences  of one answer
 * @typedef {{ clock?: () => Date, log?: (line: string) => void, retryAfterMs?: number, budgetMs?: number }} Options
 */
/** @import { Settings, Status, Entry } from '../src/core/state.js' */
/** @import { ErrorKind } from '../src/core/schedule.js' */
/** @import { Reading } from '../src/core/outfit.js' */

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
/** @returns {Result} */
const ok = (message) => ({ ok: true, message: oneLine(message) });
/** @returns {Result} */
const failed = (message) => ({ ok: false, message: oneLine(message) });

// Handlers can select a public notice, but cannot supply its text. Private details travel separately.
const NOTICES = Object.freeze({
  updated: 'Status updated.',
  deferred: 'Update deferred until the next start.',
  notDue: 'No update is due yet.',
  missingKin: 'No Kin was given.',
  detached: 'The selected Kin is not attached to Clotheskin any more.',
  listFailed: 'Could not list the Kins.',
  badAnswer: 'Clotheskin could not read the answer.',
  maintenance: 'Kindroid is under maintenance.',
  failed: 'Clotheskin could not complete the update.',
});
/** @param {keyof typeof NOTICES} notice @returns {Step} */
const stepNotice = (notice, success = true) => ({ ok: success, notice });

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
  const trigger = event && event.trigger;
  const known = trigger === 'schedule' || (trigger === 'action' && event.action === ACTION);
  if (!known) return failed(trigger === 'action' ? 'Unsupported Clotheskin action.' : 'Unsupported Clotheskin trigger.');
  const [settings, statusFile] = await Promise.all([
    readFile(kin, SETTINGS_FILE, normalizeSettings),
    readFile(kin, STATUS_FILE, normalizeStatus),
  ]);
  if (!settings.ok) return cannotRead(settings.error);
  if (!statusFile.ok) return cannotRead(statusFile.error);
  const ctx = context(kin, settings.value, options);
  const status = await eraseOld(ctx, statusFile.value);
  if (!status.ok) return failed(`Could not erase an old dream from the app's files: ${status.error}`);
  const idle = trigger === 'schedule' && idleReason(settings.value);
  if (idle) return ok(idle);
  const step = trigger === 'action' ? await onAction(ctx, status.value, event) : await scheduled(ctx, status.value);
  return outgoingResult(ctx, step);
}

/** A settings read failure at a disclosure boundary grants no permission. */
async function currentSharing(kin) {
  const settings = await readFile(kin, SETTINGS_FILE, normalizeSettings);
  return settings.ok ? settings.value : null;
}

/** Build the public contract after the last save, using only details from this operation.
 * @param {Ctx} ctx
 * @param {Step} step
 * @returns {Promise<Result>}
 */
async function outgoingResult(ctx, { ok: success, notice, detail, nextAt }) {
  if (notice === 'notDue' && nextAt) return ok(`Nothing to do yet: next update around ${formatWhen(nextAt, { timeZone: ctx.settings.tz, now: ctx.clock() })}.`);
  const message = NOTICES[notice] || NOTICES.failed;
  if (!success) return failed(message);
  if (!detail) return ok(message);
  const text = await authorizedDetail(ctx.kin, detail);
  return ok(text || message);
}

/** @param {KinApi} kin @param {SharedDetail} detail */
async function authorizedDetail(kin, detail) {
  const settings = await currentSharing(kin);
  if (detail.kind === 'look' && settings?.tellLook) return lookSummary(detail.fresh);
  if (detail.kind === 'dream' && settings?.tellDream && safeDream(detail.dream)) return describeDream(detail.dream);
  return '';
}

/**
 * Erases what status.json may no longer hold (a dream older than a day; the night, dream and slowing down from before
 * Stop), as the screen says (App Library review). Every start does this, even while stopped, so the run reads both
 * files at every start; it writes only when something was removed. Every step then starts from an entry that Stop has
 * already been applied to.
 * @param {Ctx} ctx
 * @param {Status} status
 * @returns {Promise<{ ok: true, value: Status } | { ok: false, error: string }>}
 */
async function eraseOld(ctx, status) {
  if (!forgetOld(status, ctx.settings, ctx.clock()).changed) return { ok: true, value: status };
  try {
    const fresh = forgetOld(normalizeStatus(await ctx.kin.get(STATUS_FILE)), ctx.settings, ctx.clock());
    if (fresh.changed) {
      await ctx.kin.put(STATUS_FILE, JSON.stringify({ ...fresh.status, runVersion: APP_VERSION }));
      ctx.log('old dream or night erased');
    }
    return { ok: true, value: fresh.status };
  } catch (e) {
    return { ok: false, error: serviceProblem(e) };
  }
}

/** Why the automatic update does nothing at all now (stopped, paused, no Kin), or null when it runs. */
function idleReason(settings) {
  if (settings.autoState === AUTO.STOPPED) return 'Automatic update is stopped.';
  if (settings.autoState === AUTO.PAUSED) return 'Automatic update is paused.';
  if (!settings.kinId) return 'No Kin is selected.';
  return null;
}

/** @returns {Result} */
const cannotRead = (error) => failed(`Could not read the app's files, so nothing was changed: ${error}`);

/**
 * What every step gets: the kin functions, the clock, the log, the settings and the run's deadline (from now).
 * @param {KinApi} kin
 * @param {Settings} settings
 * @param {Options} options
 * @returns {Ctx}
 */
function context(kin, settings, { clock = () => new Date(), log = () => {}, retryAfterMs = RETRY_AFTER_MS, budgetMs = RUN_BUDGET_MS }) {
  return { kin, clock, log, settings, retryAfterMs, deadline: Date.now() + budgetMs };
}

/**
 * One of the program's files, normalised; { ok: false, error } when it exists but could not be read (never thrown:
 * the two reads of an action go at once).
 * @template T
 * @param {KinApi} kin
 * @param {string} path
 * @param {(raw: string|null) => T} normalize
 * @returns {Promise<{ ok: true, value: T } | { ok: false, error: string }>}
 */
async function readFile(kin, path, normalize) {
  try {
    return { ok: true, value: normalize(await kin.get(path)) };
  } catch (e) {
    return { ok: false, error: serviceProblem(e) };
  }
}

// ---------------------------------------------------------------- triggers

/**
 * The 15-minute start, while the automatic update runs for a Kin: does what is due (a reading, or the dream question).
 * @param {Ctx} ctx
 * @param {Status} status
 * @returns {Promise<Step>}
 */
async function scheduled(ctx, status) {
  const { settings, clock } = ctx;
  if (!settings.kinId) return stepNotice('missingKin', false); // idleReason said so already; this tells the types
  const entry = status.kins[settings.kinId] || normalizeEntry();
  const at = plannedAt(entry, settings);
  if (!isDue(at, clock())) return { ...stepNotice('notDue'), nextAt: entry.sleep ? null : at };

  const who = await attachedKin(ctx, settings.kinId, entry);
  if (!who.ok) return who.result;
  return entry.sleep ? wake(ctx, who.kin, entry) : read(ctx, who.kin, entry);
}

async function onAction(ctx, status, event) {
  const input = event.input && typeof event.input === 'object' ? event.input : {};
  const id = typeof event.kin === 'string' && event.kin ? event.kin : (typeof input.kin === 'string' ? input.kin : '');
  if (!id) return stepNotice('missingKin', false);
  const op = OPS.includes(input.op) ? input.op : 'read';
  const entry = status.kins[id] || normalizeEntry();
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
 * @returns {Promise<{ ok: true, kin: Who } | { ok: false, result: Step }>}
 */
async function attachedKin(ctx, id, entry) {
  let kins;
  try { kins = await ctx.kin.kins(); } catch (e) {
    const who = { id, name: entry.name || id };
    const now = ctx.clock();
    const outcome = { kind: ERROR.SERVER, error: `Could not list the Kins: ${serviceProblem(e)}` };
    await fail(ctx, { who, entry: { ...entry, lastRunAt: now.toISOString() }, outcome, now, base: entry });
    return { ok: false, result: stepNotice('listFailed', false) };
  }
  const kin = kins.find((k) => k.id === id);
  if (!kin) return { ok: false, result: stepNotice('detached', false) };
  return { ok: true, kin };
}

// ---------------------------------------------------------------- steps

/** Reads the card and checks the night. @returns {Promise<Step>} */
async function read(ctx, who, entry) {
  const now = ctx.clock();
  const updated = { ...entry, name: who.name, lastRunAt: now.toISOString() };
  const answer = await readAnswer(ctx, { who, entry: updated, base: entry, now });
  if (!answer.ok) return answer.result;
  const { fresh } = answer;
  // What the answer said nothing about keeps the last known sentence (real test: "No outfit described" lost it).
  const withReading = { ...updated, reading: carryOver(fresh, entry.reading, now), serverFailures: 0 }; // Kindroid answered
  const look = await tellLook(ctx, { who, entry: withReading, fresh, now });
  const result = await afterReading(ctx, { who, entry: { ...withReading, ...look }, base: entry, now,
    doing: fresh.doing, endedAction: fresh.endedAction });
  return { ...result, detail: { kind: 'look', fresh } };
}

/**
 * Asks the reading question and reads the answer: { ok: true, fresh } (the card's sentences of this answer alone; hair
 * and makeup only when the Kin described them), or { ok: false, result } once the failure or the wait is saved.
 * @returns {Promise<{ ok: true, fresh: Sentences } | { ok: false, result: Step }>}
 */
async function readAnswer(ctx, { who, entry, base, now }) {
  const { reply, parsed } = await askAndParse(ctx, who, buildOutfitPrompt({ name: who.name }), (text) => parseReading(text, who.name));
  if (!reply.ok && reply.kind === ERROR.TIME) {
    return { ok: false, result: await postpone(ctx, { who, entry, now, base, note: 'The reading waits for the next start of the app.' }) };
  }
  if (!reply.ok) return { ok: false, result: await fail(ctx, { who, entry, outcome: reply, now, base }) };
  if (!parsed || !parsed.ok) {
    const outcome = { kind: ERROR.ANSWER, error: `${parsed ? parsed.error : ''} Nothing was changed.`, length: reply.text.length };
    return { ok: false, result: await fail(ctx, { who, entry, outcome, now, base }) };
  }
  const fresh = { ...describeReading(parsed), ...updateWardrobe(parsed.outfit, entry.reading) };
  return { ok: true, fresh: { ...fresh, endedAction: parsed.endedAction, excludedLocation: parsed.excludedLocation,
    hair: parsed.hair ? fresh.hair : null, makeup: parsed.makeup ? fresh.makeup : null } };
}

/**
 * After a reading: awake ends any night; a new "asleep" sentence starts the sleep question. Sleep is read from what
 * the Kin said just now (`doing`), never from a pose kept from an earlier reading; an answer that says nothing about
 * the pose or action is not a sign of being awake: the night, if any, and its mark stay as they are.
 */
async function afterReading(ctx, { who, entry, base, now, doing, endedAction }) {
  if (looksAsleep(endedAction) && !looksAsleep(doing)) {
    await save(ctx, who.id, succeeded({ ...entry, sleep: null, sleptOn: null }), base);
    return stepNotice('updated');
  }
  if (doing === NOT_DESCRIBED.doing) { await save(ctx, who.id, succeeded(entry), base); return stepNotice('updated'); }
  if (entry.sleep && sleepCompatiblePosture(doing)) {
    await save(ctx, who.id, succeeded(entry), base);
    return stepNotice('updated');
  }
  if (!looksAsleep(doing)) {
    await save(ctx, who.id, succeeded({ ...entry, sleep: null, sleptOn: null }), base); // awake: any night is over
    return stepNotice('updated');
  }
  if (entry.sleep) { await save(ctx, who.id, succeeded(entry), base); return stepNotice('updated'); } // read by hand during the night
  const mark = sentenceMark(doing); // a fingerprint, never the sentence: nothing about the scene in the night's data
  if (entry.sleptOn === mark) {
    // A repeated claim cannot undo a newer explicit denial. A previously confirmed night keeps its own mark.
    if (base.reading?.doing === confirmedAwake(doing)) entry = retractSleep(entry);
    await save(ctx, who.id, succeeded(entry), base);
    return stepNotice('updated');
  }
  // The reading is kept before the sleep question: if the run is cut short, it is not lost.
  await save(ctx, who.id, entry, base);
  return askSleep(ctx, { who, entry, now, mark });
}

/** Keep any independently described posture when the Kin denies sleeping. */
function retractSleep(entry) {
  return { ...entry, reading: { ...entry.reading, doing: confirmedAwake(entry.reading.doing) } };
}

/** Asks whether the Kin is asleep and until when; a believable wake-up time starts the night. */
async function askSleep(ctx, { who, entry, now, mark }) {
  const prompt = buildFollowUpPrompt(SLEEP_PROMPT, { name: who.name, now: describeNow(now, ctx.settings.tz) });
  const { reply, parsed: answer } = await askAndParse(ctx, who, prompt, parseSleepAnswer);
  if (!reply.ok && reply.kind === ERROR.TIME) {
    const note = 'The sleep question waits for the next start of the app.';
    return postpone(ctx, { who, entry: succeeded(entry), now, base: entry, note });
  }
  if (!reply.ok) {
    const note = `The sleep question could not be asked (${reply.error}). It is asked again at the next update.`;
    return fail(ctx, { who, entry, outcome: reply, now, note, base: entry });
  }
  if (!answer || !answer.ok) {
    const error = answer ? answer.error : 'The answer is not valid JSON.';
    const note = `The sleep question did not get a clear answer (${error}) It is asked again at the next update.`;
    return fail(ctx, { who, entry, outcome: { kind: ERROR.ANSWER, error }, now, note, base: entry });
  }
  const plan = answer.sleeping ? planSleep(answer.wakeAt, now, ctx.settings.tz) : null;
  const sleep = plan ? { wakeAt: plan.wakeAt.toISOString(), until: plan.until.toISOString() } : null;
  const beforeConfirmation = entry;
  if (!answer.sleeping) entry = retractSleep(entry);
  await save(ctx, who.id, succeeded({ ...entry, sleptOn: mark, sleep }), beforeConfirmation);
  return stepNotice('updated');
}

/** The night is over: asks what the Kin dreamt and optionally shares it. @returns {Promise<Step>} */
async function wake(ctx, who, entry) {
  const now = ctx.clock();
  const updated = { ...entry, name: who.name, lastRunAt: now.toISOString() };
  const prompt = buildFollowUpPrompt(DREAM_PROMPT, { name: who.name, now: describeNow(now, ctx.settings.tz) });
  const { reply, parsed: dream } = await askAndParse(ctx, who, prompt, parseDreamAnswer);
  // the night goes on in both cases below
  if (!reply.ok && reply.kind === ERROR.TIME) return postpone(ctx, { who, entry: updated, now, base: entry, note: 'The dream question waits for the next start of the app.' });
  if (!reply.ok) {
    const note = `The dream question could not be asked (${reply.error}). It is asked again at the next update.`;
    return fail(ctx, { who, entry: updated, outcome: reply, now, note, base: entry });
  }
  if (!dream || !dream.ok) {
    ctx.log('the dream answer was not usable'); // a Kin that cannot answer is let go: awake, without a dream
    await save(ctx, who.id, succeeded({ ...updated, sleep: null }), entry);
    return stepNotice('updated');
  }
  updated.dream = { dream: dream.dream, remembered: dream.remembered, at: now.toISOString() };
  await tellDream(ctx, who, dream);
  await save(ctx, who.id, succeeded({ ...updated, sleep: null }), entry); // sleptOn stays: the still chat does not start a new night
  return { ...stepNotice('updated'), detail: { kind: 'dream', dream } };
}

// A null dream is a valid answer. Structured data inside a dream string stays on the card.
const safeDream = (dream) => dream.dream === null || isPlainFact(dream.dream);

/** Check both dream permissions immediately before the memory note. */
async function tellDream(ctx, who, dream) {
  if (!safeDream(dream)) return;
  const fact = dreamFact(dream);
  if (!fact) return;
  const settings = await currentSharing(ctx.kin);
  if (!settings?.tellDream) return;
  try {
    await ctx.kin.tell(fact, { kin: who.id, key: 'dream', ttl: DREAM_TTL_HOURS, reachOut: settings.reachOut });
  } catch (err) {
    ctx.log(`kin tell (dream) failed: ${serviceProblem(err)}`);
  }
}

/**
 * Tells the Kin what it is wearing now (settings.tellLook), so it stays consistent in the roleplay: one fact per field
 * (look-outfit, look-hair, look-makeup), each replacing the last and lasting LOOK_TTL_HOURS. Only what changed, only
 * from what the Kin said just now (lookFacts). A failure or a lack of time is not an error: the reading is kept, and
 * what was not told is told at the next reading. Returns the changes to the local delivery record.
 */
async function tellLook(ctx, { who, entry, fresh, now }) {
  // A failure waits an hour: a Kindroid that refuses the note is not asked three times every 15 minutes.
  if (entry.lookFailedAt && now.getTime() - Date.parse(entry.lookFailedAt) < LOOK_RETRY_HOURS * 3600e3) return {};
  const told = { ...(entry.told || {}) };
  for (const f of lookFacts({ fresh, told: entry.told, now, when: describeNow(now, ctx.settings.tz) })) {
    if (ctx.deadline - Date.now() < RESERVE_MS + TELL_TIMEOUT_MS) { ctx.log('not enough time left to tell the look: at the next reading'); break; }
    if (!(await currentSharing(ctx.kin))?.tellLook) return { told };
    try {
      await ctx.kin.tell(f.fact, { kin: who.id, key: f.key, ttl: LOOK_TTL_HOURS, timeoutMs: TELL_TIMEOUT_MS });
      told[f.field] = { mark: f.mark, at: now.toISOString() };
    } catch (err) {
      ctx.log(`kin tell (${f.key}) failed: ${serviceProblem(err)}`);
      return { told, lookFailedAt: now.toISOString(), lookError: serviceProblem(err) }; // the rest waits too
    }
  }
  return { told, lookFailedAt: null, lookError: null };
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
      const error = serviceProblem(e);
      const kind = errorKind(error, ERROR.SERVER);
      ctx.log(`kin ask failed (${kind}, try ${attempt}, ${Date.now() - started} ms)`);
      if (!canRetry(ctx, attempt, kind)) return { ok: false, kind, error };
      await sleepMs(ctx.retryAfterMs);
    }
  }
}

/**
 * Records a failure: errors in a row slow the next try down; only Kindroid errors count towards the server warning.
 * `entry` is what this run would save, `base` the entry it started from (see save), `note` the words for the person.
 */
/**
 * Asks, then reads the answer with `parse`. An answer that cannot be read (roleplay, narration, another language) is
 * asked once more in the same run, after a short out-of-character correction, if there is time; a roleplay model
 * often gets it right the second time (real test, Nov 2026). Returns { reply, parsed }: parsed is undefined only when
 * the question could not be asked at all (reply.ok false).
 * @template P
 * @param {Ctx} ctx
 * @param {Who} who
 * @param {string} prompt
 * @param {(text: string) => P} parse
 * @returns {Promise<{ reply: AskResult, parsed?: P }>}
 */
async function askAndParse(ctx, who, prompt, parse) {
  const first = await ask(ctx, who, prompt);
  if (!first.ok) return { reply: first };
  const parsed = parse(first.text);
  if (/** @type {any} */ (parsed).ok) return { reply: first, parsed };
  ctx.log(`answer not usable (${first.text.length} characters): asking once more, with a correction`);
  const again = await ask(ctx, who, buildCorrectionPrompt(prompt));
  if (!again.ok) return { reply: first, parsed }; // no time or Kindroid failed: the first answer's error stands
  return { reply: again, parsed: parse(again.text) };
}

/** One more try: only after the first, never during maintenance, and only if a question still fits after the pause. */
function canRetry(ctx, attempt, kind) {
  const leftAfterPause = ctx.deadline - Date.now() - RESERVE_MS - ctx.retryAfterMs;
  return attempt < 2 && kind !== ERROR.MAINTENANCE && leftAfterPause >= MIN_ASK_MS;
}

/**
 * @param {Ctx} ctx
 * @param {{ who: Who, entry: Entry, outcome: Outcome, now: Date, note?: string|null, base?: Entry|null }} failure
 * @returns {Promise<Step>}
 */
async function fail(ctx, { who, entry, outcome, now, note = null, base }) {
  if (outcome.kind === ERROR.ANSWER && outcome.length !== undefined) ctx.log(`answer not usable (${outcome.length} characters)`);
  const next = failedEntry(entry, { kind: outcome.kind, error: outcome.error, note, now, intervalS: ctx.settings.intervalS });
  await save(ctx, who.id, next, base);
  if (next.errorKind === ERROR.ANSWER) return stepNotice('badAnswer', false);
  return stepNotice(next.errorKind === ERROR.MAINTENANCE ? 'maintenance' : 'failed', false);
}

/**
 * The run's own time ran out before a question could be asked: nothing failed (no error is counted, nothing slows
 * down), the step is tried again at the next start of the program.
 */
/**
 * @param {Ctx} ctx
 * @param {{ who: Who, entry: Entry, now: Date, note: string, base?: Entry|null }} later
 * @returns {Promise<Step>}
 */
async function postpone(ctx, { who, entry, now, note, base }) {
  await save(ctx, who.id, postponedEntry(entry, { now, note }), base);
  return stepNotice('deferred');
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
  try { fresh = normalizeStatus(await ctx.kin.get(STATUS_FILE)); } catch (e) { throw new Error(`status.json could not be read before saving, so nothing was saved: ${serviceProblem(e)}`); }
  const current = fresh.kins[id];
  const merged = mergeConcurrent({ current, start: base && normalizeEntry(base), next: normalizeEntry(entry) });
  if (merged.concurrent) ctx.log(`another run saved this Kin meanwhile: ${merged.theirs ? 'its' : 'this'} night is kept`);
  fresh.kins[id] = merged.entry;
  fresh.diagnosticsVersion = 1;
  fresh.runVersion = APP_VERSION; // the screen notices a run from another update
  try { await ctx.kin.put(STATUS_FILE, JSON.stringify(fresh)); } catch (e) { throw new Error(`status.json could not be saved: ${serviceProblem(e)}`); }
}
