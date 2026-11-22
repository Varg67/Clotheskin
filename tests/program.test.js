import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram, ACTION } from '../run/program.js';
import { fakeKindroid, READING } from './support/fake-kindroid.js';

const tick = (k) => runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });
const press = (k, op = 'read', id = 'k1') => runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: id, name: 'ignored', op } }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });
const AWAKE = READING('sitting on the bed', 'reading a book');
const ASLEEP = READING('lying in bed', 'sleeping');
const SAO_PAULO = { tz: 'America/Sao_Paulo' };

test('stopped, paused or no Kin: a start of the program asks nothing and writes nothing', async () => {
  for (const settings of [null, { autoState: 'stopped', kinId: 'k1' }, { autoState: 'paused', kinId: 'k1' }, { autoState: 'running' }]) {
    const k = fakeKindroid({ settings });
    k.answers.reading.push(AWAKE);
    const r = await tick(k);
    assert.equal(r.ok, true, JSON.stringify(settings));
    assert.deepEqual(k.asks(), []);
    assert.equal(k.puts(), 0);
  }
});

test('running: reads at once, then only when the interval has passed; moving the ruler applies at once', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', intervalS: 3600 } });
  k.answers.reading.push(AWAKE);
  const first = await tick(k);
  assert.match(first.message, /^Isa: In the bedroom\. Sitting on the bed, reading a book\. Wearing pyjamas\.$/);
  assert.deepEqual(k.entry().reading, { location: 'In the bedroom.', doing: 'Sitting on the bed, reading a book.', outfit: 'Wearing pyjamas.', hair: null, makeup: null, at: k.clock().toISOString() });
  assert.equal(k.entry().name, 'Isa');
  for (const m of [15, 15, 15]) { k.advance(m); await tick(k); }
  assert.deepEqual(k.asks(), ['reading'], '45 minutes with a 1-hour interval: nothing more');
  k.settings({ intervalS: 1800 });
  await tick(k);
  assert.deepEqual(k.asks(), ['reading', 'reading'], 'the new interval (30 min) is already overdue');
  k.advance(15);
  const puts = k.puts();
  await tick(k);
  assert.equal(k.puts(), puts, 'a start with nothing due writes nothing');
});

test('a start a few seconds early still does what is due (cron jitter)', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', intervalS: 900 } });
  k.answers.reading.push(AWAKE);
  k.at('2026-11-20T22:00:04-03:00'); await tick(k);
  k.at('2026-11-20T22:15:00-03:00'); await tick(k);
  assert.deepEqual(k.asks(), ['reading', 'reading']);
});

test('the night: asleep -> sleep question on the person\'s clock -> nothing asked overnight -> dream (told to the Kin) -> readings again', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', intervalS: 900, ...SAO_PAULO, tellDream: true } });
  k.at('2026-11-20T23:10:00-03:00');
  k.answers.reading.push(ASLEEP);
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  k.answers.dream.push('{"dream":"I was flying over the sea with my sister","remembered":"most"}');
  const r = await tick(k);
  assert.match(r.message, /Asleep until 07:30\.$/);
  const sleepPrompt = k.calls.find((c) => c[0] === 'ask' && c[1] === 'sleep')[3];
  assert.match(sleepPrompt, /It is now 23:10 on Friday for the person/);
  assert.deepEqual(k.entry().sleep, { wakeAt: '2026-11-21T10:30:00.000Z', until: '2026-11-21T10:20:00.000Z' });
  assert.match(k.entry().sleptOn, /^[0-9a-f]{8}$/);
  assert.deepEqual(Object.keys(k.entry().sleep), ['wakeAt', 'until'], 'the night itself stores only times and a fingerprint');

  for (let i = 0; i < 32; i += 1) { k.advance(15); await tick(k); } // 23:10 -> 07:10
  assert.deepEqual(k.asks(), ['reading', 'sleep'], 'nobody is asked anything overnight');
  k.at('2026-11-21T07:15:00-03:00'); await tick(k); // the 07:15 start: within 5 minutes of 07:20
  assert.deepEqual(k.asks(), ['reading', 'sleep', 'dream']);
  assert.match(k.calls.find((c) => c[0] === 'ask' && c[1] === 'dream')[3], /It is now 07:15 on Saturday/);
  assert.deepEqual(k.entry().dream, { dream: 'I was flying over the sea with my sister', remembered: 'most', at: k.clock().toISOString() });
  assert.equal(k.entry().sleep, null);
  const [, fact, opts] = k.tells()[0];
  assert.equal(fact, 'While you slept, you dreamt: "I was flying over the sea with my sister". Now that you are awake you remember most of it.');
  assert.deepEqual(opts, { kin: 'k1', key: 'dream', ttl: 24, reachOut: false });

  k.answers.reading.length = 0; k.answers.reading.push(ASLEEP); // the chat has not moved overnight
  k.advance(15); await tick(k);
  assert.deepEqual(k.asks(), ['reading', 'sleep', 'dream', 'reading'], 'the same "asleep" sentence does not start a new night');
  k.answers.reading.length = 0; k.answers.reading.push(READING('standing in the kitchen', 'making coffee'));
  k.advance(15); await tick(k);
  assert.equal(k.entry().sleptOn, null, 'the chat moved on');
});

test('dream options: not told by default or when the person turned it off; reach-out when they turned it on; a failed tell is not an error', async () => {
  for (const [opts, expectTell] of [[{}, 0], [{ tellDream: false }, 0], [{ tellDream: true, reachOut: true }, 1]]) {
    const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', ...SAO_PAULO, ...opts } });
    k.files.set('status.json', JSON.stringify({ kins: { k1: { sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' } } } }));
    k.at('2026-11-21T10:20:00Z');
    k.answers.dream.push('{"dream":"A train","remembered":"some"}');
    await tick(k);
    assert.equal(k.tells().length, expectTell);
    if (expectTell) assert.equal(k.tells()[0][2].reachOut, true);
  }
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.files.set('status.json', JSON.stringify({ kins: { k1: { sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' } } } }));
  k.at('2026-11-21T10:25:00Z'); k.tellFails = true;
  k.answers.dream.push('{"dream":"A train","remembered":"some"}');
  const r = await tick(k);
  assert.equal(r.ok, true);
  assert.equal(k.entry().dream.dream, 'A train');
});

test('not asleep after all, a wake-up time too far away, or an unclear sleep answer: readings go on', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', intervalS: 900, ...SAO_PAULO } });
  k.answers.reading.push(ASLEEP);
  k.answers.sleep.push('{"sleeping":false}');
  await tick(k);
  assert.equal(k.entry().sleep, null);
  k.advance(15); await tick(k);
  assert.deepEqual(k.asks(), ['reading', 'sleep', 'reading'], 'the same sentence does not bring the question back');

  const u = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', intervalS: 900, ...SAO_PAULO } });
  u.answers.reading.push(ASLEEP);
  u.answers.sleep.push('*snores softly*');
  const r = await tick(u);
  assert.equal(r.ok, false);
  assert.match(u.entry().note, /sleep question did not get a clear answer/);
  assert.equal(u.entry().failures, 1);
  assert.equal(u.entry().serverFailures, 0, 'the Kin answered: Kindroid is up');
  u.advance(15); await tick(u); // asked again; still unclear: 2 in a row slows down
  assert.equal(u.entry().failures, 2);
  assert.equal((Date.parse(u.entry().retryAt) - u.clock()) / 60000, 30);
});

test('errors: Kindroid down slows down and warns from the third in a row; maintenance waits 30 min; one success clears it', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', intervalS: 900 } });
  const down = new Error('kin ask failed: connection refused');
  k.answers.reading.push(down);
  const gaps = [];
  for (let i = 0; i < 4; i += 1) {
    await tick(k);
    gaps.push((Date.parse(k.entry().retryAt) - k.clock()) / 60000);
    k.at(k.entry().retryAt);
  }
  assert.deepEqual(gaps, [15, 30, 60, 60]);
  assert.equal(k.entry().serverFailures, 4);
  assert.equal(k.entry().errorKind, 'server');
  assert.equal(k.asks().length, 8, 'a fast Kindroid failure is tried once more within the run');
  k.answers.reading.length = 0; k.answers.reading.push(new Error('kin ask failed: Kindroid is under maintenance'));
  await tick(k);
  assert.equal(k.entry().errorKind, 'maintenance');
  assert.equal((Date.parse(k.entry().retryAt) - k.clock()) / 60000, 60, 'at least 30 min, here the 1-hour slow-down');
  k.answers.reading.length = 0; k.answers.reading.push(AWAKE);
  k.at(k.entry().retryAt); await tick(k);
  const e = k.entry();
  assert.deepEqual([e.failures, e.serverFailures, e.errorKind, e.error, e.retryAt], [0, 0, null, null, null]);
});

test('an answer in character is an error of the Kin, not of Kindroid: no server warning, the last reading stays', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(AWAKE);
  await tick(k);
  const before = k.entry().reading;
  k.answers.reading.length = 0; k.answers.reading.push('*giggles* A form? Not today, maintenance day!');
  k.at(new Date(k.clock().getTime() + 3600e3).toISOString());
  const r = await tick(k);
  assert.equal(r.ok, false);
  assert.match(r.message, /not valid JSON/);
  assert.equal(k.entry().errorKind, 'answer', 'a Kin saying "maintenance" is not Kindroid maintenance');
  assert.deepEqual(k.entry().reading, before);
});

test('Update status (the action): reads now, whatever the schedule; read during the night and awake ends the night', async () => {
  const k = fakeKindroid({ settings: { autoState: 'paused', kinId: 'k1', ...SAO_PAULO } });
  k.files.set('status.json', JSON.stringify({ kins: { k1: { sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' }, sleptOn: '0000abcd' } } }));
  k.at('2026-11-21T04:00:00Z');
  k.answers.reading.push(ASLEEP);
  let r = await press(k);
  assert.match(r.message, /Still asleep\.$/);
  assert.ok(k.entry().sleep, 'still asleep: the night goes on');
  k.answers.reading.length = 0; k.answers.reading.push(AWAKE);
  r = await press(k);
  assert.equal(k.entry().sleep, null, 'awake in the chat: the person woke it up');
  assert.deepEqual(k.asks(), ['reading', 'reading']);
});

test('Wake now (the action with op "wake") asks the dream question at once', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.files.set('status.json', JSON.stringify({ kins: { k1: { sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' } } } }));
  k.at('2026-11-21T04:00:00Z');
  k.answers.dream.push('{"dream":"","remembered":"nothing"}');
  const r = await press(k, 'wake');
  assert.match(r.message, /Isa woke up\. No dream remembered\./);
  assert.equal(k.entry().sleep, null);
  assert.equal(k.tells().length, 0, 'no dream: nothing to tell');
});

test('Stop forgets the night and the slowing down at once (stoppedAt), keeps the last reading; a stopped start erases the old night and dream from the file once, then writes nothing', async () => {
  const k = fakeKindroid({ settings: { autoState: 'stopped', kinId: 'k1', stoppedAt: '2026-11-21T01:00:00Z' } });
  const reading = { location: 'In the bedroom.', doing: 'Lying in bed, sleeping.', outfit: 'Wearing pyjamas.', at: '2026-11-20T23:00:00.000Z' };
  k.files.set('status.json', JSON.stringify({ kins: { k1: { name: 'Isa', reading, lastRunAt: '2026-11-20T23:00:00Z', sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' }, sleptOn: '0000abcd', failures: 2, retryAt: '2026-11-21T00:00:00Z', dream: { dream: 'x', remembered: 'all', at: '2026-11-20T10:00:00Z' } } } }));
  k.at('2026-11-21T02:00:00Z');
  await tick(k);
  assert.equal(k.puts(), 1, 'stopped: the night and the dream from before Stop are erased from the file');
  assert.equal(k.entry().dream, null);
  assert.equal(k.entry().sleep, null);
  assert.equal(k.entry().reading.outfit, 'Wearing pyjamas.', 'the last reading stays');
  k.advance(15);
  await tick(k);
  assert.equal(k.puts(), 1, 'stopped: nothing more to write');
  k.settings({ autoState: 'running' }); // Start, before any other start of the program
  k.answers.reading.push(ASLEEP);
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  await tick(k);
  assert.deepEqual(k.asks(), ['reading', 'sleep'], 'the old night is gone: a reading, not a dream question');
  const e = k.entry();
  assert.equal(e.dream, null);
  assert.equal(e.failures, 0);
});

test('a detached Kin is never asked; the action for a Kin that is not attached is refused', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'gone' } });
  k.answers.reading.push(AWAKE);
  const r = await tick(k);
  assert.match(r.message, /not attached/);
  assert.deepEqual(k.asks(), []);
  const a = await press(k, 'read', 'gone');
  assert.match(a.message, /not attached/);
  assert.deepEqual(k.asks(), []);
});

test('a status file that exists but cannot be read is never written over', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.files.set('status.json', '{"kins":{"k1":{"name":"Isa"}}}');
  k.unreadable = 'status.json';
  k.answers.reading.push(AWAKE);
  const r = await tick(k);
  assert.equal(r.ok, false);
  assert.match(r.message, /Could not read the app's files, so nothing was changed/);
  assert.equal(k.puts(), 0);
});

test('another run writing meanwhile: only this Kin\'s entry changes', async () => {
  const k = fakeKindroid({ kins: [{ id: 'k1', name: 'Isa' }, { id: 'k2', name: 'Bea' }], settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(async () => {
    k.files.set('status.json', JSON.stringify({ kins: { k2: { name: 'Bea', reading: { outfit: 'Wearing a coat.', at: '2026-11-20T21:00:00Z' } } } })); // the action for Bea finished meanwhile
    return AWAKE;
  });
  await tick(k);
  assert.equal(k.entry('k2').reading.outfit, 'Wearing a coat.');
  assert.equal(k.entry('k1').reading.outfit, 'Wearing pyjamas.');
});

test('unknown triggers and actions end clearly, without asking', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  assert.match((await runProgram({ event: { trigger: 'inbound' }, kin: k.kin })).message, /Nothing to do for the trigger "inbound"/);
  assert.match((await runProgram({ event: { trigger: 'action', action: 'toString' }, kin: k.kin })).message, /Nothing to do for the action "toString"/);
  assert.match((await runProgram({ event: { trigger: 'action', action: ACTION, input: {} }, kin: k.kin })).message, /No Kin was given/);
  assert.deepEqual(k.asks(), []);
});

// ---- from the backend review
test('time budget: a slow Kin never pushes the run past its budget; the reading is kept and the sleep question waits', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', intervalS: 900, tz: 'America/Sao_Paulo' } });
  const slow = (text, ms) => () => new Promise((r) => setTimeout(() => r(text), ms));
  k.answers.reading.push(slow(ASLEEP, 1500));
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  // 16 s for the reading (enough), then 14.5 s left: under the 15 s a question needs, with half a second of margin
  const r = await runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0, budgetMs: 26000 });
  assert.equal(r.ok, true);
  assert.match(r.message, /The sleep question waits for the next start\.$/);
  assert.deepEqual(k.asks(), ['reading']);
  assert.equal(k.entry().reading.doing, 'Lying in bed, sleeping.', 'the reading is kept');
  assert.equal(k.entry().sleptOn, null, 'the question is still to be asked');
  assert.equal((Date.parse(k.entry().retryAt) - k.clock()) / 60000, 15, 'at the next start');
  assert.equal(k.entry().failures, 0, 'not an error');
});

test('the questions get only the time left: no retry that would not fit', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  const seen = [];
  const ask = k.kin.ask;
  k.kin.ask = (p, o) => { seen.push(o.timeoutMs); return ask(p, o); };
  k.answers.reading.push(new Error('kin ask failed: connection reset'));
  await runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0, budgetMs: 40000 });
  assert.equal(seen.length, 2);
  assert.ok(seen.every((t) => t <= 30000), `${seen}`);
  const k2 = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k2.answers.reading.push(() => new Promise((_, no) => setTimeout(() => no(new Error('kin ask failed: connection reset')), 1000)));
  await runProgram({ event: { trigger: 'schedule' }, kin: k2.kin, clock: k2.clock, retryAfterMs: 0, budgetMs: 25500 }); // 15.5 s for the first try, under 15 s after it
  assert.equal(k2.asks().length, 1, 'less than 15 s would be left for the retry: none');
});

test('a bare 502/503 is tried again at once; maintenance is not', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(new Error('kin ask failed: 502 Bad Gateway'), AWAKE);
  const r = await tick(k);
  assert.equal(r.ok, true);
  assert.deepEqual(k.asks(), ['reading', 'reading']);
});

test('two runs at once: a later run\'s finished night is not brought back by an earlier run that saves last', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', tz: 'America/Sao_Paulo', tellDream: true } });
  const night = { sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' }, sleptOn: '0000abcd', lastRunAt: '2026-11-21T00:00:00Z' };
  k.files.set('status.json', JSON.stringify({ kins: { k1: { name: 'Isa', ...night } } }));
  k.at('2026-11-21T04:00:00Z');
  // Update status starts first and reads "still asleep"; meanwhile the scheduled start (later) asks the dream and saves.
  k.answers.reading.push(async () => {
    k.at('2026-11-21T10:20:00Z');
    k.answers.dream.push('{"dream":"A lighthouse","remembered":"all"}');
    await tick(k); // the later run: night over, dream saved
    k.at('2026-11-21T04:00:30Z');
    return ASLEEP;
  });
  await press(k);
  const e = k.entry();
  assert.equal(e.sleep, null, 'the night stays over');
  assert.equal(e.dream.dream, 'A lighthouse', 'the dream stays');
  assert.equal(k.tells().length, 1);
});

test('a save that fails is a failure, not a result', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.answers.reading.push(AWAKE);
  k.kin.put = async () => { throw new Error('kin files put status.json failed: quota'); };
  await assert.rejects(() => tick(k), /status\.json could not be saved/);
});

test('Kindroid failing to list the Kins counts like any Kindroid error (slowed down, shown); a detached Kin\'s action fails', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  k.kin.kins = async () => { throw new Error('kin kins failed: 500'); };
  const r = await tick(k);
  assert.equal(r.ok, false);
  assert.equal(k.entry().serverFailures, 1);
  assert.match(k.entry().error, /Could not list the Kins/);
  const d = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  assert.equal((await press(d, 'read', 'gone')).ok, false);
});

test('privacy: an answer that is not JSON never puts its text in the error (logs, status.json, kin end)', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  const logs = [];
  k.answers.reading.push('*She lies on the motel bed in red lace* {"location": in the motel');
  const r = await runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, log: (m) => logs.push(m) });
  const all = [r.message, k.files.get('status.json'), ...logs].join(' ');
  assert.ok(!/motel|lace|lies/.test(all), all);
  assert.match(r.message, /not valid JSON/);
});

test('"asleep" with a wake-up time too far away is said so (not "not asleep after all")', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', tz: 'America/Sao_Paulo' } });
  k.at('2026-11-20T23:10:00-03:00');
  k.answers.reading.push(ASLEEP);
  k.answers.sleep.push('{"sleeping":true,"wake_at":"23:20"}');
  const r = await tick(k);
  assert.match(r.message, /Asleep, but the wake-up time 23:20 is too soon or too far away/);
});

test('two runs at the same instant: the run that ended the night wins over one that only read "still asleep"', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1', tz: 'America/Sao_Paulo', tellDream: true } });
  k.files.set('status.json', JSON.stringify({ kins: { k1: { name: 'Isa', lastRunAt: '2026-11-21T03:00:00Z', sleep: { wakeAt: '2026-11-22T10:30:00Z', until: '2026-11-22T10:20:00Z' }, sleptOn: '0000abcd' } } }));
  k.at('2026-11-22T10:15:00Z');
  let release;
  const gate = new Promise((r) => { release = r; });
  k.answers.reading.push(async () => { await gate; return ASLEEP; });
  k.answers.dream.push('{"dream":"A library with endless floors","remembered":"some"}');
  const action = press(k); // reads, slowly
  await new Promise((r) => setTimeout(r, 10));
  await tick(k); // same instant: the dream question, the night ends
  release();
  await action;
  assert.equal(k.entry().sleep, null);
  assert.equal(k.entry().dream.dream, 'A library with endless floors');
  k.advance(15);
  k.answers.reading.length = 0; k.answers.reading.push(ASLEEP);
  await tick(k);
  assert.equal(k.tells().length, 1, 'the dream is told once');
  assert.deepEqual(k.asks().filter((a) => a === 'dream'), ['dream'], 'and asked once');
});

test('a dream is erased from status.json after a day, by any start, even while stopped (the file keeps no more than the screen shows)', async () => {
  const k = fakeKindroid({ settings: { autoState: 'stopped', kinId: 'k1' } });
  const dream = { dream: 'A train by the sea', remembered: 'some', at: '2026-11-20T10:00:00.000Z' };
  k.files.set('status.json', JSON.stringify({ kins: { k1: { name: 'Isa', lastRunAt: '2026-11-20T10:00:00Z', dream } } }));
  k.at('2026-11-21T09:00:00Z'); // 23 hours later: still shown, still kept
  await tick(k);
  assert.equal(k.puts(), 0);
  assert.equal(k.entry().dream.dream, 'A train by the sea');
  k.at('2026-11-21T10:00:00Z'); // a day later: erased
  await tick(k);
  assert.equal(k.puts(), 1);
  assert.equal(k.entry().dream, null);
  assert.ok(!k.files.get('status.json').includes('train'), 'nothing of the dream is left in the file');
});

test('the Kin is never told its dream unless the person turned it on (the default is off)', async () => {
  const k = fakeKindroid({ settings: { autoState: 'running', kinId: 'k1' } });
  assert.equal(JSON.parse(k.files.get('settings.json')).tellDream, undefined);
  k.files.set('status.json', JSON.stringify({ kins: { k1: { sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' } } } }));
  k.at('2026-11-21T10:20:00Z');
  k.answers.dream.push('{"dream":"A train","remembered":"some"}');
  await tick(k);
  assert.equal(k.entry().dream.dream, 'A train');
  assert.equal(k.tells().length, 0);
});
