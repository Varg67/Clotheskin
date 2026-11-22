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
import { parseReading, describeReading } from '../src/core/outfit.js';
import { looksAsleep, sentenceMark, planSleep, parseSleepAnswer, parseDreamAnswer, describeDream, dreamFact, DREAM_TTL_HOURS } from '../src/core/sleep.js';
import { retryDelay, errorKind, isDue, TICK_S } from '../src/core/schedule.js';
import { normalizeSettings, normalizeStatus, normalizeEntry, plannedAt, forgetOld, carryOver, SETTINGS_FILE, STATUS_FILE, ACTION, OPS } from '../src/core/state.js';
import { NOT_DESCRIBED, APP_VERSION } from '../src/core/constants.js';
import { describeNow } from '../src/core/time.js';
import { formatWhen } from '../src/core/format.js';
import { oneLine } from '../src/core/text.js';

export { ACTION, OPS }; // the program's one action (src/core/state.js): one input rule, nothing checked against another's
const RETRY_AFTER_MS = 3000; // a fast Kindroid failure (a 502, a dropped connection) is tried once more
const ASK_TIMEOUT_MS = 90000; // one question to the Kin never waits longer than this
const RUN_BUDGET_MS = 100000; // the whole run fits well inside kin.json's 2 minutes (main.js stops it at 110 s)
const RESERVE_MS = 10000; // kept at the end of the budget for saving status.json and kin end
const MIN_ASK_MS = 15000; // a question with less time than this left waits for the next start

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (message) => ({ ok: true, message: oneLine(message) });
const failed = (message) => ({ ok: false, message: oneLine(message) });

/**
 * One run. `event` is the JSON Kindroid sends on stdin: {"trigger":"schedule"} or
 * {"trigger":"action","action":"update_status","input":{"kin":"<id>","op":"read"|"wake"}}.
 * Returns { ok, message }: the caller ends the run with `kin end [--failed] message`. Throws only when status.json
 * could not be saved (the caller then ends with --failed).
 */
export async function runProgram({ event, kin, clock = () => new Date(), log = () => {}, retryAfterMs = RETRY_AFTER_MS, budgetMs = RUN_BUDGET_MS }) {
  let settings; let status;
  try {
    settings = normalizeSettings(await kin.get(SETTINGS_FILE));
    status = normalizeStatus(await kin.get(STATUS_FILE));
  } catch (e) {
    return failed(`Could not read the app's files, so nothing was changed: ${e.message}`);
  }
  const ctx = { kin, clock, log, settings, retryAfterMs, deadline: Date.now() + budgetMs };
  // Erase what may no longer be kept (a dream older than a day; the night, dream and slowing down from before Stop).
  // Every start does this, even while stopped, so the file holds no more than the screen says, and every step below
  // starts from an entry that Stop has already been applied to.
  if (forgetOld(status, settings, clock()).changed) {
    try {
      const fresh = forgetOld(normalizeStatus(await kin.get(STATUS_FILE)), settings, clock());
      if (fresh.changed) { await kin.put(STATUS_FILE, JSON.stringify({ ...fresh.status, runVersion: APP_VERSION })); log('old dream or night erased'); }
      status = fresh.status;
    } catch (e) {
      return failed(`Could not erase an old dream from the app's files: ${e.message}`);
    }
  }

  if (event?.trigger === 'schedule') return scheduled(ctx, status);
  if (event?.trigger === 'action' && event.action === ACTION) return onAction(ctx, status, event);
  return failed(`Nothing to do for ${event?.trigger === 'action' ? `the action "${event.action}"` : `the trigger "${event?.trigger}"`}.`);
}

// ---------------------------------------------------------------- triggers

async function scheduled(ctx, status) {
  const { settings, clock } = ctx;
  if (settings.autoState === 'stopped') return ok('Automatic update is stopped.');
  if (settings.autoState === 'paused') return ok('Automatic update is paused.');
  if (!settings.kinId) return ok('No Kin is selected.');

  const entry = status.kins[settings.kinId] || normalizeEntry();
  const at = plannedAt(entry, settings);
  // most starts end here, without asking anything; the line shows in Kindroid's log, so it is on the person's clock
  if (!isDue(at, clock())) return ok(`Nothing to do yet: next update around ${formatWhen(at, { timeZone: settings.tz, now: clock() })}.`);

  const who = await attachedKin(ctx, settings.kinId, entry);
  if (!who.ok) return who.result;
  return entry.sleep ? wake(ctx, who.kin, entry) : read(ctx, who.kin, entry);
}

async function onAction(ctx, status, event) {
  const input = event.input && typeof event.input === 'object' ? event.input : {};
  const id = typeof event.kin === 'string' && event.kin ? event.kin : (typeof input.kin === 'string' ? input.kin : '');
  if (!id) return failed('No Kin was given.');
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
 */
async function attachedKin(ctx, id, entry) {
  let kins;
  try { kins = await ctx.kin.kins(); } catch (e) {
    const who = { id, name: entry.name || id };
    return { ok: false, result: await fail(ctx, who, { ...entry, lastRunAt: ctx.clock().toISOString() }, { kind: 'server', error: `Could not list the Kins: ${e.message}` }, ctx.clock(), entry) };
  }
  const kin = kins.find((k) => k.id === id);
  if (!kin) return { ok: false, result: failed('The selected Kin is not attached to Clotheskin any more.') };
  return { ok: true, kin };
}

// ---------------------------------------------------------------- steps

/** Reads where the Kin is, its pose and action and its outfit; then, if it is asleep, asks until when. */
async function read(ctx, who, entry) {
  const { settings, clock } = ctx;
  const now = clock();
  const e = { ...entry, name: who.name, lastRunAt: now.toISOString() };

  const { answer, parsed } = await askAndParse(ctx, who, buildOutfitPrompt({ name: who.name }), parseReading);
  if (!answer.ok) return fail(ctx, who, e, answer, now, null, entry);
  if (!parsed.ok) return fail(ctx, who, e, { kind: 'answer', error: `${parsed.error} Nothing was changed.`, length: answer.text.length }, now, null, entry);
  const fresh = describeReading(parsed);
  // Hair and makeup only when the Kin described them (the card shows those rows only then).
  if (!parsed.hair) fresh.hair = null;
  if (!parsed.makeup) fresh.makeup = null;
  // What the answer said nothing about keeps the last known sentence (real test: "No outfit described" lost it).
  const reading = carryOver(fresh, entry.reading, now);
  e.reading = reading;
  e.serverFailures = 0; // Kindroid answered
  const line = `${who.name}: ${[reading.location, reading.doing, reading.outfit, reading.hair, reading.makeup].filter(Boolean).join(' ')}`;

  // Sleep is read from what the Kin said just now, never from a pose kept from an earlier reading. An answer that says
  // nothing about the pose or action is not a sign of being awake: the night, if any, and its mark stay as they are.
  if (fresh.doing === NOT_DESCRIBED.doing) { await save(ctx, who.id, succeeded(e), entry); return ok(line); }
  if (!looksAsleep(fresh.doing)) {
    await save(ctx, who.id, succeeded({ ...e, sleep: null, sleptOn: null }), entry); // awake: any night is over
    return ok(line);
  }
  if (e.sleep) { await save(ctx, who.id, succeeded(e), entry); return ok(`${line} Still asleep.`); } // read by hand during the night
  const mark = sentenceMark(fresh.doing); // a fingerprint, never the sentence: nothing about the scene in the night's data
  if (e.sleptOn === mark) { await save(ctx, who.id, succeeded(e), entry); return ok(line); } // the chat has not moved since

  // The reading is kept before the sleep question: if the run is cut short, it is not lost.
  await save(ctx, who.id, e, entry);
  const { answer: s, parsed: sleepAnswer } = await askAndParse(ctx, who, buildFollowUpPrompt(SLEEP_PROMPT, { name: who.name, now: describeNow(now, settings.tz) }), parseSleepAnswer);
  if (!s.ok && s.kind === 'time') {
    const later = { ...succeeded(e), retryAt: new Date(now.getTime() + TICK_S * 1000).toISOString(), note: 'The sleep question waits for the next start of the app.' };
    await save(ctx, who.id, later, e);
    return ok(`${line} The sleep question waits for the next start.`);
  }
  if (!s.ok) return fail(ctx, who, e, s, now, `The sleep question could not be asked (${s.error}). It is asked again at the next update.`, e);
  const p = sleepAnswer;
  if (!p.ok) return fail(ctx, who, e, { kind: 'answer', error: p.error }, now, `The sleep question did not get a clear answer (${p.error}) It is asked again at the next update.`, e);
  const plan = p.sleeping ? planSleep(p.wakeAt, now, settings.tz) : null;
  await save(ctx, who.id, succeeded({ ...e, sleptOn: mark, sleep: plan ? { wakeAt: plan.wakeAt.toISOString(), until: plan.until.toISOString() } : null }), e);
  if (plan) return ok(`${line} Asleep until ${p.wakeAt}.`);
  return ok(p.sleeping ? `${line} Asleep, but the wake-up time ${p.wakeAt} is too soon or too far away to wait for; readings go on.` : `${line} Not asleep after all.`);
}

/** The night is over: asks what the Kin dreamt, and (if the person wants) tells the Kin so it remembers it. */
async function wake(ctx, who, entry) {
  const { settings, clock, log } = ctx;
  const now = clock();
  const e = { ...entry, name: who.name, lastRunAt: now.toISOString() };
  const { answer: d, parsed: dreamAnswer } = await askAndParse(ctx, who, buildFollowUpPrompt(DREAM_PROMPT, { name: who.name, now: describeNow(now, settings.tz) }), parseDreamAnswer);
  if (!d.ok) return fail(ctx, who, e, d, now, `The dream question could not be asked (${d.error}). It is asked again at the next update.`, entry); // the night goes on
  const p = dreamAnswer;
  let told = '';
  if (p.ok) {
    e.dream = { dream: p.dream, remembered: p.remembered, at: now.toISOString() };
    const fact = settings.tellDream ? dreamFact(p) : null;
    if (fact) {
      try {
        await ctx.kin.tell(fact, { kin: who.id, key: 'dream', ttl: DREAM_TTL_HOURS, reachOut: settings.reachOut });
        told = ` ${who.name} was told, to remember it today.`;
      } catch (err) { log(`kin tell (dream) failed: ${err.message}`); }
    }
  } else log('the dream answer was not usable'); // a Kin that cannot answer is let go: awake, without a dream
  await save(ctx, who.id, succeeded({ ...e, sleep: null }), entry); // sleptOn stays: the still chat does not start a new night
  return ok(p.ok ? `${who.name} woke up. ${describeDream(p)}${told}` : `${who.name} woke up (no usable dream answer).`);
}

// ---------------------------------------------------------------- helpers

/**
 * Asks the Kin within the run's time budget; a fast Kindroid failure (not maintenance) is tried once more if there is
 * time. { ok, text } or { ok: false, kind, error } with kind server | maintenance | input | time (no time left).
 */
async function ask(ctx, who, prompt) {
  if (prompt.length > KIN_ASK_LIMIT) return { ok: false, kind: 'input', error: 'The question to the Kin is too long.' };
  for (let attempt = 1; ; attempt += 1) {
    const left = ctx.deadline - Date.now() - RESERVE_MS;
    if (left < MIN_ASK_MS) return { ok: false, kind: 'time', error: 'Not enough time left in this run.' };
    const started = Date.now();
    try {
      const text = await ctx.kin.ask(prompt, { kin: who.id, timeoutMs: Math.min(ASK_TIMEOUT_MS, left) });
      ctx.log(`kin ask: ${text.length} characters in ${Date.now() - started} ms`);
      return { ok: true, text };
    } catch (e) {
      const kind = errorKind(e.message, 'server');
      ctx.log(`kin ask failed (${kind}, try ${attempt}, ${Date.now() - started} ms)`);
      if (attempt >= 2 || kind === 'maintenance' || ctx.deadline - Date.now() - RESERVE_MS - ctx.retryAfterMs < MIN_ASK_MS) return { ok: false, kind, error: e.message };
      await sleepMs(ctx.retryAfterMs);
    }
  }
}

/**
 * Asks, then reads the answer with `parse`. An answer that cannot be read (roleplay, narration, another language) is
 * asked once more in the same run, after a short out-of-character correction, if there is time; a roleplay model
 * often gets it right the second time (real test, Nov 2026). Returns { answer, parsed }: parsed is undefined only
 * when the question could not be asked at all (answer.ok false).
 */
async function askAndParse(ctx, who, prompt, parse) {
  const first = await ask(ctx, who, prompt);
  if (!first.ok) return { answer: first };
  const parsed = parse(first.text);
  if (parsed.ok) return { answer: first, parsed };
  ctx.log(`answer not usable (${first.text.length} characters): asking once more, with a correction`);
  const again = await ask(ctx, who, buildCorrectionPrompt(prompt));
  if (!again.ok) return { answer: first, parsed }; // no time or Kindroid failed: the first answer's error stands
  return { answer: again, parsed: parse(again.text) };
}

function succeeded(e) {
  return { ...e, failures: 0, serverFailures: 0, errorKind: null, error: null, note: null, retryAt: null };
}

/** Records a failure: errors in a row slow the next try down; only Kindroid errors count towards the server warning. */
async function fail(ctx, who, e, outcome, now, note, base) {
  const kind = errorKind(outcome.error, outcome.kind || 'server');
  if (kind === 'answer' && outcome.length !== undefined) ctx.log(`answer not usable (${outcome.length} characters)`);
  const failures = e.failures + 1;
  const next = {
    ...e,
    failures,
    serverFailures: kind === 'answer' ? 0 : e.serverFailures + 1,
    errorKind: kind,
    error: oneLine(outcome.error, 300),
    note: note || null,
    retryAt: new Date(now.getTime() + retryDelay(ctx.settings.intervalS, failures, kind) * 1000).toISOString(),
  };
  await save(ctx, who.id, next, base);
  return failed(note || next.error);
}

/**
 * Writes one Kin's entry on top of a fresh copy of status.json. `base` is the entry this run started from: if another
 * run saved this Kin meanwhile (a scheduled start and Update status at the same moment), the night goes to the run
 * that changed it, and the newest reading and dream are kept. A failed save throws: the run
 * then ends with --failed instead of claiming a result that was not kept.
 */
async function save(ctx, id, entry, base) {
  let fresh;
  try { fresh = normalizeStatus(await ctx.kin.get(STATUS_FILE)); } catch (e) { throw new Error(`status.json could not be read before saving, so nothing was saved: ${e.message}`); }
  const current = fresh.kins[id];
  let next = normalizeEntry(entry);
  const start = base && normalizeEntry(base);
  if (current && start && current.lastRunAt !== start.lastRunAt) {
    // Another run saved this Kin meanwhile. The night goes to the run that changed it (asked the dream question,
    // started a night); if both did, to the one that started later. The newest reading and dream are kept either way.
    const nightOf = (x) => JSON.stringify([x.sleep, x.sleptOn]);
    const theirs = nightOf(current) !== nightOf(start);
    const ours = nightOf(next) !== nightOf(start);
    const takeTheirs = theirs && (!ours || (current.lastRunAt || '') >= (next.lastRunAt || ''));
    if (takeTheirs) next = { ...next, sleep: current.sleep, sleptOn: current.sleptOn };
    const newer = (a, b) => (!a ? b : !b ? a : (a.at || '') >= (b.at || '') ? a : b);
    next = { ...next, dream: newer(next.dream, current.dream), reading: newer(next.reading, current.reading) };
    ctx.log(`another run saved this Kin meanwhile: ${takeTheirs ? 'its' : 'this'} night is kept`);
  }

  fresh.kins[id] = next;
  fresh.runVersion = APP_VERSION;
  try { await ctx.kin.put(STATUS_FILE, JSON.stringify(fresh)); } catch (e) { throw new Error(`status.json could not be saved: ${e.message}`); }
}
