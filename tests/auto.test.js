import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERVAL_STEPS, formatInterval, snapInterval, retryDelay, errorKind, looksAsleep, parseClockTime, nextOccurrence,
  planSleep, sentenceMark, parseSleepAnswer, parseDreamAnswer, describeDream, MAX_RETRY_S, MAINTENANCE_RETRY_S, WAKE_LEAD_S,
} from '../screen/src/core/auto.js';
import { createAutomation } from '../screen/src/ui/automation.js';
import { Settings, MemoryStorage } from '../screen/src/core/store.js';
import { handleRun } from '../run/actions.js';
import { SLEEP_PROMPT, DREAM_PROMPT, buildFollowUpPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';

process.env.TZ = 'America/Sao_Paulo';
const at = (s) => new Date(`2026-11-20T${s}:00-03:00`); // local times in São Paulo

test('the ruler: seconds inside, minutes and hours on the label; saved values snap to a stop', () => {
  assert.deepEqual(INTERVAL_STEPS.slice(0, 5), [60, 120, 300, 600, 900]);
  assert.deepEqual(INTERVAL_STEPS.map(formatInterval), ['1 min', '2 min', '5 min', '10 min', '15 min', '20 min', '30 min', '45 min', '1 h', '1 h 30 min', '2 h']);
  assert.equal(snapInterval(0), 600, 'nothing usable: 10 min');
  assert.equal(snapInterval(undefined), 600);
  assert.equal(snapInterval(-5), 600);
  assert.equal(snapInterval(10), 60, 'at least a minute');
  assert.equal(snapInterval(700), 600);
  assert.equal(snapInterval(99999), 7200);
});

test('errors in a row slow the readings down, up to an hour; maintenance waits at least half an hour', () => {
  assert.equal(retryDelay(60, 0), 60);
  assert.equal(retryDelay(60, 1), 60, 'one error: the normal interval');
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map((n) => retryDelay(60, n)), [120, 240, 480, 960, 1920, 3600, 3600]);
  assert.equal(retryDelay(600, 9), MAX_RETRY_S);
  assert.equal(retryDelay(7200, 9), 7200, 'a long interval is never shortened');
  assert.equal(retryDelay(60, 1, 'maintenance'), MAINTENANCE_RETRY_S);
  assert.equal(errorKind('The Kin could not be asked: Service Unavailable (503)'), 'maintenance');
  assert.equal(errorKind('Kindroid is under scheduled maintenance'), 'maintenance');
  assert.equal(errorKind('kin ask timed out'), 'server');
  assert.equal(errorKind('not valid JSON', 'answer'), 'answer');
});

test('asleep is read from the pose and action sentence; awake, trying to sleep and half asleep are not', () => {
  for (const s of ['Lying in bed, sleeping.', 'Asleep on the sofa.', 'Curled up on the sofa, napping.', 'Dozing in the armchair.'])
    assert.ok(looksAsleep(s), s);
  for (const s of ['Sitting on a sleeping bag, eating.', 'Lying in bed, not quite asleep.', 'Lying in bed, reading a book.', 'Lying in bed, trying to sleep.', 'Lying awake in bed.', 'Half asleep on the sofa.', 'Sitting by the bed, watching her brother.', 'Not sleeping yet.', 'No pose or action described in the recent chat.', ''])
    assert.ok(!looksAsleep(s), s);
});

test('wake-up times: 24-hour and am/pm forms; the next such moment; too soon or too far is not believed', () => {
  assert.deepEqual(parseClockTime('07:30'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('7.30'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('7h30'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('7 am'), { h: 7, m: 0 });
  assert.deepEqual(parseClockTime('12 AM'), { h: 0, m: 0 });
  assert.deepEqual(parseClockTime('7:15 p.m.'), { h: 19, m: 15 });
  assert.deepEqual(parseClockTime('07:30:00'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('0730'), { h: 7, m: 30 });
  for (const bad of ['7', '25:00', '07:75', '2575', 'tomorrow morning', '13 pm', '', null]) assert.equal(parseClockTime(bad), null, String(bad));
  assert.equal(nextOccurrence({ h: 7, m: 30 }, at('23:10')).getTime(), at('07:30').getTime() + 864e5);
  assert.equal(nextOccurrence({ h: 23, m: 30 }, at('23:10')).getTime(), at('23:30').getTime());
  const plan = planSleep('07:30', at('23:10'));
  assert.equal(plan.wakeAt.getTime(), at('07:30').getTime() + 864e5, 'tomorrow');
  assert.equal(plan.until.getTime(), plan.wakeAt.getTime() - WAKE_LEAD_S * 1000, 'a little before');
  assert.equal(planSleep('14:00', at('13:50')), null, 'waking in 10 minutes: nothing to wait for');
  assert.equal(planSleep('07:00', at('07:05')), null, 'already past: almost a day away is not believed');
  assert.equal(planSleep('soon', at('23:10')), null);
});

test('the sleep answer: asleep with a time, or not asleep; a sleeping answer without a time is an error', () => {
  assert.deepEqual(parseSleepAnswer('{"sleeping":true,"wake_at":"07:30"}'), { ok: true, sleeping: true, wakeAt: '07:30' });
  assert.deepEqual(parseSleepAnswer('```json\n{"sleeping": "yes", "wake_at": "7 am"}\n```'), { ok: true, sleeping: true, wakeAt: '07:00' });
  assert.deepEqual(parseSleepAnswer('{"sleeping":false}'), { ok: true, sleeping: false, wakeAt: null });
  assert.deepEqual(parseSleepAnswer('{"sleeping":false,"wake_at":"07:30"}'), { ok: true, sleeping: false, wakeAt: null });
  assert.equal(parseSleepAnswer('{"sleeping":true}').ok, false);
  assert.equal(parseSleepAnswer('{"sleeping":true,"wake_at":"in the morning"}').ok, false);
  assert.equal(parseSleepAnswer('{"sleeping":"maybe"}').ok, false);
  assert.equal(parseSleepAnswer('*yawns* Mmm, five more minutes...').ok, false);
});

test('the dream answer: a short summary and how much is remembered; no dream is fine', () => {
  const d = parseDreamAnswer('{"dream":"I was flying over the sea with my sister","remembered":"most"}');
  assert.deepEqual(d, { ok: true, dream: 'I was flying over the sea with my sister', remembered: 'most' });
  assert.equal(describeDream(d), 'I was flying over the sea with my sister. Remembers most of it.');
  assert.deepEqual(parseDreamAnswer('{"dream":"","remembered":"nothing"}'), { ok: true, dream: null, remembered: 'nothing' });
  assert.equal(describeDream({ dream: null }), 'No dream remembered.');
  assert.equal(parseDreamAnswer('{"dream":"a cat","remembered":"loads"}').remembered, 'some', 'an unknown amount is "some"');
  assert.equal(parseDreamAnswer('{"dream":5}').ok, false);
  assert.ok(parseDreamAnswer(JSON.stringify({ dream: 'x'.repeat(900), remembered: 'all' })).dream.length <= 240);
});

test('the follow-up prompts are English, ask for one-line JSON, give the person\'s clock and stay short', () => {
  const s = buildFollowUpPrompt(SLEEP_PROMPT, { name: 'Isa', now: '23:10 on Friday' });
  assert.match(s, /^You are Isa\. It is now 23:10 on Friday/);
  assert.match(s, /"sleeping":true,"wake_at":"HH:MM"/);
  assert.match(s, /\{"sleeping":false\}/);
  const d = buildFollowUpPrompt(DREAM_PROMPT, { name: 'Isa', now: '07:20 on Saturday' });
  assert.match(d, /"remembered":"<all\|most\|some\|little\|nothing>"/);
  for (const p of [s, d]) { assert.match(p, /English only/); assert.ok(p.length < KIN_ASK_LIMIT); assert.ok(!/\{\{/.test(p)); }
});

test('the run answers the sleep and dream questions as JSON, and reports failures with their kind', async () => {
  const ev = (action, extra = {}) => ({ trigger: 'action', action, input: { kin: 'k1', name: 'Isa', now: '23:10 on Friday', ...extra } });
  const answering = (x) => ({ extract: async ({ prompt }) => (typeof x === 'function' ? x(prompt) : x) });
  let r = await handleRun({ event: ev('ask_sleep'), provider: answering((p) => (/23:10 on Friday/.test(p) ? '{"sleeping":true,"wake_at":"7:30"}' : '{}')) });
  assert.deepEqual(JSON.parse(r.message), { kin: 'k1', sleeping: true, wake_at: '07:30' });
  r = await handleRun({ event: ev('ask_dream'), provider: answering('{"dream":"A train to the sea","remembered":"some"}') });
  assert.deepEqual(JSON.parse(r.message), { kin: 'k1', dream: 'A train to the sea', remembered: 'some' });
  r = await handleRun({ event: ev('ask_sleep'), provider: answering('*snores*') });
  assert.equal(r.ok, false); assert.equal(JSON.parse(r.message).kind, 'answer');
  r = await handleRun({ event: ev('read_outfit'), provider: { extract: async () => { throw new Error('The Kin could not be asked: 503 Service Unavailable'); } } });
  assert.deepEqual([JSON.parse(r.message).kind, JSON.parse(r.message).kin], ['maintenance', 'k1']);
  r = await handleRun({ event: ev('toString'), provider: answering('{}') });
  assert.equal(JSON.parse(r.message).kind, 'input');
});

// ---- the scheduler, with a fake clock and fake timers
function harness({ interval = 600, answers = {} } = {}) {
  let now = at('22:00');
  const timers = new Set();
  const log = [];
  const settings = new Settings(new MemoryStorage());
  settings.value.autoIntervalS = interval;
  settings.value.autoState = 'running';
  const kin = { id: 'k1', name: 'Isa' };
  let last = null;
  const queue = { read: [], ask_sleep: [], ask_dream: [] };
  for (const [k, v] of Object.entries(answers)) queue[k].push(...v);
  const next = (k) => { const v = queue[k].shift(); if (v === undefined) throw new Error(`no answer queued for ${k}`); return v; };
  const auto = createAutomation({
    settings, clock: () => now, selectedKin: () => kin,
    read: async () => { log.push(['read', now.toISOString()]); const r = next('read'); if (r.ok) last = now.toISOString(); return r; },
    ask: async (k, action, extra) => { log.push([action, extra.now]); return next(action); },
    lastReadingAt: () => last,
    setTimer: (fn, ms) => { const t = { fn, due: now.getTime() + ms }; timers.add(t); return t; },
    clearTimer: (t) => timers.delete(t),
  });
  /** Moves the clock forward, firing timers in order (each may arm the next). */
  async function advance(ms) {
    const end = now.getTime() + ms;
    for (;;) {
      const t = [...timers].sort((a, b) => a.due - b.due)[0];
      if (!t || t.due > end) break;
      timers.delete(t); now = new Date(Math.max(now.getTime(), t.due)); t.fn();
      for (let i = 0; i < 20; i += 1) await Promise.resolve(); // let the async step finish
      await new Promise((r) => setImmediate(r));
    }
    now = new Date(end);
  }
  return { auto, advance, log, settings, queue, get now() { return now; } };
}
const awake = (doing = 'Sitting on the sofa, reading.') => ({ ok: true, doing });
const ASLEEP = 'Lying in bed, sleeping.';

test('automation: Start reads at once, then every interval; Stop means no timer', async () => {
  const h = harness({ interval: 300, answers: { read: [awake(), awake(), awake()] } });
  h.settings.value.autoState = 'stopped';
  h.auto.reschedule();
  await h.advance(3600 * 1000);
  assert.equal(h.log.length, 0, 'stopped: nothing is asked');
  await h.auto.start();
  await h.advance(0);
  await h.advance(300 * 1000);
  await h.advance(300 * 1000);
  assert.equal(h.log.filter(([a]) => a === 'read').length, 3);
  await h.auto.stop();
  await h.advance(3600 * 1000);
  assert.equal(h.log.length, 3, 'no reading after Stop');
  assert.equal(h.auto.state.nextAt, null);
});

test('automation: Pause keeps the night (hibernation, wake-up time) and Resume goes on from there; Stop forgets it', async () => {
  const h = harness({ interval: 600, answers: {
    read: [{ ok: true, doing: ASLEEP }],
    ask_sleep: [{ ok: true, value: { sleeping: true, wake_at: '07:30' } }],
    ask_dream: [{ ok: true, value: { dream: 'A long corridor', remembered: 'little' } }],
  } });
  h.auto.reschedule();
  await h.advance(0);
  await h.auto.pause();
  assert.equal(h.auto.runState(), 'paused');
  await h.advance(10 * 3600 * 1000); // 08:00: past the dream time, but paused
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep'], 'nothing asked while paused');
  assert.ok(h.auto.hibernation('k1'), 'the hibernation is kept');
  await h.auto.start(); // Resume
  await h.advance(0);
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep', 'ask_dream'], 'resumes where it was: the dream question is due');
  assert.equal(h.auto.state.dreams.get('k1').dream, 'A long corridor');
  await h.auto.stop();
  assert.equal(h.auto.runState(), 'stopped');
  assert.deepEqual(h.settings.value.sleep, {}, 'Stop forgets the sleep cycle');
  assert.equal(h.auto.state.dreams.size, 0);
});

test('automation: a step in flight when Pause is pressed does not plan another one', async () => {
  let release;
  const settings = new Settings(new MemoryStorage());
  Object.assign(settings.value, { autoIntervalS: 60, autoState: 'running' });
  const timers = [];
  const auto = createAutomation({
    settings, clock: () => at('12:00'), selectedKin: () => ({ id: 'k1', name: 'Isa' }),
    read: () => new Promise((r) => { release = () => r({ ok: true, doing: 'Sitting.' }); }), ask: async () => ({ ok: false }),
    setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer: () => {},
  });
  auto.reschedule();
  timers.shift()(); // the step starts and waits for the Kin
  await auto.pause();
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(auto.state.nextAt, null);
  assert.equal(timers.length, 0);
});

test('automation: asleep -> sleep question -> hibernation until a little before the wake-up time -> dream -> readings again', async () => {
  const h = harness({ interval: 600, answers: {
    read: [{ ok: true, doing: ASLEEP }, awake('Standing in the kitchen, making coffee.')],
    ask_sleep: [{ ok: true, value: { sleeping: true, wake_at: '07:30' } }],
    ask_dream: [{ ok: true, value: { dream: 'I was flying over the sea', remembered: 'most' } }],
  } });
  h.auto.reschedule();
  await h.advance(0);
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep']);
  assert.equal(h.log[1][1], '22:00 on Friday', 'the Kin is told the person\'s time');
  const hib = h.auto.hibernation('k1');
  assert.equal(hib.until.getTime(), at('07:20').getTime() + 864e5);
  assert.equal(h.settings.value.sleep.k1.sleptOn, sentenceMark(ASLEEP), 'saved: reopening the screen keeps the hibernation');
  assert.ok(!JSON.stringify(h.settings.value).includes('bed'), 'only a fingerprint of the sentence, never the scene');
  await h.advance(9 * 3600 * 1000); // 07:00: still asleep, nobody is asked anything
  assert.equal(h.log.length, 2);
  await h.advance(20 * 60 * 1000); // 07:20: the dream question
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep', 'ask_dream']);
  assert.equal(h.auto.state.dreams.get('k1').dream, 'I was flying over the sea');
  assert.equal(h.auto.hibernation('k1'), null);
  await h.advance(600 * 1000);
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep', 'ask_dream', 'read'], 'back to the normal readings');
  assert.equal(h.settings.value.sleep.k1, undefined, 'the chat moved on: nothing about sleep is kept');
});

test('automation: "not asleep" goes on reading, and the same sentence does not bring the question back', async () => {
  const h = harness({ interval: 600, answers: {
    read: [{ ok: true, doing: ASLEEP }, { ok: true, doing: ASLEEP }, awake()],
    ask_sleep: [{ ok: true, value: { sleeping: false, wake_at: null } }],
  } });
  h.auto.reschedule();
  await h.advance(0);
  await h.advance(600 * 1000);
  await h.advance(600 * 1000);
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep', 'read', 'read']);
  assert.equal(h.auto.hibernation('k1'), null);
});

test('automation: after waking, the still chat (same "asleep" sentence) does not start a new night', async () => {
  const h = harness({ interval: 600, answers: {
    read: [{ ok: true, doing: ASLEEP }, { ok: true, doing: ASLEEP }],
    ask_sleep: [{ ok: true, value: { sleeping: true, wake_at: '23:30' } }],
    ask_dream: [{ ok: true, value: { dream: null, remembered: 'nothing' } }],
  } });
  h.auto.reschedule();
  await h.advance(0);
  await h.advance(90 * 60 * 1000); // 23:20 dream, 23:30 read
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep', 'ask_dream', 'read']);
});

test('automation: errors slow down and warn; maintenance waits half an hour; a success clears it all', async () => {
  const fail = { ok: false, kind: 'server', error: 'The Kindroid Workshop did not answer (action read_outfit).' };
  const h = harness({ interval: 60, answers: { read: [fail, fail, fail, { ok: false, kind: 'server', error: 'Under maintenance' }, awake()] } });
  h.auto.reschedule();
  await h.advance(0); // fail 1: next in 60 s
  assert.equal(h.auto.warning(), null);
  await h.advance(60 * 1000); // fail 2: next in 120 s
  await h.advance(120 * 1000); // fail 3: next in 240 s, warning
  assert.equal(h.auto.warning().kind, 'server');
  assert.equal((h.auto.state.nextAt - h.now) / 1000, 240);
  await h.advance(240 * 1000); // maintenance
  assert.equal(h.auto.warning().kind, 'maintenance');
  assert.equal((h.auto.state.nextAt - h.now) / 1000, MAINTENANCE_RETRY_S);
  await h.advance(MAINTENANCE_RETRY_S * 1000);
  assert.equal(h.auto.warning(), null);
  assert.equal((h.auto.state.nextAt - h.now) / 1000, 60, 'back to the chosen interval');
});

test('automation: wake now asks the dream question at once; a Kin that cannot answer it is let go', async () => {
  const h = harness({ interval: 600, answers: {
    read: [{ ok: true, doing: ASLEEP }],
    ask_sleep: [{ ok: true, value: { sleeping: true, wake_at: '07:30' } }],
    ask_dream: [{ ok: false, kind: 'answer', error: 'not valid JSON' }],
  } });
  h.auto.reschedule();
  await h.advance(0);
  await h.auto.wakeNow();
  await h.advance(0);
  assert.deepEqual(h.log.map(([a]) => a), ['read', 'ask_sleep', 'ask_dream']);
  assert.equal(h.auto.hibernation('k1'), null, 'awake even without a dream');
  assert.equal(h.auto.state.dreams.has('k1'), false);
});

// ---- races and failures found by the final QA
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function raceHarness() {
  const now = at('22:00');
  const settings = new Settings(new MemoryStorage());
  Object.assign(settings.value, { autoIntervalS: 600, autoState: 'running' });
  let kin = { id: 'isa', name: 'Isa' };
  const calls = [];
  const pending = [];
  const timers = [];
  const auto = createAutomation({
    settings, clock: () => now, selectedKin: () => kin,
    read: (k) => { calls.push(['read', k.id]); const d = deferred(); pending.push(d); return d.promise; },
    ask: (k, action) => { calls.push([action, k.id]); const d = deferred(); pending.push(d); return d.promise; },
    setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };
  const fire = async () => { const t = timers.shift(); if (t) t(); await flush(); };
  return { auto, settings, calls, pending, fire, flush, timers, setKin: (k) => { kin = k; } };
}

test('race: a sleep question still in flight after a Kin switch does not hibernate the new Kin, and the new Kin is read at once', async () => {
  const r = raceHarness();
  r.auto.reschedule();
  await r.fire(); // Isa read…
  r.pending.shift().resolve({ ok: true, doing: ASLEEP }); await r.flush(); // …asleep: the sleep question goes out
  assert.deepEqual(r.calls.at(-1), ['ask_sleep', 'isa']);
  r.setKin({ id: 'bea', name: 'Bea' }); r.auto.reschedule(); // the person picks Bea meanwhile
  r.pending.shift().resolve({ ok: true, value: { sleeping: true, wake_at: '07:30' } }); await r.flush();
  assert.deepEqual(r.settings.value.sleep, {}, 'Isa\'s answer came for an old step: nothing saved');
  assert.equal(r.auto.hibernation('bea'), null);
  await r.fire();
  assert.deepEqual(r.calls.at(-1), ['read', 'bea'], 'Bea is read at once');
});

test('race: Stop during the sleep question saves no night; Stop during the dream question shows no dream; Pause asks nothing more', async () => {
  let r = raceHarness();
  r.auto.reschedule();
  await r.fire();
  r.pending.shift().resolve({ ok: true, doing: ASLEEP }); await r.flush();
  r.auto.stop();
  r.pending.shift().resolve({ ok: true, value: { sleeping: true, wake_at: '07:30' } }); await r.flush();
  assert.deepEqual(r.settings.value.sleep, {});
  assert.equal(r.timers.length, 0, 'nothing planned after Stop');

  r = raceHarness();
  r.settings.value.sleep = { isa: { wakeAt: at('07:30').toISOString(), until: at('21:00').toISOString(), sleptOn: 'x' } };
  r.auto.reschedule();
  await r.fire(); // dream question
  assert.deepEqual(r.calls.at(-1), ['ask_dream', 'isa']);
  r.auto.stop();
  r.pending.shift().resolve({ ok: true, value: { dream: 'A storm', remembered: 'all' } }); await r.flush();
  assert.equal(r.auto.state.dreams.size, 0, 'no dream after Stop');

  r = raceHarness();
  r.auto.reschedule();
  await r.fire();
  r.auto.pause();
  r.pending.shift().resolve({ ok: true, doing: ASLEEP }); await r.flush();
  assert.deepEqual(r.calls.map(([a]) => a), ['read'], 'paused while reading: the sleep question is not asked');
  assert.equal(r.timers.length, 0);
});

test('a sleep question the Kin keeps answering badly slows the readings down and says so', async () => {
  const bad = { ok: false, kind: 'answer', error: 'The answer does not give a wake-up time as HH:MM.' };
  const h = harness({ interval: 60, answers: { read: Array(5).fill({ ok: true, doing: ASLEEP }), ask_sleep: Array(5).fill(bad) } });
  h.auto.reschedule();
  await h.advance(0);
  const gaps = [];
  for (let i = 0; i < 3; i += 1) { const before = h.now.getTime(); const next = h.auto.state.nextAt.getTime(); gaps.push((next - before) / 1000); await h.advance(next - before); }
  assert.deepEqual(gaps, [60, 120, 240], 'x2 from the second failure in a row');
  assert.match(h.auto.state.note, /sleep question did not get a clear answer/);
  assert.equal(h.auto.warning(), null, 'the Kin answered: Kindroid is up, no server warning');
});

test('the server warning counts Kindroid errors only; a Kin saying "maintenance" is not Kindroid maintenance', async () => {
  const answer = { ok: false, kind: 'answer', error: 'not valid JSON' };
  const server = { ok: false, kind: 'server', error: 'The Kindroid Workshop did not answer (action read_outfit).' };
  let h = harness({ interval: 60, answers: { read: [answer, answer, server] } });
  h.auto.reschedule();
  await h.advance(0); await h.advance(60e3); await h.advance(120e3);
  assert.equal(h.auto.warning(), null, '2 answers + 1 server error is not "3 times in a row"');
  h = harness({ interval: 60, answers: { read: [{ ok: false, kind: 'answer', error: 'The answer is not valid JSON (maintenance mode lol).' }] } });
  h.auto.reschedule();
  await h.advance(0);
  assert.equal(h.auto.state.errorKind, 'answer');
  assert.equal((h.auto.state.nextAt - h.now) / 1000, 60, 'no 30-minute maintenance wait');
});

test('moving the ruler while Kindroid is failing keeps the slowed-down next try', async () => {
  const fail = { ok: false, kind: 'server', error: 'down' };
  const h = harness({ interval: 60, answers: { read: [fail, fail, fail] } });
  h.auto.reschedule();
  await h.advance(0); await h.advance(60e3); await h.advance(120e3);
  const next = h.auto.state.nextAt.getTime();
  h.auto.setInterval(120);
  assert.equal(h.auto.state.nextAt.getTime(), next);
  assert.equal(h.settings.value.autoIntervalS, 120);
});

test('Start, Pause and Stop act at once and say whether anything changed', () => {
  const settings = new Settings({ get: async () => null, set: () => new Promise(() => {}) }); // a save that never ends
  const auto = createAutomation({ settings, clock: () => at('12:00'), selectedKin: () => ({ id: 'k' }), read: async () => ({ ok: true, doing: '' }), ask: async () => ({ ok: false }), setTimer: () => 1, clearTimer: () => {} });
  assert.equal(auto.start(), true);
  assert.equal(auto.runState(), 'running', 'without waiting for the save');
  assert.equal(auto.start(), false, 'a second click changes nothing');
  assert.equal(auto.pause(), true);
  assert.equal(auto.stop(), true);
  assert.equal(auto.stop(), false);
});
