// The automatic readings of the selected Kin (Workshop only). No DOM here: the screen gives the pieces it needs.
//
//   reading ──(pose and action say "asleep")──> sleep question ──(asleep, wakes at 07:30)──> hibernation
//      ^                                              │ (not asleep)                             │ (07:20)
//      └──────────────────────────────────────────────┴──────────── dream question <────────────┘
//
// Errors in a row slow the readings down (retryDelay); maintenance or repeated server errors raise a warning.
// Only the hibernation is saved (settings.sleep), so closing and reopening the screen keeps it.
import { retryDelay, errorKind, looksAsleep, planSleep, describeNow, snapInterval, ERRORS_BEFORE_WARNING } from '../core/auto.js';

const HEARTBEAT_MS = 30000; // timers are re-armed in short steps, so a computer waking from sleep catches up

export function createAutomation({
  settings, clock = () => new Date(), selectedKin, read, ask, lastReadingAt = () => null, onChange = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
}) {
  const state = {
    nextAt: null, // Date of the next step
    busy: false,
    failures: 0,
    errorKind: null, // kind of the last error: server | maintenance | answer
    dreams: new Map(), // kin id -> { dream, remembered, at } (memory only)
    kinId: null, // the Kin the schedule was made for
  };
  let timer = null;

  const interval = () => snapInterval(settings.value.autoIntervalS);
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
    state.nextAt = at;
    if (!at) return;
    const ms = Math.max(0, Math.min(at - clock(), HEARTBEAT_MS));
    timer = setTimer(() => { timer = null; if (clock() >= state.nextAt) step(); else arm(state.nextAt); }, ms);
  }
  const inSeconds = (s) => new Date(clock().getTime() + s * 1000);

  /** Plans the next step from scratch (interval changed, Kin changed, screen opened). Errors are forgotten. */
  function reschedule() {
    const kin = selectedKin();
    state.failures = 0; state.errorKind = null;
    state.kinId = kin?.id ?? null;
    if (!kin || !interval()) { arm(null); onChange(); return; }
    const h = hibernation(kin.id);
    if (h) { arm(h.until); onChange(); return; }
    const last = lastReadingAt(kin.id);
    const due = last ? new Date(new Date(last).getTime() + interval() * 1000) : clock();
    arm(due > clock() ? due : clock());
    onChange();
  }

  function failed(outcome) {
    state.failures += 1;
    state.errorKind = errorKind(outcome.error, outcome.kind || 'server');
    arm(inSeconds(retryDelay(interval(), state.failures, state.errorKind)));
  }
  function succeeded() { state.failures = 0; state.errorKind = null; }

  async function askSleep(kin, doing) {
    const now = clock();
    const r = await ask(kin, 'ask_sleep', { now: describeNow(now) });
    if (!r.ok) { failed(r); return; }
    succeeded();
    const plan = r.value.sleeping ? planSleep(r.value.wake_at, now) : null;
    // sleptOn: the same "asleep" sentence will not bring the question back (the chat stays still all night)
    await saveSleep(kin.id, plan ? { wakeAt: plan.wakeAt.toISOString(), until: plan.until.toISOString(), sleptOn: doing } : { sleptOn: doing });
    arm(plan ? plan.until : inSeconds(interval()));
  }

  async function wake(kin) {
    const r = await ask(kin, 'ask_dream', { now: describeNow(clock()) });
    if (!r.ok && r.kind !== 'answer') { failed(r); return; } // Kindroid did not answer: ask again later
    succeeded();
    if (r.ok) state.dreams.set(kin.id, { dream: r.value.dream ?? null, remembered: r.value.remembered, at: clock().toISOString() });
    await saveSleep(kin.id, { sleptOn: sleepOf(kin.id)?.sleptOn }); // awake: hibernation over, the old sentence still ignored
    arm(inSeconds(interval()));
  }

  async function step() {
    const kin = selectedKin();
    if (!kin || !interval() || state.busy) return;
    if (kin.id !== state.kinId) { reschedule(); return; }
    state.busy = true; onChange();
    try {
      const h = hibernation(kin.id);
      if (h) {
        if (clock() < h.until) arm(h.until);
        else await wake(kin);
        return;
      }
      const r = await read(kin);
      if (!r.ok) { failed(r); return; }
      succeeded();
      const slept = sleepOf(kin.id)?.sleptOn;
      if (looksAsleep(r.doing)) {
        if (slept === r.doing) arm(inSeconds(interval()));
        else await askSleep(kin, r.doing);
      } else {
        if (slept) await saveSleep(kin.id, null); // the chat moved on
        arm(inSeconds(interval()));
      }
    } finally {
      state.busy = false;
      onChange();
    }
  }

  return {
    state,
    reschedule,
    hibernation,
    interval,
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
      if (state.errorKind === 'maintenance') return { kind: 'maintenance', nextAt: state.nextAt };
      if (state.errorKind === 'server' && state.failures >= ERRORS_BEFORE_WARNING) return { kind: 'server', failures: state.failures, nextAt: state.nextAt };
      return null;
    },
    stop() { arm(null); },
  };
}
