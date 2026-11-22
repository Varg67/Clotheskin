// The time Kindroid pays for at every start of the program (96 a day): the real entry, `node main.js`, with a stand-in
// `kin` that runs as a process of its own, as inside Kindroid (tests/support/fake-kin-cli.mjs). Budgets are generous:
// they catch a start that became much slower (a heavy import, a call too many), not a slow machine.
// Measured (docs/plano-de-refatoracao.md, phase 6 and the merge of the other line): ~110-150 ms per start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fakeKin = fileURLToPath(new URL('../support/fake-kin-cli.mjs', import.meta.url));

/** The median of 5 starts: { ms, calls } (calls: every kin call, kin end included). */
function start(settings) {
  const runs = Array.from({ length: 5 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'clotheskin-perf-'));
    mkdirSync(join(dir, 'files'));
    writeFileSync(join(dir, 'files', 'settings.json'), JSON.stringify(settings));
    writeFileSync(join(dir, 'files', 'status.json'), JSON.stringify({ kins: { k1: { name: 'Isa', lastRunAt: new Date().toISOString() } } }));
    writeFileSync(join(dir, 'options.json'), '{}');
    const t = process.hrtime.bigint();
    const r = spawnSync(process.execPath, ['main.js'], { cwd: root, input: '{"trigger":"schedule"}', encoding: 'utf8', env: { ...process.env, KIN_BIN: fakeKin, FAKE_DIR: dir } });
    assert.equal(r.status, 0, r.stderr);
    return { ms: Number(process.hrtime.bigint() - t) / 1e6, calls: readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').length };
  });
  return runs.sort((a, b) => a.ms - b.ms)[2];
}

// Every start reads both files, at once, even while stopped: an old dream must be erased within one start.
test('perf: a start while stopped is three kin calls (the two files at once, kin end) and ends quickly', () => {
  const r = start({ autoState: 'stopped', kinId: 'k1' });
  assert.equal(r.calls, 3);
  assert.ok(r.ms < 1500, `${r.ms.toFixed(0)} ms`);
});

test('perf: a start with nothing due is three kin calls and ends quickly', () => {
  const r = start({ autoState: 'running', kinId: 'k1', intervalS: 3600 });
  assert.equal(r.calls, 3);
  assert.ok(r.ms < 1500, `${r.ms.toFixed(0)} ms`);
});
