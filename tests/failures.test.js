// What happens when the Kin or the connection fails: connection errors, a model that is down or lagging, rate limits,
// missing permissions, unreadable files. The point is: never lose the last good reading, never hammer, say what happened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFailure, KINDS, KinFailure, PERMANENT_KINDS } from '../screen/src/core/errors.js';
import { retryWaitMinutes, pickDue, SCHEDULE_TICK_MINUTES } from '../screen/src/core/auto.js';
import { handleRun, RUN_BUDGET_MS, ASK_BUDGET_MS } from '../run/actions.js';
import { runKin, KinAskProvider, KinFilesStorage } from '../run/kin-cli.js';
import { MemoryStorage, Settings } from '../screen/src/core/store.js';
import { ReadingStore, afterAttempt } from '../screen/src/core/readings.js';

const T0 = new Date('2026-11-19T12:00:00Z');
const plus = (min) => new Date(T0.getTime() + min * 60000);
const FAKE = new URL('./fixtures/fake-kin.mjs', import.meta.url).pathname;
const withFake = async (mode, fn, extra = {}) => {
  const old = { ...process.env };
  process.env.FAKE_KIN = mode;
  Object.assign(process.env, extra);
  try { return await fn(); } finally { for (const k of ['FAKE_KIN', ...Object.keys(extra)]) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
};

// ---------------------------------------------------------------- classification
test('failures are classified by what to do next', () => {
  const cases = [
    ['503 Service Unavailable', KINDS.UNAVAILABLE, true, true],
    ['the model is overloaded, try again later', KINDS.UNAVAILABLE, true, true],
    ['502 Bad Gateway', KINDS.UNAVAILABLE, true, true],
    ['The model is offline for maintenance', KINDS.UNAVAILABLE, true, true],
    ['429 Too Many Requests', KINDS.RATE_LIMIT, true, true],
    ['rate limit exceeded for this token', KINDS.RATE_LIMIT, true, true],
    ['getaddrinfo ENOTFOUND api.kindroid.ai', KINDS.NETWORK, true, true],
    ['connect ECONNREFUSED 10.0.0.1:443', KINDS.NETWORK, true, true],
    ['socket hang up', KINDS.NETWORK, true, true],
    ['fetch failed', KINDS.NETWORK, true, true],
    ['403 Forbidden', KINDS.PERMISSION, false, false],
    ['grant chat:read is missing', KINDS.PERMISSION, false, false],
    ['Unauthorized', KINDS.PERMISSION, false, false],
    ['spawn kin ENOENT', KINDS.MISSING_TOOL, false, false],
    ['kin: command not found', KINDS.MISSING_TOOL, false, false],
    ['something odd happened', KINDS.UNKNOWN, true, false],
    ['', KINDS.UNKNOWN, true, false],
  ];
  for (const [message, kind, transient, retrySoon] of cases) {
    const c = classifyFailure({ message });
    assert.equal(c.kind, kind, message);
    assert.equal(c.transient, transient, message);
    assert.equal(c.retrySoon, retrySoon, message);
    assert.ok(/^[A-Z]/.test(c.message) && c.message.length < 260, c.message);
  }
  const t = classifyFailure({ message: 'kin ask timed out after 70 s', timedOut: true });
  assert.deepEqual([t.kind, t.transient, t.retrySoon], [KINDS.TIMEOUT, true, false], 'a timeout is not retried at once: it already cost a minute');
  assert.equal(classifyFailure({ message: 'x', spawnFailed: true }).kind, KINDS.MISSING_TOOL);
});

test('a rate limit that mentions a token is a rate limit, not a permission problem; messages are English and bounded', () => {
  assert.equal(classifyFailure({ message: '429: too many requests for token abc' }).kind, KINDS.RATE_LIMIT);
  const long = classifyFailure({ message: `503 ${'overloaded '.repeat(100)}` });
  assert.ok(long.message.length <= 160, `${long.message.length}`);
  assert.match(long.message, /^The Kin or its model is unavailable right now\./);
  assert.ok(PERMANENT_KINDS.has(KINDS.PERMISSION) && !PERMANENT_KINDS.has(KINDS.NETWORK));
  const e = new KinFailure(classifyFailure({ message: '503' }));
  assert.deepEqual([e.kind, e.transient, e.retrySoon], [KINDS.UNAVAILABLE, true, true]);
});

// ---------------------------------------------------------------- the kin command
test('a command that hangs is stopped at the timeout and reported as a timeout; nothing stays running', async () => {
  const pidFile = join(tmpdir(), `fake-kin-${process.pid}-hang.pid`);
  await withFake('hang', async () => {
    const t0 = Date.now();
    await assert.rejects(() => runKin(['ask', 'x'], { bin: FAKE, timeoutMs: 300, killAfterMs: 200 }), (e) => e.timedOut === true && /timed out/.test(e.message));
    assert.ok(Date.now() - t0 < 1500, 'the promise settles at the timeout, not later');
    await new Promise((r) => setTimeout(r, 500));
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the process is gone');
  }, { FAKE_KIN_PID_FILE: pidFile });
});

test('a command that ignores the polite stop is killed anyway', async () => {
  const pidFile = join(tmpdir(), `fake-kin-${process.pid}-term.pid`);
  await withFake('ignore-term', async () => {
    await assert.rejects(() => runKin(['ask', 'x'], { bin: FAKE, timeoutMs: 300, killAfterMs: 300 }), (e) => e.timedOut === true);
    await new Promise((r) => setTimeout(r, 900));
    assert.throws(() => process.kill(Number(readFileSync(pidFile, 'utf8')), 0), /ESRCH/, 'SIGKILL finished it');
  }, { FAKE_KIN_PID_FILE: pidFile });
});

test('through the provider: timeout, model down, no permission, a missing command and a silent crash each get a clear kind', async () => {
  const ask = (opts) => new KinAskProvider((args) => runKin(args, { bin: FAKE, ...opts })).extract({ prompt: 'p', kinId: 'k' });
  const kindOf = async (mode, opts = {}) => withFake(mode, async () => { try { await ask(opts); return 'no error'; } catch (e) { return e.kind; } });
  assert.equal(await kindOf('hang', { timeoutMs: 250, killAfterMs: 100 }), KINDS.TIMEOUT);
  assert.equal(await kindOf('fail503'), KINDS.UNAVAILABLE);
  assert.equal(await kindOf('fail403'), KINDS.PERMISSION);
  assert.equal(await kindOf('silent-fail'), KINDS.UNKNOWN);
  assert.equal(await withFake('ok', ask), '{"location":"in the kitchen"}');
  const missing = new KinAskProvider((args) => runKin(args, { bin: '/nonexistent/path/kin' }));
  await assert.rejects(() => missing.extract({ prompt: 'p', kinId: 'k' }), (e) => e.kind === KINDS.MISSING_TOOL && /could not be started/.test(e.message));
});

// ---------------------------------------------------------------- backoff
test('the wait after failures starts at one beat, doubles, and never exceeds the interval', () => {
  const r = (failures, errorKind = 'unavailable') => ({ failures, error: 'x', errorKind });
  assert.equal(retryWaitMinutes(null, 60), 60);
  assert.equal(retryWaitMinutes({ failures: 0 }, 60), 60);
  const waits = [1, 2, 3, 4, 5, 6, 7].map((f) => retryWaitMinutes(r(f), 60));
  assert.deepEqual(waits, [5, 10, 20, 40, 60, 60, 60]);
  assert.deepEqual([1, 2, 3, 4].map((f) => retryWaitMinutes(r(f), 15)), [5, 10, 15, 15], 'a short interval is never exceeded');
  assert.equal(retryWaitMinutes(r(99), 1440), 1440);
  assert.equal(retryWaitMinutes(r(1e9), 60), 60, 'no overflow');
  assert.equal(SCHEDULE_TICK_MINUTES, 5);
});

test('a permanent failure waits the whole interval: asking sooner cannot fix a missing permission', () => {
  for (const kind of PERMANENT_KINDS) assert.equal(retryWaitMinutes({ failures: 3, error: 'x', errorKind: kind }, 60), 60, kind);
  assert.equal(retryWaitMinutes({ failures: 3, error: null, errorKind: 'unavailable' }, 60), 60, 'no error recorded means no backoff');
});

test('pickDue uses the backoff: a recently failed Kin is due sooner than a healthy one', () => {
  const kins = [{ id: 'ok', name: 'OK' }, { id: 'bad', name: 'Bad' }];
  const attempted = plus(-6).toISOString();
  const readings = { ok: { attemptedAt: attempted, failures: 0 }, bad: { attemptedAt: attempted, failures: 1, error: 'x', errorKind: 'network' } };
  assert.deepEqual(pickDue({ now: T0, kins, readings, intervalMinutes: 60 }).map((k) => k.id), ['bad']);
});

// ---------------------------------------------------------------- the scheduled run under failure
function harness(settings = {}) {
  const storage = new MemoryStorage();
  const s = new Settings(storage);
  const asked = [];
  let answer = async () => '{"location":"in the kitchen"}';
  const provider = { extract: async ({ kinId }) => { asked.push(kinId); return answer({ kinId }); } };
  const ready = (async () => { await s.load(); await s.save({ autoUpdate: true, autoIntervalMinutes: 60, autoKins: [{ id: 'k1', name: 'Isa' }], ...settings }); })();
  let now = T0;
  const sleeps = [];
  return {
    storage, asked, provider, readings: new ReadingStore(storage), settings: s, ready,
    setAnswer: (f) => { answer = f; },
    setNow: (d) => { now = d; },
    run: async (d = now, event = { trigger: 'schedule' }) => { await ready; return handleRun({ event, provider, storage, clock: () => (typeof d === 'function' ? d() : d), sleep: async (ms) => { sleeps.push(ms); } }); },
    sleeps,
  };
}
const failWith = (message, extra = {}) => async () => { throw Object.assign(new Error(message), extra); };

test('model down: the failure is recorded with its kind, the last good reading stays, and recovery resets the count', async () => {
  const h = harness();
  await h.run(T0);
  h.setAnswer(async () => { throw new KinFailure(classifyFailure({ message: '503 Service Unavailable' })); });
  const out = await h.run(plus(60));
  assert.equal(out.ok, false);
  assert.match(out.message, /unavailable right now/);
  const r = await h.readings.get('k1');
  assert.deepEqual([r.location, r.failures, r.errorKind], ['In the kitchen.', 1, 'unavailable']);
  h.setAnswer(async () => '{"location":"at the park"}');
  await h.run(plus(65));
  assert.deepEqual([(await h.readings.get('k1')).location, (await h.readings.get('k1')).failures], ['At the park.', 0]);
});

test('a missing permission is not retried sooner than the interval, and the message says what to do', async () => {
  const h = harness();
  h.setAnswer(async () => { throw new KinFailure(classifyFailure({ message: '403 Forbidden: grant missing' })); });
  const out = await h.run(T0);
  assert.match(out.message, /refused the question.*Waiting for you/);
  assert.equal((await h.readings.get('k1')).errorKind, 'permission');
  assert.equal((await h.run(plus(5))).message, 'No Kin is due yet.');
  assert.equal((await h.run(plus(30))).message, 'No Kin is due yet.');
  assert.equal(h.asked.length, 1);
  await h.run(plus(60));
  assert.equal(h.asked.length, 2, 'asked again after the whole interval');
});

test('a plain Error from a custom provider is still classified from its message', async () => {
  const h = harness();
  h.setAnswer(failWith('connect ECONNREFUSED 10.1.1.1:443'));
  const out = await h.run(T0);
  assert.match(out.message, /connection to Kindroid failed/);
  assert.equal((await h.readings.get('k1')).errorKind, 'network');
});

test('the person is waiting for Update status: one quick retry for a blip, none for a timeout or a bad answer', async () => {
  const manual = { trigger: 'action', action: 'read_outfit', input: { kin: 'k1', name: 'Isa' } };
  const h = harness();
  let n = 0;
  h.setAnswer(async () => { n += 1; if (n === 1) throw new KinFailure(classifyFailure({ message: 'ECONNRESET connection reset by peer' })); return '{"location":"in the kitchen"}'; });
  const ok = await h.run(T0, manual);
  assert.equal(ok.ok, true, 'the second try worked');
  assert.equal(h.asked.length, 2);
  assert.deepEqual(h.sleeps, [2000], 'a short pause between the two');

  const down = harness();
  down.setAnswer(async () => { throw new KinFailure(classifyFailure({ message: '503 Service Unavailable' })); });
  assert.equal((await down.run(T0, manual)).ok, false);
  assert.equal(down.asked.length, 2, 'exactly one retry, then give up');

  const slow = harness();
  slow.setAnswer(async () => { throw new KinFailure(classifyFailure({ message: 'timed out', timedOut: true })); });
  const out = await slow.run(T0, manual);
  assert.match(out.message, /did not answer in time/);
  assert.equal(slow.asked.length, 1, 'a timeout is not retried');

  const bad = harness();
  bad.setAnswer(async () => 'I am not JSON');
  assert.equal((await bad.run(T0, manual)).ok, false);
  assert.equal(bad.asked.length, 1, 'a bad answer is not retried');

  const forbidden = harness();
  forbidden.setAnswer(async () => { throw new KinFailure(classifyFailure({ message: '403 Forbidden' })); });
  await forbidden.run(T0, manual);
  assert.equal(forbidden.asked.length, 1, 'a permission problem is not retried');
});

test('scheduled beats do not retry inside the run (the backoff does that), so an outage costs one question per Kin per beat', async () => {
  const h = harness({ autoKins: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  h.setAnswer(async () => { throw new KinFailure(classifyFailure({ message: '503' })); });
  await h.run(T0);
  assert.equal(h.asked.length, 2);
  assert.deepEqual(h.sleeps, []);
});

test('the beat stops starting questions when there is no room left in the run; the rest are first next time', async () => {
  const kins = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase() }));
  const h = harness({ autoKins: kins, autoIntervalMinutes: 60 });
  let t = T0.getTime();
  h.setAnswer(async () => { t += 70_000; return '{"location":"in the kitchen"}'; }); // each question takes 70 s
  const out = await h.run(() => new Date(t));
  assert.equal(RUN_BUDGET_MS - ASK_BUDGET_MS, 125_000);
  assert.equal(h.asked.length, 2, 'two questions fit (0 s and 70 s); a third would start at 140 s, too late');
  assert.match(out.message, /1 more next time/);
  assert.equal(out.ok, true);
  const third = await h.readings.get('c');
  assert.equal(third, null, 'the Kin that was not asked was not marked as attempted');
  await h.run(plus(5));
  assert.ok(h.asked.includes('c'), 'and it goes on the next beat');
});

test('a stored reading that cannot be READ is not overwritten: that Kin is skipped, the others go on', async () => {
  const h = harness({ autoKins: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  await h.run(T0); // both read once
  const realGet = h.storage.get.bind(h.storage);
  h.storage.get = async (k) => { if (k.includes(':reading:a')) throw new Error('Could not read cs/reading-a.json: disk error'); return realGet(k); };
  const before = h.asked.length;
  const out = await h.run(plus(60));
  assert.deepEqual(h.asked.slice(before), ['b'], 'only the readable Kin is asked');
  assert.match(out.message, /1 skipped \(stored reading unreadable\)/);
  h.storage.get = realGet;
  assert.equal((await h.readings.get('a')).location, 'In the kitchen.', 'the good sentences of the skipped Kin are untouched');
});

test('unreadable SETTINGS (a storage failure, not "off") fail the run with a clear line and ask nobody', async () => {
  const h = harness();
  await h.ready;
  h.storage.get = async () => { throw new Error('Could not read cs/settings.json: network blip'); };
  const out = await h.run(T0);
  assert.equal(out.ok, false);
  assert.match(out.message, /Could not read the settings: .*network blip/);
  assert.equal(h.asked.length, 0);
});

test('KinFilesStorage: a failed read of an existing file is an error, a missing file is null, and the run reports it', async () => {
  const files = new Map();
  let failReads = false;
  const run = async (args, { input } = {}) => {
    const [, cmd, path] = args;
    if (cmd === 'put') { files.set(path, input); return { code: 0, stdout: '', stderr: '' }; }
    if (cmd === 'get') return failReads ? { code: 2, stdout: '', stderr: 'network blip' } : files.has(path) ? { code: 0, stdout: files.get(path), stderr: '' } : { code: 1, stdout: '', stderr: 'no such file' };
    if (cmd === 'ls') return { code: 0, stdout: [...files.keys()].join('\n'), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const storage = new KinFilesStorage(run);
  const s = new Settings(storage);
  await s.save({ autoUpdate: true, autoKins: [{ id: 'k', name: 'K' }] });
  failReads = true;
  const out = await handleRun({ event: { trigger: 'schedule' }, provider: { extract: async () => '{}' }, storage, clock: () => T0 });
  assert.equal(out.ok, false, 'a failed read is not "off"');
  assert.match(out.message, /Could not read the settings/);
});

test('afterAttempt: a failure never erases the last good sentences, and a claim changes neither count nor kind', () => {
  const good = afterAttempt(null, { now: T0, source: 'auto', sentences: { location: 'L.', doing: 'D.', outfit: 'O.' } });
  const f1 = afterAttempt(good, { now: plus(5), source: 'auto', error: 'down', kind: 'unavailable' });
  const claim = afterAttempt(f1, { now: plus(10), source: 'auto', sentences: null, error: f1.error, claim: true });
  assert.deepEqual([claim.failures, claim.errorKind, claim.location, claim.at], [1, 'unavailable', 'L.', T0.toISOString()]);
  const f2 = afterAttempt(claim, { now: plus(11), source: 'auto', error: 'down', kind: 'unavailable' });
  assert.equal(f2.failures, 2);
});

test('Settings: a failed save is taken back and reported, so the screen never claims what the run cannot see', async () => {
  const storage = new MemoryStorage();
  const s = new Settings(storage);
  await s.load();
  assert.equal(await s.save({ autoUpdate: true }), true);
  const real = storage.set.bind(storage);
  storage.set = async () => { throw new Error('the Workshop did not answer'); };
  assert.equal(await s.save({ autoUpdate: false, autoIntervalMinutes: 5 }), false);
  assert.equal(s.value.autoUpdate, true, 'taken back');
  assert.equal(s.value.autoIntervalMinutes, 15);
  storage.set = real;
  assert.equal(await s.save({ autoIntervalMinutes: 30 }), true, 'later saves still work');
  assert.equal(JSON.parse(await storage.get('clotheskin:v2:settings')).autoIntervalMinutes, 30);
  const strict = new Settings({ get: async () => { throw new Error('boom'); }, set: async () => {} });
  await assert.rejects(() => strict.load({ strict: true }), /boom/);
  assert.deepEqual((await strict.load()).autoUpdate, false, 'non-strict falls back to the defaults');
});
