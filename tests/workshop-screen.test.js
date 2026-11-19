import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkshopChannel } from '../screen/src/host/channel.js';
import { WorkshopStorage } from '../screen/src/host/workshop.js';
import { keyToPath } from '../screen/src/host/paths.js';
import { Repository } from '../screen/src/core/store.js';
import { buildManifest } from '../scripts/build-manifest.mjs';
import { validateDocument } from '../screen/src/core/validate.js';
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

test('the Repository works unchanged over the Workshop files; removal writes an empty tombstone that reads as absent', async () => {
  const w = fakeWorkshop();
  const repo = new Repository(new WorkshopStorage(w.channel));
  await repo.saveProfile({ id: 'k1', name: 'Isa', places: [] });
  assert.equal((await repo.getProfile('k1')).name, 'Isa');
  const rec = await repo.getRecord('k1');
  rec.fields.hair.value = 'bun';
  await repo.putRecord(rec);
  assert.equal((await repo.getRecord('k1')).fields.hair.value, 'bun');
  assert.ok([...w.files.keys()].every((p) => /^cs\/[A-Za-z0-9._~-]+\.json$/.test(p)), 'safe paths');
  await new WorkshopStorage(w.channel).remove('clotheskin:v1:profile:k1');
  assert.equal(await repo.getProfile('k1'), null);
});

test('key to path never collides for ids with odd characters', () => {
  const a = keyToPath('clotheskin:v1:record:a:b::-');
  const b = keyToPath('clotheskin:v1:record:a_b::-');
  assert.notEqual(a, b);
  assert.match(a, /^cs\/clotheskin~3av1~3arecord~3aa~3ab~3a~3a-\.json$/);
});

test('kin.json is generated from the contract, within the guide limits, and the action schema accepts the brief example', () => {
  const m = buildManifest();
  assert.equal(readFileSync(new URL('../kin.json', import.meta.url), 'utf8'), `${JSON.stringify(m, null, 2)}\n`);
  assert.ok(m.name.length <= 40);
  assert.ok(m.purpose.length <= 200);
  assert.equal(m.run.entry, 'node main.js');
  assert.deepEqual(m.screens, [{ slot: 'panel', entry: 'screen/index.html', title: 'Clotheskin' }]);
  assert.equal(new Set(m.actions.map((a) => a.name)).size, m.actions.length);
  for (const a of m.actions) { assert.ok(a.description.split(/[.!?]\s/).length <= 3); assert.ok(a.by.every((b) => ['kin', 'user'].includes(b))); }
  assert.deepEqual(m.grants, ['kin:read', 'chat:read:1']);
  const schema = m.actions.find((a) => a.name === 'update_scene').input;
  assert.equal(schema.type, 'object');
  const example = { state_updates: { hair: 'bun', position: 'standing' }, item_changes: [{ op: 'wear', item_name: 'green cardigan', slot: 'topwear', over_item_name: 'T-shirt' }], unresolved: [] };
  assert.ok(validateDocument(example).ok);
  assert.ok(JSON.stringify(example).length < 16000);
  assert.deepEqual(Object.keys(schema.properties.item_changes.items.properties).includes('over_item_name'), true);
});
