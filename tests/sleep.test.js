import test from 'node:test';
import assert from 'node:assert/strict';
import { looksAsleep, parseClockTime, planSleep, parseSleepAnswer, parseDreamAnswer, describeDream } from '../src/core/sleep.js';
import { SLEEP_PROMPT, DREAM_PROMPT, buildFollowUpPrompt, KIN_ASK_LIMIT } from '../src/core/prompt.js';

test('asleep is read from the pose and action sentence; awake, trying to sleep and half asleep are not', () => {
  for (const s of ['Lying in bed, sleeping.', 'Asleep on the sofa.', 'Curled up on the sofa, napping.', 'Dozing in the armchair.'])
    assert.ok(looksAsleep(s), s);
  for (const s of ['Sitting on a sleeping bag, eating.', 'Lying in bed, not quite asleep.', 'Lying in bed, reading a book.', 'Lying in bed, trying to sleep.', 'Lying awake in bed.', 'Half asleep on the sofa.', 'Sitting by the bed, watching her brother.', 'Not sleeping yet.', 'No pose or action described in the recent chat.', ''])
    assert.ok(!looksAsleep(s), s);
});

test('wake-up times: 24-hour, am/pm and military forms; anything else is not a time', () => {
  assert.deepEqual(parseClockTime('07:30'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('7.30'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('7h30'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('7 am'), { h: 7, m: 0 });
  assert.deepEqual(parseClockTime('12 AM'), { h: 0, m: 0 });
  assert.deepEqual(parseClockTime('7:15 p.m.'), { h: 19, m: 15 });
  assert.deepEqual(parseClockTime('07:30:00'), { h: 7, m: 30 });
  assert.deepEqual(parseClockTime('0730'), { h: 7, m: 30 });
  for (const bad of ['7', '25:00', '07:75', '2575', 'tomorrow morning', '13 pm', '', null]) assert.equal(parseClockTime(bad), null, String(bad));
  const at = (t) => new Date(`2026-11-20T${t}:00-03:00`);
  const tz = 'America/Sao_Paulo';
  assert.equal(planSleep('14:00', at('13:50'), tz), null, 'waking in 10 minutes: nothing to wait for');
  assert.equal(planSleep('07:00', at('07:05'), tz), null, 'already past: almost a day away is not believed');
  assert.equal(planSleep('soon', at('23:10'), tz), null);
  assert.equal(planSleep('7 am', at('23:10'), tz).wakeAt.toISOString(), '2026-11-21T10:00:00.000Z');
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
  assert.match(s, /^\[DIRECTIVE — OUT OF CHARACTER\./);
  assert.match(s, /^You are Isa\. It is now 23:10 on Friday/m);
  assert.match(s, /"sleeping":true,"wake_at":"HH:MM"/);
  assert.match(s, /\{"sleeping":false\}/);
  const d = buildFollowUpPrompt(DREAM_PROMPT, { name: 'Isa', now: '07:20 on Saturday' });
  assert.match(d, /"remembered":"<all\|most\|some\|little\|nothing>"/);
  for (const p of [s, d]) { assert.match(p, /English only/); assert.match(p, /\n\[END DIRECTIVE\] Your whole reply is one line of minified JSON/); assert.ok(p.length < KIN_ASK_LIMIT); assert.ok(!/\{\{/.test(p)); }
});
