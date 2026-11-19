import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkshopChannel } from '../screen/src/host/channel.js';
import { WorkshopStorage } from '../screen/src/host/workshop.js';
import { keyToPath } from '../screen/src/host/paths.js';
import { Settings } from '../screen/src/core/store.js';
import { buildManifest } from '../scripts/build-manifest.mjs';
import { readFileSync } from 'node:fs';

/** A fake page around the frame, speaking the protocol from the Workshop guide. */
function fakeWorkshop({ kins = [{ id: 'k1', name: 'Isa' }], respond = true } = {}) {
  const files = new Map();
  let listener = () => {};
  const send = (m) => queueMicrotask(() => listener(m));
  const host = {
    files, kins, actionLog: [],
    channel: new WorkshopChannel({
      post: (m) => {
        if (!respond) return;
        if (m.kin === 'kins') send({ kin: 'kins', ok: true, kins: host.kins });
        if (m.kin === 'files.read') send({ kin: 'files.read', path: m.path, body: files.has(m.path) ? files.get(m.path) : null });
        if (m.kin === 'files.write') { files.set(m.path, m.body); send({ kin: 'files.write', path: m.path, ok: true }); }
        if (m.kin === 'action') { host.actionLog.push(m); send({ kin: 'action', name: m.name, ok: true, summary: `ran ${m.name}` }); }
      },
      subscribe: (fn) => { listener = fn; },
      timeouts: { kins: 30, file: 50, action: 50 },
    }),
    push: (list) => { host.kins = list; send({ kin: 'kins', ok: true, kins: list }); },
  };
  return host;
}

test('files: a missing file reads as null, written files read back, two reads of one path are answered in order', async () => {
  const w = fakeWorkshop();
  assert.equal(await w.channel.readFile('cs/a.json'), null);
  await w.channel.writeFile('cs/a.json', '{"x":1}');
  const [r1, r2] = await Promise.all([w.channel.readFile('cs/a.json'), w.channel.readFile('cs/a.json')]);
  assert.equal(r1, '{"x":1}'); assert.equal(r2, '{"x":1}');
});

test('kins: handshake returns the attached Kins; later pushes are delivered; no host means a clear rejection', async () => {
  const w = fakeWorkshop();
  assert.deepEqual(await w.channel.kins(), [{ id: 'k1', name: 'Isa' }]);
  const seen = [];
  w.channel.onKinsChange((l) => seen.push(l.map((k) => k.name)));
  w.push([{ id: 'k1', name: 'Isa' }, { id: 'k2', name: 'Alex' }]);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen.at(-1), ['Isa', 'Alex']);
  await assert.rejects(() => fakeWorkshop({ respond: false }).channel.kins(), /No Workshop host answered/);
  await assert.rejects(() => fakeWorkshop({ respond: false }).channel.readFile('cs/x.json'), /did not answer/);
});

test('actions: the screen can run an action and gets the summary line back', async () => {
  const w = fakeWorkshop();
  const r = await w.channel.runAction('read_scene', { kin: 'k1', name: 'Isa' });
  assert.deepEqual(r, { ok: true, summary: 'ran read_scene' });
  assert.deepEqual(w.actionLog[0].input, { kin: 'k1', name: 'Isa' });
});

test('actions: two readings for different Kins never swap results, even if the second run would finish first', async () => {
  // The reply names only the action, not the Kin, so the screen must not have two runs of one action in flight.
  let listener = () => {};
  const posted = [];
  const channel = new WorkshopChannel({
    post: (m) => {
      if (m.kin !== 'action') return;
      posted.push(m.input.kin);
      const slow = m.input.kin === 'kA';
      setTimeout(() => listener({ kin: 'action', name: m.name, ok: true, summary: `for ${m.input.kin}` }), slow ? 40 : 5);
    },
    subscribe: (fn) => { listener = fn; },
    timeouts: { action: 500 },
  });
  const a = channel.runAction('read_outfit', { kin: 'kA' });
  const b = channel.runAction('read_outfit', { kin: 'kB' });
  await new Promise((r) => setTimeout(r, 15)); // long enough for kB's answer, had it been posted
  assert.deepEqual(posted, ['kA'], 'the second run waits for the first');
  assert.equal((await a).summary, 'for kA');
  assert.equal((await b).summary, 'for kB');
  assert.deepEqual(posted, ['kA', 'kB']);
});

test('actions: a failed run does not block the next one', async () => {
  let listener = () => {};
  let answer = false;
  const channel = new WorkshopChannel({
    post: (m) => { if (answer) queueMicrotask(() => listener({ kin: 'action', name: m.name, ok: true, summary: 'done' })); },
    subscribe: (fn) => { listener = fn; },
    timeouts: { action: 20 },
  });
  await assert.rejects(() => channel.runAction('read_outfit', { kin: 'k1' }), /did not answer/);
  answer = true;
  assert.deepEqual(await channel.runAction('read_outfit', { kin: 'k1' }), { ok: true, summary: 'done' });
});

test('actions: a late reply to a run that timed out is not taken as the answer to the next run', async () => {
  let listener = () => {};
  const channel = new WorkshopChannel({ post: () => {}, subscribe: (fn) => { listener = fn; }, timeouts: { action: 20 } });
  const forKin = (kin) => ({ accept: (r) => { const k = JSON.parse(r.summary).kin; return k === undefined || k === kin; } });
  await assert.rejects(() => channel.runAction('read_outfit', { kin: 'ana' }, forKin('ana')), /did not answer/);
  const bia = channel.runAction('read_outfit', { kin: 'bia' }, forKin('bia'));
  await new Promise((r) => setTimeout(r, 5));
  listener({ kin: 'action', name: 'read_outfit', ok: true, summary: '{"kin":"ana","outfit":"late"}' }); // Ana's run, finally
  listener({ kin: 'action', name: 'read_outfit', ok: true, summary: '{"kin":"bia","outfit":"hers"}' });
  assert.equal(JSON.parse((await bia).summary).outfit, 'hers');
});

test('settings work unchanged over the Workshop files; they survive a new Settings instance (a reload)', async () => {
  const w = fakeWorkshop();
  const first = new Settings(new WorkshopStorage(w.channel));
  await first.load();
  await first.save({ theme: 'sage', selectedKinId: 'k1' });
  const second = new Settings(new WorkshopStorage(w.channel));
  await second.load();
  assert.equal(second.value.theme, 'sage');
  assert.equal(second.value.selectedKinId, 'k1');
  assert.ok([...w.files.keys()].every((p) => /^cs\/[A-Za-z0-9._~-]+\.json$/.test(p)), 'safe paths');
  assert.equal(w.files.size, 1, 'only the settings file exists: no outfit is stored');
});

test('key to path never collides for ids with odd characters', () => {
  const a = keyToPath('clotheskin:v1:record:a:b::-');
  const b = keyToPath('clotheskin:v1:record:a_b::-');
  assert.notEqual(a, b);
  assert.match(a, /^cs\/clotheskin~3av1~3arecord~3aa~3ab~3a~3a-\.json$/);
});

test('kin.json is generated, within the guide limits, with one user action and the grants the Kin question needs', () => {
  const m = buildManifest();
  assert.equal(readFileSync(new URL('../kin.json', import.meta.url), 'utf8'), `${JSON.stringify(m, null, 2)}\n`);
  assert.ok(m.name.length <= 40);
  assert.ok(m.purpose.length <= 200);
  assert.equal(m.run.entry, 'node main.js');
  assert.deepEqual(m.screens, [{ slot: 'panel', entry: 'screen/index.html', title: 'Clotheskin' }]);
  assert.deepEqual(m.actions.map((a) => [a.name, a.by]), [['read_outfit', ['user']]]);
  assert.deepEqual(m.grants, ['kin:read', 'chat:read:1']);
});
