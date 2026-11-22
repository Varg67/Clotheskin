import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../scripts/build-manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('kin.json is the generated manifest, within the guide\'s rules', () => {
  const m = buildManifest();
  assert.equal(readFileSync(join(root, 'kin.json'), 'utf8'), `${JSON.stringify(m, null, 2)}\n`);
  assert.equal(spawnSync(process.execPath, ['scripts/build-manifest.mjs', '--check'], { cwd: root }).status, 0);
  assert.equal(m.kin, 1);
  assert.ok(m.name.length <= 40);
  assert.ok(m.purpose.length <= 200, `${m.purpose.length}`);
  assert.equal(m.run.entry, 'node main.js', 'exactly node <file>, as a shared program must be');
  assert.deepEqual(m.triggers, [{ on: 'schedule', cron: '*/15 * * * *', tz: 'user' }]);
  assert.deepEqual(m.screens, [{ slot: 'panel', entry: 'screen/index.html', title: 'Clotheskin' }]);
  assert.deepEqual(m.actions.map((a) => [a.name, a.by]), [['update_status', ['user']]], 'one action, used by the person only');
  assert.deepEqual(m.grants, ['kin:read', 'chat:read:2'], 'nothing it does not use: no network, no voice, no pictures');
});

test('the repository is what a shared program may be: text files, no secrets, no node_modules, under 30 MB', () => {
  const files = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n');
  let total = 0;
  for (const f of files) {
    total += statSync(join(root, f)).size;
    assert.ok(!/^node_modules\//.test(f), f);
    assert.ok(!/\.(exe|dll|so|dylib|wasm|node|bin)$/i.test(f), `no compiled files: ${f}`);
    const text = readFileSync(join(root, f), 'utf8');
    assert.ok(!/kk_[A-Za-z0-9]{8,}/.test(text), `no key in ${f}`);
  }
  assert.ok(total < 30 * 1024 * 1024);
  assert.ok(files.includes('package-lock.json'), 'packages come from a lockfile (there are none, but npm ci must not fail)');
});

test('the sample/ folder is laid out like the data folder the screen reads', () => {
  assert.deepEqual(readdirSync(join(root, 'sample')).sort(), ['settings.json', 'status.json']);
  const status = JSON.parse(readFileSync(join(root, 'sample/status.json'), 'utf8'));
  const settings = JSON.parse(readFileSync(join(root, 'sample/settings.json'), 'utf8'));
  assert.ok(status.kins[settings.kinId].reading.outfit);
});

test('COMO-INSTALAR.md lists exactly the files Kindroid runs (the ones npm run pack packs)', () => {
  const guide = readFileSync(join(root, 'COMO-INSTALAR.md'), 'utf8');
  const listed = guide.split('## Os ')[1].split('```')[1].trim().split('\n').map((l) => l.trim()).sort();
  const runs = spawnSync('git', ['ls-files', 'kin.json', 'package.json', 'main.js', 'run', 'src/core', 'screen', 'sample'], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n').sort();
  assert.deepEqual(listed, runs);
  assert.match(guide, new RegExp(`## Os ${runs.length} arquivos`));
});

test('the run imports only files that Kindroid gets: nothing from tests/, dev/ or scripts/', () => {
  for (const f of ['main.js', 'run/kin.js', 'run/program.js', ...readdirSync(join(root, 'src/core')).map((x) => `src/core/${x}`)]) {
    const text = readFileSync(join(root, f), 'utf8');
    for (const [, spec] of text.matchAll(/^import .* from '([^']+)';$/gm)) {
      if (spec.startsWith('node:')) continue;
      const target = join(root, f, '..', spec).slice(root.length);
      assert.match(target, /^(main\.js|run\/|src\/core\/)/, `${f} imports ${spec}`);
    }
  }
});

test('the app\'s version is package.json\'s', async () => {
  const { APP_VERSION } = await import('../src/core/constants.js');
  assert.equal(APP_VERSION, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
});
