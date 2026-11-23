// The real entry, run as Kindroid runs it: `node main.js` with the trigger on stdin and a `kin` command on the side
// (a stand-in that records every call). Covers what unit tests cannot: stdin, UTF-8 output, exit codes, kin end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fakeKin = fileURLToPath(new URL('./support/fake-kin-cli.mjs', import.meta.url));

function run(event, { options = {}, settings = { autoState: 'running', kinId: 'k1', tz: 'America/Sao_Paulo' }, bin = fakeKin, stdin, env = {}, initialStatus } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clotheskin-run-'));
  mkdirSync(join(dir, 'files'));
  if (initialStatus) writeFileSync(join(dir, 'files', 'status.json'), JSON.stringify(initialStatus));
  if (settings) writeFileSync(join(dir, 'files', 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(dir, 'options.json'), JSON.stringify(options));
  const r = spawnSync(process.execPath, ['main.js'], { cwd: root, input: stdin ?? JSON.stringify(event), encoding: 'utf8', env: { ...process.env, KIN_BIN: bin, FAKE_DIR: dir, ...env }, timeout: 20000 });
  const calls = existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const status = existsSync(join(dir, 'files', 'status.json')) ? JSON.parse(readFileSync(join(dir, 'files', 'status.json'), 'utf8')) : null;
  return { code: r.status, stderr: r.stderr, calls, status, ends: calls.filter((c) => c[0] === 'end') };
}

const ANSWER = '{“location”: “in the café”, “pose”: “sitting at a table”, “action”: “sipping a latte”, “topwear”: [“a white shirt”]}';

test('a scheduled run reads the Kin and saves the reading; the answer, split inside a UTF-8 character, is read whole', () => {
  const r = run({ trigger: 'schedule' }, { options: { answer: ANSWER } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.status.kins.k1.reading.location, 'In the café.');
  assert.equal(r.status.kins.k1.reading.doing, 'Sitting at a table, sipping a latte.');
  assert.equal(r.ends.length, 1, 'kin end exactly once');
  assert.deepEqual(r.ends[0], ['end', 'Status updated.']);
  const ask = r.calls.find((c) => c[0] === 'ask');
  assert.deepEqual(ask.slice(0, 3), ['ask', '--kin', 'k1']);
  assert.match(r.stderr, /\[clotheskin\] kin ask: \d+ characters in \d+ ms/, 'diagnostics on stderr');
  assert.ok(!r.stderr.includes('café'), 'never the scene in the logs');
});

test('the action from the screen reads the Kin it names', () => {
  const r = run({ trigger: 'action', action: 'update_status', input: { kin: 'k2', op: 'read' } }, { options: { answer: ANSWER }, settings: { autoState: 'stopped' } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.status.kins.k2.name, 'Bea Maria', 'the name comes from kin kins, not from the input');
  assert.deepEqual(r.ends, [['end', 'Status updated.']]);
});

test('Kindroid down: the run fails cleanly with kin end --failed, and the slowing down is saved', () => {
  const r = run({ trigger: 'schedule' }, { options: { askFails: 'Kindroid is under scheduled maintenance Authorization: Bearer CANARY_TEST_ONLY' } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0][1], '--failed');
  assert.match(r.ends[0][2], /Kindroid is under maintenance/);
  assert.doesNotMatch(JSON.stringify([r.status, r.ends, r.stderr]), /CANARY_TEST_ONLY/);
  assert.equal(r.status.kins.k1.errorKind, 'maintenance');
  assert.equal(r.calls.filter((c) => c[0] === 'ask').length, 1, 'maintenance is not tried again at once');
});

test('stdin that is not JSON still ends with kin end --failed', () => {
  const r = run(null, { stdin: 'not json' });
  assert.equal(r.code, 0);
  assert.deepEqual(r.ends, [['end', '--failed', 'Clotheskin was started with input that is not JSON.']]);
});

test('stdin that is JSON but not an object, or far too large, still ends with kin end --failed', () => {
  for (const stdin of ['3', 'null', '["schedule"]', `{"trigger":"schedule","pad":"${'x'.repeat(1100000)}"}`]) {
    const r = run(null, { stdin });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.ends.length, 1, 'kin end exactly once');
    assert.equal(r.ends[0][1], '--failed', stdin.slice(0, 20));
    assert.ok(!r.calls.some((c) => c[0] === 'ask'), 'nothing is asked');
  }
});

test('kin end failing: only a safe diagnostic reaches stderr', () => {
  const r = run({ trigger: 'schedule' }, { options: { answer: ANSWER, endFails: 'Authorization: Bearer CANARY_TEST_ONLY' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /kin end failed: service request failed/);
  assert.doesNotMatch(r.stderr, /the run meant to say|Isa|café|CANARY_TEST_ONLY|Authorization/i);
  assert.ok(!/node:internal|at .*\.js:\d+/.test(r.stderr), 'no stack trace');
});

test('no kin command at all: exit code 1 with a clear line, no crash', () => {
  const r = run({ trigger: 'schedule' }, { bin: '/nonexistent/kin' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /the kin command was not found/);
  assert.ok(!/node:internal|ErrnoException/.test(r.stderr), 'no stack trace');
});

test('a run that hangs is ended by main.js itself, with kin end --failed, before Kindroid would kill it', () => {
  const r = run({ trigger: 'schedule' }, { options: { askHangs: true }, env: { CLOTHESKIN_WATCHDOG_MS: '1500' } });
  assert.equal(r.code, 0);
  assert.deepEqual(r.ends, [['end', '--failed', 'Clotheskin ran out of time in this run. It tries again at the next start.']]);
  assert.match(r.stderr, /still running after 1\.5 s/);
});

test('a "not found" that is not kin\'s 404 is a failure: status.json is never written over', () => {
  const r = run({ trigger: 'schedule' }, { options: { answer: ANSWER, getFails: 'storage node not found' } });
  assert.equal(r.ends[0][1], '--failed');
  assert.match(r.ends[0][2], /Could not read the app's files/);
  assert.equal(r.calls.filter((c) => c[0] === 'files' && c[1] === 'put').length, 0);
});

const privateLook = {
  location: 'in the amber observatory', pose: 'sitting on a copper stool', action: 'polishing an astrolabe',
  topwear: ['a saffron vest'], hair: 'a lilac braid',
  makeup: { lips: 'coral lipstick', dream: 'forbidden comet', summary: 'private summary' },
};
const night = { wakeAt: '2099-01-01T08:00:00Z', until: '2099-01-01T07:50:00Z' };
const oldCard = { location: 'Cached location.', outfit: 'Cached outfit.', doing: 'Cached activity.' };

function originEvent(origin, op) {
  const input = { op, kin: 'k1' };
  if (origin === 'screen') return { trigger: 'action', action: 'update_status', input };
  return { trigger: 'action', action: 'update_status', kin: 'k1', input: { op, kin: 'k2' } };
}

for (const origin of ['screen', 'Kin']) {
  for (const tellLook of [false, true]) for (const tellDream of [false, true]) {
    test(`real entry with simulated ${origin} action: look=${tellLook}, dream=${tellDream}`, () => {
      const settings = { tellLook, tellDream };
      for (const op of ['read', 'wake']) {
        const event = originEvent(origin, op);
        const initialStatus = { diagnosticsVersion: 1, kins: { k1: {
          reading: oldCard, sleep: night, dream: { dream: 'Cached dream', remembered: 'all', at: new Date().toISOString() },
          note: 'private cached note', summary: { secret: 'private metadata' },
        } } };
        const answer = op === 'read' ? privateLook : { dream: 'A clockwork whale', remembered: 'most', summary: 'private summary', outfit: 'Cached outfit.' };
        const r = run(event, { initialStatus, settings, options: { answer: JSON.stringify(answer) } });
        assert.equal(r.code, 0, r.stderr);
        const look = op === 'read' && tellLook;
        const dream = op === 'wake' && tellDream;
        const expected = look ? 'Wearing a saffron vest. A lilac braid. Coral lipstick.'
          : dream ? 'A clockwork whale. Remembers most of it.' : 'Status updated.';
        assert.deepEqual(r.ends, [['end', expected]]);
        const deliveries = r.calls.filter(([verb]) => verb === 'tell');
        assert.equal(deliveries.length, look ? 3 : dream ? 1 : 0);
        for (const delivery of deliveries) assert.deepEqual(delivery.slice(1, 3), ['--kin', 'k1']);
        assert.doesNotMatch(JSON.stringify([r.ends, deliveries, r.stderr]), /observatory|stool|astrolabe|cached|forbidden comet|private summary|private metadata/i);
        assert.equal(r.status.kins.k2, undefined);
        if (op === 'read') {
          assert.match(r.status.kins.k1.reading.doing, /stool.*astrolabe/);
          assert.match(r.status.kins.k1.reading.location, /observatory/);
          assert.match(r.status.kins.k1.reading.hair, /lilac braid/);
          assert.equal(r.status.kins.k1.dream.dream, 'Cached dream');
        } else {
          assert.equal(r.status.kins.k1.dream.dream, answer.dream);
          assert.equal(r.status.kins.k1.reading.outfit, 'Cached outfit.');
          assert.equal(r.status.kins.k1.sleep, null);
        }
      }
    });
  }
}
