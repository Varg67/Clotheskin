import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Channel } from '../src/screen/channel.js';
import { buildScreen, stripCommentLines } from '../scripts/build-screen.mjs';

/** The page around the frame, speaking the guide's protocol; `deaf` ignores the first n messages (not listening yet). */
function page({ deaf = 0, kins = [{ id: 'k1', name: 'Isa' }], actionDelay = () => 5 } = {}) {
  const files = new Map();
  const posted = [];
  let listener = () => {};
  const send = (m, ms = 0) => setTimeout(() => listener(m), ms);
  const p = {
    files, posted, kins,
    channel: new Channel({
      post: (m) => {
        posted.push(m);
        if (posted.length <= deaf) return;
        if (m.kin === 'kins') send({ kin: 'kins', ok: true, kins: p.kins });
        if (m.kin === 'files.read') send({ kin: 'files.read', path: m.path, body: files.has(m.path) ? files.get(m.path) : null });
        if (m.kin === 'files.write') { files.set(m.path, m.body); send({ kin: 'files.write', path: m.path, ok: true }); }
        if (m.kin === 'action') send({ kin: 'action', name: m.name, ok: true, summary: `done for ${m.input.kin}` }, actionDelay(m));
      },
      subscribe: (fn) => { listener = fn; },
      timeouts: { connect: 400, resend: 20, read: 400, readResend: 20, write: 200, action: 400 },
    }),
    push: (list) => { p.kins = list; send({ kin: 'kins', ok: true, kins: list }); },
  };
  return p;
}

test('the handshake is sent again until the page listens (it may start after the frame)', async () => {
  const p = page({ deaf: 3 });
  assert.deepEqual(await p.channel.kins(), [{ id: 'k1', name: 'Isa' }]);
  assert.ok(p.posted.filter((m) => m.kin === 'kins').length >= 4);
  assert.equal(p.channel.heard, true);
  await assert.rejects(() => page({ deaf: 1e9 }).channel.kins(100), /Kindroid did not answer/);
});

test('the Kins list is cleaned: no id, no entry; no name, the id', async () => {
  const p = page({ kins: [{ id: 'a', name: ' Ana ' }, { name: 'ghost' }, null, { id: 'b' }] });
  assert.deepEqual(await p.channel.kins(), [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'b' }]);
  const seen = [];
  p.channel.onKins((l) => seen.push(l.map((k) => k.id)));
  p.push([{ id: 'c', name: 'Cy' }]);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, [['c']]);
});

test('reads: a missing file is null; a read is sent again until answered; two reads of one path share one answer', async () => {
  const p = page({ deaf: 2 });
  assert.equal(await p.channel.read('status.json'), null);
  p.files.set('status.json', '{"v":1}');
  const [a, b] = await Promise.all([p.channel.read('status.json'), p.channel.read('status.json')]);
  assert.deepEqual([a, b], ['{"v":1}', '{"v":1}']);
});

test('writes of one path go in order, so the last one written wins', async () => {
  const p = page();
  await Promise.all([p.channel.write('settings.json', '1'), p.channel.write('settings.json', '2'), p.channel.write('settings.json', '3')]);
  assert.equal(p.files.get('settings.json'), '3');
  assert.deepEqual(p.posted.filter((m) => m.kin === 'files.write').map((m) => m.body), ['1', '2', '3']);
});

test('actions run one at a time (a reply names only the action), so each answer reaches the click it belongs to', async () => {
  const p = page({ actionDelay: (m) => (m.input.kin === 'k1' ? 60 : 5) });
  const a = p.channel.action('update_status', { kin: 'k1' });
  const b = p.channel.action('update_status', { kin: 'k2' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.posted.filter((m) => m.kin === 'action').length, 1, 'the second waits for the first');
  assert.deepEqual(await a, { ok: true, summary: 'done for k1' });
  assert.deepEqual(await b, { ok: true, summary: 'done for k2' });
  await assert.rejects(() => page({ deaf: 1e9 }).channel.action('update_status', { kin: 'k1' }), /Kindroid did not answer/);
});

test('screen/app.js is the build of the sources (run npm run build after changing src/)', () => {
  assert.equal(readFileSync(new URL('../screen/app.js', import.meta.url), 'utf8'), buildScreen());
  const r = spawnSync(process.execPath, ['scripts/build-screen.mjs', '--check'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the screen is one classic script that older Safari can run, and keeps no data in the browser', () => {
  const html = readFileSync(new URL('../screen/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.ok(!/type="module"/.test(html));
  const js = readFileSync(new URL('../screen/app.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(js));
  assert.ok(!/^\s*(import|export)\b/m.test(js), 'no module syntax left');
  for (const [re, what] of [[/this\.#/, 'private fields'], [/\.at\(/, 'Array.at'], [/localStorage|sessionStorage|document\.cookie/, 'storage'], [/<dialog|showModal/, 'dialog']]) assert.ok(!re.test(js), what);
  const css = readFileSync(new URL('../screen/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // rules, not comments
  assert.ok(!/color-mix\(|:has\(|@container/.test(css), 'no CSS newer than Safari 14');
  assert.match(css, /min-height: 100vh; min-height: 100dvh/, 'dvh has a fallback');
});

test('the screen carries none of the answer reader (outfit.js, prompt.js): only the run reads the Kin\'s answers', () => {
  const app = readFileSync(new URL('../screen/app.js', import.meta.url), 'utf8');
  for (const f of ['src/core/outfit.js', 'src/core/prompt.js']) assert.ok(!app.includes(`__def("${f}"`), `${f} is in the screen`);
  assert.ok(app.length < 80000, `screen/app.js is ${app.length} characters`);
});

test('the screen\'s one file has no comment lines, and nothing inside a line of code is taken for a comment', () => {
  const code = [
    '// a line comment', '/**', ' * a block', ' */', 'const a = 1; // after code: kept',
    '/** @type {number} */', 'const b = 2;', "const re = /\\*[^*]+\\*/g; const url = 'http://x';", '  /* a block on its line */ const c = 3;',
  ].join('\n');
  assert.equal(stripCommentLines(code), ["const a = 1; // after code: kept", 'const b = 2;', "const re = /\\*[^*]+\\*/g; const url = 'http://x';", ' const c = 3;'].join('\n'));
});

test('a screen action waits for a pending preference write and will not use a rejected save', async () => {
  const p = page();
  const save = p.channel.write('settings.json', '{"tellLook":false}');
  const action = p.channel.action('update_status', { kin: 'k1' });
  await Promise.all([save, action]);
  assert.deepEqual(p.posted.map(m => m.kin), ['files.write', 'action']);

  const offline = page({ deaf: 100 });
  const outcomes = await Promise.allSettled([offline.channel.write('settings.json', '{}'), offline.channel.action('update_status', {})]);
  assert.ok(outcomes.every(r => r.status === 'rejected'));
  assert.deepEqual(offline.posted.map(m => m.kin), ['files.write']);
});
