import test from 'node:test';
import assert from 'node:assert/strict';
import { repo, profile, NOW, byName, names } from './helpers.js';
import { ReadCoordinator, ManualProvider } from '../src/core/reader.js';
import { mergeManualEdit, manualOp } from '../src/core/apply.js';
import { parseConversation } from '../src/core/messages.js';
import { checkInvariants } from '../src/core/model.js';

const wearDoc = (name, slot = 'topwear', extra = {}) => JSON.stringify({
  state_updates: extra.state_updates || {}, item_changes: [{ op: 'wear', item_name: name, slot }], unresolved: [],
});

async function setup() {
  const r = repo();
  await r.saveProfile(profile('alex-1', 'Alex'));
  await r.saveProfile(profile('alex-2', 'Alex'));
  const provider = new ManualProvider();
  const c = new ReadCoordinator({ repo: r, provider, clock: () => new Date(NOW) });
  return { r, provider, c };
}

const tick = () => new Promise((res) => setTimeout(res, 0));

test('select-a-companion guard: no identity, no reading', async () => {
  const { c } = await setup();
  const res = await c.read({ profileId: null, messages: parseConversation('Alex: hi') });
  assert.equal(res.status, 'error');
  assert.match(res.message, /Select a companion/);
});

test('invalid JSON preserves saved data and stores a readable error', async () => {
  const { r, provider, c } = await setup();
  provider.preload(wearDoc('jacket'));
  await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: I wear a jacket'), force: true });
  const before = await r.getRecord('alex-1');
  provider.preload('{ not json');
  const res = await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: other'), force: true });
  assert.equal(res.status, 'error');
  const after = await r.getRecord('alex-1');
  assert.deepEqual(after.clothing, before.clothing);
  assert.deepEqual(after.items, before.items);
  assert.match(after.lastError.message, /not valid JSON/);
  assert.deepEqual(after.processedMessageIds, before.processedMessageIds); // failed messages stay unprocessed
});

test('contract violations preserve state and explain the error', async () => {
  const { r, provider, c } = await setup();
  provider.preload(JSON.stringify({ item_changes: [{ op: 'wear', item_name: 'x', slot: 'cape' }] }));
  const res = await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: hi') });
  assert.equal(res.status, 'error');
  assert.match(res.message, /slot must be one of/);
  assert.equal(Object.keys((await r.getRecord('alex-1')).items).length, 0);
});

test('each new message is processed once; manual re-read does not duplicate items', async () => {
  const { r, provider, c } = await setup();
  const msgs = parseConversation('Alex: I put on a green cardigan');
  provider.preload(wearDoc('green cardigan'));
  assert.equal((await c.read({ profileId: 'alex-1', messages: msgs })).status, 'ok');
  assert.equal((await c.read({ profileId: 'alex-1', messages: msgs })).status, 'nothing-new');
  provider.preload(wearDoc('green cardigan'));
  assert.equal((await c.read({ profileId: 'alex-1', messages: msgs, force: true })).status, 'ok');
  const rec = await r.getRecord('alex-1');
  assert.equal(Object.keys(rec.items).length, 1);
  assert.equal(rec.clothing.topwear.length, 1);
});

test('repeated clicks join the reading in flight', async () => {
  const { provider, c } = await setup();
  const msgs = parseConversation('Alex: hello');
  const a = c.read({ profileId: 'alex-1', messages: msgs });
  const b = c.read({ profileId: 'alex-1', messages: msgs });
  await tick();
  assert.equal(a, b); // the very same promise: no second reading was started
  provider.resolve(wearDoc('coat'));
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 'ok');
  assert.equal(rb.status, 'ok');
});

test('a manual location correction made during a reading survives the late response', async () => {
  const { r, provider, c } = await setup();
  const p = c.read({ profileId: 'alex-1', messages: parseConversation('Alex: moving') });
  await tick();
  // user corrects the location while the reading is pending
  const original = await r.getRecord('alex-1');
  const draft = structuredClone(original);
  draft.fields.location.value = 'kitchen';
  await r.updateRecord('alex-1', null, (latest) => mergeManualEdit(latest, original, draft, { now: NOW }));
  provider.resolve(JSON.stringify({ state_updates: { location: 'garden', position: 'standing' }, item_changes: [] }));
  const res = await p;
  assert.equal(res.status, 'ok');
  assert.equal(res.skipped.length, 1);
  const rec = await r.getRecord('alex-1');
  assert.equal(rec.fields.location.value, 'kitchen');
  assert.equal(rec.fields.location.source, 'manual');
  assert.equal(rec.fields.position.value, 'standing'); // untouched field still updates
});

test('a manual item edit made during a reading is not overwritten', async () => {
  const { r, provider, c } = await setup();
  provider.preload(wearDoc('jacket'));
  await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: jacket') });
  const p = c.read({ profileId: 'alex-1', messages: parseConversation('Alex: jacket is wet'), force: true });
  await tick();
  const original = await r.getRecord('alex-1');
  const draft = structuredClone(original);
  byName(draft, 'jacket').condition = 'torn';
  await r.updateRecord('alex-1', null, (latest) => mergeManualEdit(latest, original, draft, { now: NOW }));
  provider.resolve(JSON.stringify({ item_changes: [{ op: 'change_condition', item_name: 'jacket', condition: 'wet' }] }));
  const res = await p;
  assert.equal(res.skipped.length, 1);
  assert.equal(byName(await r.getRecord('alex-1'), 'jacket').condition, 'torn');
});

test('responses arriving out of order: only the newest ticket commits', async () => {
  const { r, provider, c } = await setup();
  const old = c.read({ profileId: 'alex-1', messages: parseConversation('Alex: first'), force: true });
  await tick();
  const oldTicket = provider.pending.ticket;
  const newer = c.read({ profileId: 'alex-1', messages: parseConversation('Alex: second'), force: true });
  await tick();
  provider.resolve(wearDoc('scarf', 'neck-accessory'));
  assert.equal((await newer).status, 'ok');
  assert.equal((await old).status, 'cancelled'); // superseded when replaced
  assert.ok(oldTicket.seq < (await newer).ticket.seq);
  const rec = await r.getRecord('alex-1');
  assert.deepEqual(names(rec, 'neck-accessory'), ['scarf']);
});

test('a stale answer from a superseded ticket is discarded by sequence even if the provider returns it', async () => {
  const { r, c } = await setup();
  const resolvers = [];
  const provider = { extract: () => new Promise((res) => resolvers.push(res)) };
  c.provider = provider;
  const first = c.read({ profileId: 'alex-1', messages: parseConversation('Alex: a'), force: true });
  await tick();
  const second = c.read({ profileId: 'alex-1', messages: parseConversation('Alex: b'), force: true });
  await tick();
  resolvers[1](wearDoc('new coat'));
  resolvers[0](wearDoc('old coat'));
  assert.equal((await second).status, 'ok');
  assert.equal((await first).status, 'discarded');
  const rec = await r.getRecord('alex-1');
  assert.deepEqual(names(rec, 'topwear'), ['new coat']);
});

test('two Kins named Alex: reading is bound to the first even after switching and renaming', async () => {
  const { r, provider, c } = await setup();
  await r.saveSettings({ selectedProfileId: 'alex-1' });
  provider.preload(wearDoc('blue shirt'));
  await c.read({ profileId: 'alex-2', messages: parseConversation('Alex: seed second') });
  const second = await r.getRecord('alex-2');
  const p = c.read({ profileId: 'alex-1', messages: parseConversation('Alex: takes coat') });
  await tick();
  await r.saveSettings({ selectedProfileId: 'alex-2' }); // UI switches to the second Alex
  await r.updateProfile('alex-1', (pr) => { pr.name = 'Alexander'; return pr; }); // first is renamed
  provider.resolve(wearDoc('black coat'));
  const res = await p;
  assert.equal(res.status, 'ok');
  assert.deepEqual(names(await r.getRecord('alex-1'), 'topwear'), ['black coat']);
  assert.deepEqual(await r.getRecord('alex-2'), second);
  assert.deepEqual(names(await r.getRecord('alex-2'), 'topwear'), ['blue shirt']);
  assert.equal((await r.getProfile('alex-1')).name, 'Alexander');
  assert.equal((await r.getRecord('alex-1')).history.length, 1);
});

test('group chat: only the selected companion is tracked; others keep their records', async () => {
  const r = repo();
  await r.saveProfile(profile('alex', 'Alex'));
  await r.saveProfile(profile('morgan', 'Morgan'));
  const provider = new ManualProvider();
  const c = new ReadCoordinator({ repo: r, provider, clock: () => new Date(NOW) });
  // seed: Alex wears a coat; Morgan has loose hair
  provider.preload(wearDoc('coat'));
  await c.read({ profileId: 'alex', messages: parseConversation('Alex: coat on') });
  provider.preload(JSON.stringify({ state_updates: { hair: 'loose' } }));
  await c.read({ profileId: 'morgan', messages: parseConversation('Morgan: hair down') });
  const morganBefore = await r.getRecord('morgan');
  const chat = parseConversation('Morgan: *ties her hair up*\nAlex: *takes off the coat*');
  let seenPrompt = '';
  c.provider = { extract: async ({ prompt }) => { seenPrompt = prompt; return JSON.stringify({ item_changes: [{ op: 'remove', item_name: 'coat' }] }); } };
  await c.read({ profileId: 'alex', messages: chat });
  assert.match(seenPrompt, /TARGET CHARACTER: Alex \(stable ID: alex\)/);
  assert.match(seenPrompt, /Morgan: \*ties her hair up\*/);
  const alex = await r.getRecord('alex');
  assert.deepEqual(alex.clothing.topwear, []);
  assert.equal(alex.fields.hair.value, null);
  assert.deepEqual(await r.getRecord('morgan'), morganBefore);
});

test('auto mode groups messages that arrive during a reading into one follow-up reading', async () => {
  const { r, c } = await setup();
  let calls = 0;
  const gates = [];
  c.provider = { extract: ({ prompt }) => { calls++; return new Promise((res) => gates.push({ prompt, res })); } };
  const m1 = parseConversation('Alex: one');
  const first = c.onKinResponseComplete({ profileId: 'alex-1', messages: m1 });
  await tick();
  const m2 = parseConversation('Alex: one\nAlex: two');
  const m3 = parseConversation('Alex: one\nAlex: two\nAlex: three');
  assert.equal((await c.onKinResponseComplete({ profileId: 'alex-1', messages: m2 })).status, 'queued');
  assert.equal((await c.onKinResponseComplete({ profileId: 'alex-1', messages: m3 })).status, 'queued');
  gates[0].res('{}');
  await tick(); await tick(); await tick();
  assert.equal(calls, 2); // one reading for everything queued, not three
  assert.match(gates[1].prompt, /Alex: two\nAlex: three/);
  assert.ok(!/RECENT EXCHANGE:[\s\S]*Alex: one\n/.test(gates[1].prompt));
  gates[1].res('{}');
  await first;
  await tick();
  assert.equal((await r.getRecord('alex-1')).processedMessageIds.length, 3);
});

test('demo responses only update the demo profile', async () => {
  const { r, provider, c } = await setup();
  await r.saveProfile(profile('demo-isa', 'Isa', { demo: true }));
  const doc = JSON.stringify({ meta: { demo: true, scene: 'x', target_id: 'demo-isa' }, state_updates: { hair: 'bun' } });
  provider.preload(doc);
  const res = await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: hi') });
  assert.equal(res.status, 'error');
  assert.match(res.message, /Demo responses only update the demo profile/);
  assert.equal((await r.getRecord('alex-1')).fields.hair.value, null);
  provider.preload(doc);
  assert.equal((await c.read({ profileId: 'demo-isa', messages: parseConversation('Isa: hi') })).status, 'ok');
});

test('a response written for another companion is rejected', async () => {
  const { r, provider, c } = await setup();
  provider.preload(JSON.stringify({ meta: { target_id: 'alex-2' }, state_updates: { hair: 'bun' } }));
  const res = await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: hi') });
  assert.equal(res.status, 'error');
  assert.equal((await r.getRecord('alex-1')).fields.hair.value, null);
});

test('manual editor: add, reorder, take off and re-wear keep invariants; reads merged around it', async () => {
  const { r, provider, c } = await setup();
  provider.preload(wearDoc('t-shirt'));
  await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: shirt') });
  const original = await r.getRecord('alex-1');
  const draft = structuredClone(original);
  manualOp(draft, { op: 'wear', item_name: 'denim jacket', slot: 'topwear' });
  manualOp(draft, { op: 'wear', item_name: 'sneakers', slot: 'footwear' });
  draft.clothing.topwear.reverse();
  // meanwhile a reading commits a change to a different slot
  provider.preload(wearDoc('cap', 'headwear'));
  await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: cap'), force: true });
  const { record, changed } = await r.updateRecord('alex-1', null, (latest) => mergeManualEdit(latest, original, draft, { now: NOW }));
  assert.ok(changed);
  const saved = await r.getRecord('alex-1');
  assert.deepEqual(names(saved, 'headwear'), ['cap']); // concurrent read preserved
  assert.deepEqual(names(saved, 'topwear'), ['denim jacket', 't-shirt']);
  assert.deepEqual(names(saved, 'footwear'), ['sneakers']);
  assert.deepEqual(checkInvariants(saved), []);
  assert.equal(saved.history.at(-1).source, 'manual');
});

test('persistence survives reopening: a new Repository over the same storage sees everything', async () => {
  const { r, provider, c } = await setup();
  provider.preload(wearDoc('scarf', 'neck-accessory', { state_updates: { hair: 'braid' } }));
  await c.read({ profileId: 'alex-1', messages: parseConversation('Alex: scarf') });
  const { Repository } = await import('../src/core/store.js');
  const reopened = new Repository(r.storage);
  const rec = await reopened.getRecord('alex-1');
  assert.deepEqual(names(rec, 'neck-accessory'), ['scarf']);
  assert.equal(rec.fields.hair.value, 'braid');
  assert.ok(rec.lastRead.at);
  assert.equal((await reopened.listProfiles()).length, 2);
});

test('records are scoped per conversation when the host provides one', async () => {
  const { r, provider, c } = await setup();
  provider.preload(wearDoc('coat'));
  await c.read({ profileId: 'alex-1', conversationId: 'chat-A', messages: parseConversation('Alex: a') });
  assert.deepEqual(names(await r.getRecord('alex-1', 'chat-A'), 'topwear'), ['coat']);
  assert.equal((await r.getRecord('alex-1', 'chat-B')).clothing.topwear, null);
  assert.equal((await r.getRecord('alex-1', null)).clothing.topwear, null);
});
