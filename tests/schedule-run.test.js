import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRun } from '../run/actions.js';
import { MemoryStorage, Settings } from '../screen/src/core/store.js';
import { ReadingStore } from '../screen/src/core/readings.js';
import { AUTO_MAX_KINS_PER_RUN } from '../screen/src/core/auto.js';

const T0 = new Date('2026-11-19T12:00:00Z');
const plus = (min) => new Date(T0.getTime() + min * 60000);
const tick = { trigger: 'schedule' };

async function setup(settings = {}) {
  const storage = new MemoryStorage();
  const s = new Settings(storage);
  await s.load();
  await s.save({ autoUpdate: true, autoIntervalMinutes: 15, autoKins: [{ id: 'k-isa', name: 'Isa' }], ...settings });
  const asked = [];
  let answer = async () => '{"location":"in the kitchen","pose":"standing","action":"cooking","topwear":["a shirt"]}';
  const provider = { extract: async ({ prompt, kinId }) => { asked.push({ prompt, kinId }); return answer({ prompt, kinId }); } };
  const run = (now, event = tick) => handleRun({ event, provider, storage, clock: () => now });
  return { storage, asked, run, setAnswer: (f) => { answer = f; }, readings: new ReadingStore(storage), settings: s };
}

test('off by default: the beat asks nobody', async () => {
  const t = await setup({ autoUpdate: false });
  const out = await t.run(T0);
  assert.deepEqual(out, { ok: true, message: 'Automatic updates are off.' });
  assert.equal(t.asked.length, 0);
  const empty = new MemoryStorage();
  assert.equal((await handleRun({ event: tick, provider: { extract: async () => { throw new Error('asked'); } }, storage: empty, clock: () => T0 })).message, 'Automatic updates are off.', 'no settings at all means off');
});

test('on, but no Kin ticked: nothing to ask', async () => {
  const t = await setup({ autoKins: [] });
  assert.match((await t.run(T0)).message, /no Kin is ticked/);
  assert.equal(t.asked.length, 0);
});

test('the first beat asks the ticked Kin by id and by name, and keeps the three sentences', async () => {
  const t = await setup();
  const out = await t.run(T0);
  assert.equal(out.ok, true);
  assert.match(out.message, /Checked 1: Isa updated/);
  assert.equal(t.asked.length, 1);
  assert.equal(t.asked[0].kinId, 'k-isa');
  assert.match(t.asked[0].prompt, /^You are Isa\./);
  assert.ok(!t.asked[0].prompt.includes('RECENT CHAT'), 'the Kin sees its own chat');
  const r = await t.readings.get('k-isa');
  assert.deepEqual([r.location, r.doing, r.outfit, r.source, r.error], ['In the kitchen.', 'Standing, cooking.', 'Wearing a shirt.', 'auto', null]);
  assert.equal(r.at, T0.toISOString());
});

test('the interval is respected: nothing before it, one question after it, then the clock restarts', async () => {
  const t = await setup({ autoIntervalMinutes: 15 });
  await t.run(T0);
  for (const m of [5, 10]) { assert.equal((await t.run(plus(m))).message, 'No Kin is due yet.', `${m} min`); }
  assert.equal(t.asked.length, 1);
  await t.run(plus(15));
  assert.equal(t.asked.length, 2);
  assert.equal((await t.run(plus(20))).message, 'No Kin is due yet.');
  assert.equal((await t.readings.get('k-isa')).at, plus(15).toISOString());
});

test('changing the interval changes what happens at the next beat', async () => {
  const t = await setup({ autoIntervalMinutes: 60 });
  await t.run(T0);
  assert.equal((await t.run(plus(15))).message, 'No Kin is due yet.');
  await t.settings.save({ autoIntervalMinutes: 10 });
  await t.run(plus(15));
  assert.equal(t.asked.length, 2, 'the new, shorter interval applies');
  await t.settings.save({ autoUpdate: false });
  await t.run(plus(500));
  assert.equal(t.asked.length, 2, 'switched off: nothing more');
});

test('a failing Kin is retried at the next interval, not on every beat, and keeps its last good sentences', async () => {
  const t = await setup();
  await t.run(T0); // good reading
  t.setAnswer(async () => '*giggles* No forms today!');
  const out = await t.run(plus(15));
  assert.equal(out.ok, false);
  assert.match(out.message, /Isa failed/);
  assert.match(out.message, /not valid JSON/);
  let r = await t.readings.get('k-isa');
  assert.equal(r.location, 'In the kitchen.');
  assert.equal(r.at, T0.toISOString());
  assert.equal(r.attemptedAt, plus(15).toISOString());
  assert.match(r.error, /not valid JSON/);
  assert.equal((await t.run(plus(20))).message, 'No Kin is due yet.', 'no retry storm');
  t.setAnswer(async () => '{"location":"at the park"}');
  await t.run(plus(30));
  r = await t.readings.get('k-isa');
  assert.equal(r.location, 'At the park.');
  assert.equal(r.error, null);
});

test('several Kins: each is asked on its own, one failure does not stop the others, same-name Kins stay apart', async () => {
  const t = await setup({ autoKins: [{ id: 'alex-1', name: 'Alex' }, { id: 'alex-2', name: 'Alex' }, { id: 'k-isa', name: 'Isa' }] });
  t.setAnswer(async ({ kinId }) => {
    if (kinId === 'alex-2') throw new Error('The Kin could not be asked: grant missing');
    return JSON.stringify({ location: kinId === 'alex-1' ? 'in the garden' : 'in the kitchen' });
  });
  const out = await t.run(T0);
  assert.equal(out.ok, true, 'ok while at least one Kin worked');
  assert.match(out.message, /Checked 3/);
  assert.equal((await t.readings.get('alex-1')).location, 'In the garden.');
  assert.equal((await t.readings.get('k-isa')).location, 'In the kitchen.');
  assert.match((await t.readings.get('alex-2')).error, /grant missing/);
  assert.equal((await t.readings.get('alex-2')).location, null);
});

test('all Kins failing makes the run end as failed, with a clear line', async () => {
  const t = await setup();
  t.setAnswer(async () => { throw new Error('The Kin could not be asked: grant missing'); });
  const out = await t.run(T0);
  assert.equal(out.ok, false);
  assert.match(out.message, /grant missing/);
});

test('at most the per-run cap are asked per beat; the rest follow on the next beats', async () => {
  const kins = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, name: `Kin ${i}` }));
  const t = await setup({ autoKins: kins });
  await t.run(T0);
  assert.equal(t.asked.length, AUTO_MAX_KINS_PER_RUN);
  await t.run(plus(5));
  assert.equal(t.asked.length, 5, 'the two left over go next, before anyone is asked twice');
  assert.deepEqual([...new Set(t.asked.map((a) => a.kinId))].length, 5);
});

test('a manual reading is stored and restarts the automatic interval, so nobody is asked twice in a row', async () => {
  const t = await setup();
  const manual = await t.run(T0, { trigger: 'action', action: 'read_outfit', input: { kin: 'k-isa', name: 'Isa' } });
  assert.equal(manual.ok, true);
  assert.equal((await t.readings.get('k-isa')).source, 'manual');
  assert.equal((await t.run(plus(5))).message, 'No Kin is due yet.');
  assert.equal(t.asked.length, 1);
  await t.run(plus(15));
  assert.equal(t.asked.length, 2);
  assert.equal((await t.readings.get('k-isa')).source, 'auto');
});

test('a failed manual reading changes nothing stored', async () => {
  const t = await setup();
  await t.run(T0);
  t.setAnswer(async () => 'nonsense');
  const bad = await t.run(plus(1), { trigger: 'action', action: 'read_outfit', input: { kin: 'k-isa', name: 'Isa' } });
  assert.equal(bad.ok, false);
  assert.equal((await t.readings.get('k-isa')).attemptedAt, T0.toISOString());
});

test('storage trouble never loses the answer or crashes the run', async () => {
  const t = await setup();
  const real = t.storage.set.bind(t.storage);
  t.storage.set = async (k, v) => { if (k.includes(':reading:')) throw new Error('disk full'); return real(k, v); };
  const manual = await t.run(T0, { trigger: 'action', action: 'read_outfit', input: { kin: 'k-isa', name: 'Isa' } });
  assert.equal(manual.ok, true, 'the reading still counts when it cannot be remembered');
  assert.equal(JSON.parse(manual.message).location, 'In the kitchen.');
  const auto = await t.run(plus(30));
  assert.equal(auto.ok, true);
});

test('corrupt settings mean off, never a crash or a burst of questions', async () => {
  const storage = new MemoryStorage();
  await storage.set('clotheskin:v2:settings', '{ broken');
  const out = await handleRun({ event: tick, provider: { extract: async () => { throw new Error('asked'); } }, storage, clock: () => T0 });
  assert.deepEqual(out, { ok: true, message: 'Automatic updates are off.' });
  const odd = new MemoryStorage();
  await odd.set('clotheskin:v2:settings', JSON.stringify({ autoUpdate: true, autoIntervalMinutes: 'x', autoKins: 'nope' }));
  assert.match((await handleRun({ event: tick, provider: { extract: async () => '{}' }, storage: odd, clock: () => T0 })).message, /no Kin is ticked/);
});

test('the end line of a beat fits the 500 characters kin end allows, even with many long names', async () => {
  const kins = Array.from({ length: 3 }, (_, i) => ({ id: `k${i}`, name: `A Kin With A Really Quite Long Name Number ${i} `.repeat(3) }));
  const t = await setup({ autoKins: kins });
  t.setAnswer(async () => { throw new Error('x'.repeat(900)); });
  const out = await t.run(T0);
  assert.ok(out.message.length <= 480, `${out.message.length}`);
});

test('a beat that starts while the previous one is still waiting for the Kin does not ask the same Kin again', async () => {
  const t = await setup();
  let release;
  const gate = new Promise((r) => { release = r; });
  t.setAnswer(async () => { await gate; return '{"location":"in the kitchen"}'; });
  const first = t.run(T0);
  while (t.asked.length === 0) await new Promise((r) => setTimeout(r, 1)); // the first beat is now waiting for the Kin
  const second = await t.run(plus(5));
  assert.equal(second.message, 'No Kin is due yet.', 'the claim is already stored');
  assert.equal(t.asked.length, 1);
  release();
  assert.equal((await first).ok, true);
  assert.equal((await t.readings.get('k-isa')).location, 'In the kitchen.');
});

test('a run that dies after claiming leaves the last good sentences and retries at the next interval, not at once', async () => {
  const t = await setup();
  await t.run(T0);
  t.setAnswer(async () => { throw new Error('the container was stopped'); });
  await t.run(plus(15));
  const r = await t.readings.get('k-isa');
  assert.equal(r.location, 'In the kitchen.');
  assert.equal(r.attemptedAt, plus(15).toISOString());
  assert.equal((await t.run(plus(20))).message, 'No Kin is due yet.');
});
