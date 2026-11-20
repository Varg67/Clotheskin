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
import { looksAsleep, sentenceMark, planSleep, parseSleepAnswer, parseDreamAnswer, describeDream, dreamFact } from '../src/core/sleep.js';
import { retryDelay, errorKind, isDue } from '../src/core/schedule.js';
import { normalizeSettings, normalizeStatus, normalizeEntry, plannedAt, SETTINGS_FILE, STATUS_FILE } from '../src/core/state.js';
import { describeNow } from '../src/core/time.js';
import { oneLine } from '../src/core/text.js';

/** The program's one action (used by the screen). One action, so one input rule: nothing can be checked against another's. */
export const ACTION = 'update_status';
export const OPS = ['read', 'wake'];
const RETRY_AFTER_MS = 3000; // a Kindroid hiccup (502/503) is tried once more, if the first try failed fast
const RETRY_IF_FASTER_MS = 30000;
const DREAM_TTL_HOURS = 24;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (message) => ({ ok: true, message: oneLine(message) });
const failed = (message) => ({ ok: false, message: oneLine(message) });

/**
 * One run. `event` is the JSON Kindroid sends on stdin: {"trigger":"schedule"} or
 * {"trigger":"action","action":"update_status","input":{"kin":"<id>","op":"read"|"wake"}}.
 * Returns { ok, message }: the caller ends the run with `kin end [--failed] message`.
 */
export async function runProgram({ event, kin, clock = () => new Date(), log = () => {}, retryAfterMs = RETRY_AFTER_MS }) {
  let settings; let status;
  try {
    settings = normalizeSettings(await kin.get(SETTINGS_FILE));
    status = normalizeStatus(await kin.get(STATUS_FILE));
  } catch (e) {
    return failed(`Could not read the app's files, so nothing was changed: ${e.message}`);
  }
  const ctx = { kin, clock, log, settings, retryAfterMs };

  if (event?.trigger === 'schedule') return scheduled(ctx, status);
  if (event?.trigger === 'action' && event.action === ACTION) return onAction(ctx, status, event);
  return failed(`Nothing to do for ${event?.trigger === 'action' ? `the action "${event.action}"` : `the trigger "${event?.trigger}"`}.`);
}

// ---------------------------------------------------------------- triggers

async function scheduled(ctx, status) {
  const { settings, clock } = ctx;
  if (settings.autoState === 'stopped') {
    // Stop forgets the sleep cycle and any slowing down; the last reading stays. Written once, then nothing to do.
    const stale = Object.entries(status.kins).filter(([, e]) => e.sleep || e.sleptOn || e.dream || e.retryAt || e.failures);
    for (const [id, e] of stale) await save(ctx, id, { ...e, sleep: null, sleptOn: null, dream: null, retryAt: null, failures: 0, serverFailures: 0, errorKind: null, error: null, note: null });
    return ok('Automatic update is stopped.');
  }
  if (settings.autoState === 'paused') return ok('Automatic update is paused.');
  if (!settings.kinId) return ok('No Kin is selected.');

  const entry = status.kins[settings.kinId] || normalizeEntry();
  const at = plannedAt(entry, settings);
  if (!isDue(at, clock())) return ok(`Nothing due before ${at}.`); // most starts end here, without asking anything

  const who = await attachedKin(ctx, settings.kinId);
  if (!who.ok) return who.result;
  return entry.sleep ? wake(ctx, who.kin, entry) : read(ctx, who.kin, entry);
}

async function onAction(ctx, status, event) {
  const input = event.input && typeof event.input === 'object' ? event.input : {};
  const id = typeof event.kin === 'string' && event.kin ? event.kin : (typeof input.kin === 'string' ? input.kin : '');
  if (!id) return failed('No Kin was given.');
  const op = OPS.includes(input.op) ? input.op : 'read';
  const who = await attachedKin(ctx, id);
  if (!who.ok) return who.result;
  const entry = status.kins[id] || normalizeEntry();
  // Wake now asks about the dream at once; Update status reads, and if the Kin turns out awake its night ends.
  return op === 'wake' && entry.sleep ? wake(ctx, who.kin, entry) : read(ctx, who.kin, entry);
}

/** The Kin, if it is attached to the program (a Kin that was detached is never asked anything). */
async function attachedKin(ctx, id) {
  let kins;
  try { kins = await ctx.kin.kins(); } catch (e) { return { ok: false, result: failed(`Could not list the Kins: ${e.message}`) }; }
  const kin = kins.find((k) => k.id === id);
  if (!kin) return { ok: false, result: ok('The selected Kin is not attached to Clotheskin any more.') };
  return { ok: true, kin };
}

// ---------------------------------------------------------------- steps

/** Reads where the Kin is, its pose and action and its outfit; then, if it is asleep, asks until when. */
async function read(ctx, who, entry) {
  const { settings, clock } = ctx;
  const now = clock();
  const e = { ...entry, name: who.name, lastRunAt: now.toISOString() };

  const answer = await ask(ctx, who, buildOutfitPrompt({ name: who.name }));
  if (!answer.ok) return fail(ctx, who, e, answer, now);
  const parsed = parseReading(answer.text);
  if (!parsed.ok) return fail(ctx, who, e, { kind: 'answer', error: `${parsed.error} Nothing was changed.`, length: answer.text.length }, now);
  const reading = describeReading(parsed);
  e.reading = { ...reading, at: now.toISOString() };
  e.serverFailures = 0; // Kindroid answered; the step succeeds once its follow-up question (if any) does too
  const line = `${who.name}: ${reading.location} ${reading.doing} ${reading.outfit}`;

  if (!looksAsleep(reading.doing)) {
    await save(ctx, who.id, succeeded({ ...e, sleep: null, sleptOn: null })); // awake: any night is over
    return ok(line);
  }
  if (e.sleep) { await save(ctx, who.id, succeeded(e)); return ok(`${line} Still asleep.`); } // read by hand during the night
  const mark = sentenceMark(reading.doing); // a fingerprint, never the sentence: nothing about the scene in the night's data
  if (e.sleptOn === mark) { await save(ctx, who.id, succeeded(e)); return ok(line); } // the chat has not moved since

  const s = await ask(ctx, who, buildFollowUpPrompt(SLEEP_PROMPT, { name: who.name, now: describeNow(now, settings.tz) }));
  if (!s.ok) return fail(ctx, who, e, s, now, `The sleep question could not be asked (${s.error}). It is asked again at the next update.`);
  const p = parseSleepAnswer(s.text);
  if (!p.ok) return fail(ctx, who, e, { kind: 'answer', error: p.error }, now, `The sleep question did not get a clear answer (${p.error}) It is asked again at the next update.`);
  const plan = p.sleeping ? planSleep(p.wakeAt, now, settings.tz) : null;
  await save(ctx, who.id, succeeded({ ...e, sleptOn: mark, sleep: plan ? { wakeAt: plan.wakeAt.toISOString(), until: plan.until.toISOString() } : null }));
  return ok(plan ? `${line} Asleep until ${p.wakeAt}.` : `${line} Not asleep after all.`);
}

/** The night is over: asks what the Kin dreamt, and (if the person wants) tells the Kin so it remembers it. */
async function wake(ctx, who, entry) {
  const { settings, clock, log } = ctx;
  const now = clock();
  const e = { ...entry, name: who.name, lastRunAt: now.toISOString() };
  const d = await ask(ctx, who, buildFollowUpPrompt(DREAM_PROMPT, { name: who.name, now: describeNow(now, settings.tz) }));
  if (!d.ok) return fail(ctx, who, e, d, now, `The dream question could not be asked (${d.error}). It is asked again at the next update.`); // the night goes on
  const p = parseDreamAnswer(d.text);
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
  } else log(`dream answer not usable: ${p.error}`); // a Kin that cannot answer is let go: awake, without a dream
  await save(ctx, who.id, succeeded({ ...e, sleep: null })); // sleptOn stays: the still chat does not start a new night
  return ok(p.ok ? `${who.name} woke up. ${describeDream(p)}${told}` : `${who.name} woke up (no usable dream answer).`);
}

// ---------------------------------------------------------------- helpers

/** Asks the Kin; a fast Kindroid failure (not maintenance) is tried once more. { ok, text } or { ok: false, kind, error }. */
async function ask(ctx, who, prompt) {
  if (prompt.length > KIN_ASK_LIMIT) return { ok: false, kind: 'input', error: 'The question to the Kin is too long.' };
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    try {
      const text = await ctx.kin.ask(prompt, { kin: who.id });
      ctx.log(`kin ask: ${text.length} characters in ${Date.now() - started} ms`);
      return { ok: true, text };
    } catch (e) {
      const kind = errorKind(e.message, 'server');
      ctx.log(`kin ask failed (${kind}, try ${attempt}): ${e.message}`);
      if (attempt >= 2 || kind === 'maintenance' || Date.now() - started > RETRY_IF_FASTER_MS) return { ok: false, kind, error: e.message };
      await sleepMs(ctx.retryAfterMs);
    }
  }
}

function succeeded(e) {
  return { ...e, failures: 0, serverFailures: 0, errorKind: null, error: null, note: null, retryAt: null };
}

/** Records a failure: errors in a row slow the next try down; only Kindroid errors count towards the server warning. */
async function fail(ctx, who, e, outcome, now, note = null) {
  const kind = errorKind(outcome.error, outcome.kind || 'server');
  if (kind === 'answer' && outcome.length !== undefined) ctx.log(`answer not usable (${outcome.length} characters): ${outcome.error}`);
  const failures = e.failures + 1;
  const next = {
    ...e,
    failures,
    serverFailures: kind === 'answer' ? 0 : e.serverFailures + 1,
    errorKind: kind,
    error: oneLine(outcome.error, 300),
    note,
    retryAt: new Date(now.getTime() + retryDelay(ctx.settings.intervalS, failures, kind) * 1000).toISOString(),
  };
  await save(ctx, who.id, next);
  return failed(note || next.error);
}

/** Writes one Kin's entry, on top of a fresh copy of status.json (another run may have written meanwhile). */
async function save(ctx, id, entry) {
  let fresh;
  try { fresh = normalizeStatus(await ctx.kin.get(STATUS_FILE)); } catch (e) { ctx.log(`status not saved, it could not be read: ${e.message}`); return; }
  fresh.kins[id] = normalizeEntry(entry);
  await ctx.kin.put(STATUS_FILE, JSON.stringify(fresh));
}
