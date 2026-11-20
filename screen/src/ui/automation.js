// The automatic readings of the selected Kin (Workshop only). No DOM here: the screen gives the pieces it needs.
//
//   reading ──(pose and action say "asleep")──> sleep question ──(asleep, wakes at 07:30)──> hibernation
//      ^                                              │ (not asleep)                             │ (07:20)
//      └──────────────────────────────────────────────┴──────────── dream question <────────────┘
//
// Errors in a row slow the readings down (retryDelay); maintenance or repeated server errors raise a warning.
// Start, Pause and Stop (settings.autoState): Pause keeps everything and goes on from there; Stop forgets the sleep
// cycle. The state and the hibernation (settings.sleep) are saved, so closing and reopening the screen keeps them.
import { retryDelay, errorKind, looksAsleep, planSleep, describeNow, snapInterval, sentenceMark, ERRORS_BEFORE_WARNING } from '../core/auto.js';

const HEARTBEAT_MS = 30000; // timers are re-armed in short steps, so a computer waking from sleep catches up

export function createAutomation({
  settings, clock = () => new Date(), selectedKin, read, ask, lastReadingAt = () => null, onChange = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
}) {
  const state = {
    nextAt: null, // Date of the next step
    busy: false,
    failures: 0, // errors in a row, of any kind: they slow the readings down
    serverFailures: 0, // Kindroid errors in a row (a Kin answer, even a wrong one, shows Kindroid is up): they raise the warning
    errorKind: null, // kind of the last error: server | maintenance | answer
    dreams: new Map(), // kin id -> { dream, remembered, at } (memory only)
    kinId: null, // the Kin the schedule was made for
    note: null, // a follow-up question that went wrong, for the panel: "The Kin did not answer the sleep question clearly…"
  };
  let timer = null;
  // Start, Pause, Stop and a Kin switch start a new generation: a step still in flight from an older one saves
  // nothing, shows nothing and plans nothing (its Kin may not be on screen any more, or the person said stop).
  let generation = 0;

  const interval = () => snapInterval(settings.value.autoIntervalS);
  const runState = () => (['running', 'paused'].includes(settings.value.autoState) ? settings.value.autoState : 'stopped');
  const running = () => runState() === 'running';
  const sleepOf = (id) => settings.value.sleep?.[id] || null;
  function saveSleep(id, entry) {
    const all = { ...(settings.value.sleep || {}) };
    if (entry && (entry.until || entry.sleptOn)) all[id] = entry; else delete all[id];
    return settings.save({ sleep: all });
  }

  /** Whether the Kin is hibernating now: { wakeAt, until } (Dates) or null. */
  function hibernation(id) {
    const s = sleepOf(id);
    return s?.until ? { wakeAt: new Date(s.wakeAt), until: new Date(s.until) } : null;
  }

  function arm(at) {
    if (timer) clearTimer(timer);
    timer = null;
    state.nextAt = running() ? at : null;
    if (!state.nextAt) return;
    const ms = Math.max(0, Math.min(at - clock(), HEARTBEAT_MS));
    timer = setTimer(() => { timer = null; if (clock() >= state.nextAt) step(); else arm(state.nextAt); }, ms);
  }
  const inSeconds = (s) => new Date(clock().getTime() + s * 1000);

  /** Plans the next step from scratch (interval changed, Kin changed, Start/Pause/Stop, screen opened). Errors are forgotten. */
  function reschedule() {
    generation += 1;
    const kin = selectedKin();
    state.failures = 0; state.serverFailures = 0; state.errorKind = null; state.note = null;
    state.kinId = kin?.id ?? null;
    if (!kin || !running()) { arm(null); onChange(); return; }
    if (state.busy) { onChange(); return; } // the step in flight sees the new generation and plans again when it ends
    const h = hibernation(kin.id);
    if (h) { arm(h.until); onChange(); return; }
    const last = lastReadingAt(kin.id);
    const due = last ? new Date(new Date(last).getTime() + interval() * 1000) : clock();
    arm(due > clock() ? due : clock());
    onChange();
  }

  function failed(outcome) {
    state.failures += 1;
    // the Kin's own words are not a Kindroid notice: only Kindroid errors are checked for "maintenance"
    state.errorKind = outcome.kind === 'answer' ? 'answer' : errorKind(outcome.error, outcome.kind || 'server');
    state.serverFailures = state.errorKind === 'answer' ? 0 : state.serverFailures + 1;
    arm(inSeconds(retryDelay(interval(), state.failures, state.errorKind)));
  }
  function succeeded() { state.failures = 0; state.serverFailures = 0; state.errorKind = null; state.note = null; }

  /** One step: read, or ask about sleep or the dream. `live()` is false once a newer generation has started. */
  async function run(kin, live) {
    const h = hibernation(kin.id);
    if (h) {
      if (clock() < h.until) { arm(h.until); return; }
      const r = await ask(kin, 'ask_dream', { now: describeNow(clock()) });
      if (!live()) return;
      if (!r.ok && r.kind !== 'answer') { state.note = `The dream question could not be asked (${r.error}). It is asked again at the next update.`; failed(r); return; }
      succeeded();
      if (r.ok) state.dreams.set(kin.id, { dream: r.value.dream ?? null, remembered: r.value.remembered, at: clock().toISOString() });
      await saveSleep(kin.id, { sleptOn: sleepOf(kin.id)?.sleptOn }); // awake: hibernation over, the old sentence still ignored
      arm(inSeconds(interval()));
      return;
    }
    const r = await read(kin);
    if (!live()) return;
    if (!r.ok) { failed(r); return; }
    state.serverFailures = 0; // Kindroid answered; the step only counts as a success once its follow-up question did too
    const slept = sleepOf(kin.id)?.sleptOn;
    const mark = sentenceMark(r.doing);
    if (!looksAsleep(r.doing)) {
      succeeded();
      if (slept) await saveSleep(kin.id, null); // the chat moved on
      arm(inSeconds(interval()));
      return;
    }
    if (slept === mark) { succeeded(); arm(inSeconds(interval())); return; } // same sentence as last night: the chat has not moved
    const now = clock();
    const a = await ask(kin, 'ask_sleep', { now: describeNow(now) });
    if (!live()) return;
    if (!a.ok) { state.note = `The sleep question did not get a clear answer (${a.error}). It is asked again at the next update.`; failed(a); return; }
    succeeded();
    const plan = a.value.sleeping ? planSleep(a.value.wake_at, now) : null;
    await saveSleep(kin.id, plan ? { wakeAt: plan.wakeAt.toISOString(), until: plan.until.toISOString(), sleptOn: mark } : { sleptOn: mark });
    arm(plan ? plan.until : inSeconds(interval()));
  }

  async function step() {
    const kin = selectedKin();
    if (!kin || !running() || state.busy) return;
    if (kin.id !== state.kinId) { reschedule(); return; }
    const mine = generation;
    const live = () => mine === generation && running() && selectedKin()?.id === kin.id;
    state.busy = true; onChange();
    try {
      await run(kin, live);
    } finally {
      state.busy = false;
      if (mine !== generation) reschedule(); // Start/Pause/Stop or a Kin switch happened meanwhile: plan for now
      else onChange();
    }
  }

  function setRunState(next) {
    if (runState() === next) return false;
    if (next === 'stopped') state.dreams.clear();
    settings.save(next === 'stopped' ? { autoState: next, sleep: {} } : { autoState: next });
    reschedule();
    return true;
  }

  return {
    state,
    reschedule,
    hibernation,
    interval,
    runState,
    running,
    /**
     * Start (or Resume after Pause): reads at once if a reading is due, otherwise when it is. Like Pause and Stop it
     * acts at once; the save goes on in the background. Returns false when nothing changed (already running).
     */
    start() { return setRunState('running'); },
    /** Pause: nothing is asked until Resume; the hibernation and the wake-up time are kept. */
    pause() { return setRunState('paused'); },
    /** Stop: nothing is asked, and the sleep cycle (hibernation, wake-up times, dreams) is forgotten. */
    stop() { return setRunState('stopped'); },
    /** A new interval from the ruler. While Kindroid is failing, the slowed-down next try is kept. */
    setInterval(seconds) {
      settings.save({ autoIntervalS: snapInterval(seconds) });
      if (state.failures && state.nextAt) { onChange(); return; }
      reschedule();
    },
    /** The person read the Kin by hand during its hibernation and it is awake: the night is over (no dream question). */
    endSleep(id) {
      const s = sleepOf(id);
      if (!s?.until) return;
      saveSleep(id, null);
      reschedule();
    },
    /** Forgets the hibernation of Kins that are no longer attached. */
    prune(ids) {
      const all = settings.value.sleep || {};
      const keep = Object.fromEntries(Object.entries(all).filter(([id]) => ids.includes(id)));
      if (Object.keys(keep).length !== Object.keys(all).length) settings.save({ sleep: keep });
    },
    /** Runs a step now (Update status with automation on, Try now). */
    runNow() { arm(clock()); },
    /** Ends the hibernation early: the dream question is asked now. */
    wakeNow() {
      const kin = selectedKin();
      const s = kin && sleepOf(kin.id);
      if (!s?.until) return Promise.resolve();
      return saveSleep(kin.id, { ...s, until: clock().toISOString() }).then(() => this.runNow());
    },
    /** A warning about Kindroid itself, or null. */
    warning() {
      if (!running()) return null;
      if (state.errorKind === 'maintenance') return { kind: 'maintenance', nextAt: state.nextAt };
      if (state.errorKind === 'server' && state.serverFailures >= ERRORS_BEFORE_WARNING) return { kind: 'server', failures: state.serverFailures, nextAt: state.nextAt };
      return null;
    },
  };
}
