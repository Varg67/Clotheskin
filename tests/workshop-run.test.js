import test from 'node:test';
import assert from 'node:assert/strict';
import { repo as makeRepo, byName, names, NOW } from './helpers.js';
import { handleRun } from '../run/actions.js';
import { KinFilesStorage, KinAskProvider } from '../run/kin-cli.js';
import { mergeManualEdit } from '../screen/src/core/apply.js';
import { KIN_ASK_LIMIT, KIN_ASK_BUDGET, buildHostChatPrompt } from '../screen/src/core/prompt.js';
import { checkInvariants } from '../screen/src/core/model.js';

const clock = () => new Date(NOW);
const askEvent = (kin, name = 'Isa') => ({ trigger: 'action', action: 'read_scene', input: { kin, name, pronouns: 'she/her' } });
const answer = (doc) => ({ extract: async () => (typeof doc === 'string' ? doc : JSON.stringify(doc)) });

test('read_scene: the Kin is asked about its own chat; no pasted messages in the prompt; fits kin ask', async () => {
  const repo = makeRepo();
  let seen;
  const provider = { extract: async ({ prompt, profile }) => { seen = { prompt, profile }; return JSON.stringify({ state_updates: { hair: 'bun' }, item_changes: [{ op: 'wear', item_name: 'green cardigan', slot: 'topwear' }] }); } };
  const out = await handleRun({ event: askEvent('kin-1'), repo, provider, clock });
  assert.equal(out.ok, true);
  assert.match(out.message, /hair: unknown → bun/);
  assert.ok(seen.prompt.length <= KIN_ASK_BUDGET, `${seen.prompt.length}`);
  assert.ok(!seen.prompt.includes('RECENT EXCHANGE'));
  assert.match(seen.prompt, /recent chat/);
  assert.match(seen.prompt, /yourself, Isa/);
  assert.equal(seen.profile.id, 'kin-1');
  const rec = await repo.getRecord('kin-1');
  assert.deepEqual(names(rec, 'topwear'), ['green cardigan']);
  assert.equal((await repo.getProfile('kin-1')).pronouns, 'she/her');
});

test('the Kin answering with narration around fenced JSON still works; answering in character does not corrupt data', async () => {
  const repo = makeRepo();
  const wrapped = '*smiles* Here you go!\n```json\n{"state_updates":{"position":"standing"},"item_changes":[]}\n```';
  assert.equal((await handleRun({ event: askEvent('k'), repo, provider: answer(wrapped), clock })).ok, true);
  const before = await repo.getRecord('k');
  const bad = await handleRun({ event: askEvent('k'), repo, provider: answer('*laughs* Oh, you want me to fill in a form? Silly!'), clock });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /not valid JSON/);
  const after = await repo.getRecord('k');
  assert.deepEqual(after.fields, before.fields);
  assert.match(after.lastError.message, /not valid JSON/);
});

test('update_scene: what the Kin reports goes through the same validator and is applied', async () => {
  const repo = makeRepo();
  const event = { trigger: 'action', action: 'update_scene', kin: 'kin-9', input: {
    state_updates: { location: 'hospital' },
    item_changes: [{ op: 'wear', item_name: 'scrubs', slot: 'topwear' }, { op: 'move', item_name: 'phone', to: { type: 'pocket', container_item_name: 'scrubs', pocket: 'left pocket' } }],
  } };
  const out = await handleRun({ event, repo, provider: answer('{}'), clock });
  assert.equal(out.ok, true);
  const rec = await repo.getRecord('kin-9');
  assert.equal(rec.fields.location.value, 'hospital');
  assert.equal(byName(rec, 'phone').place.type, 'pocket');
  assert.deepEqual(checkInvariants(rec), []);
  const bad = await handleRun({ event: { ...event, input: { item_changes: [{ op: 'wear', item_name: 'x', slot: 'cape' }] } }, repo, provider: answer('{}'), clock });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /slot must be one of/);
  assert.deepEqual(await repo.getRecord('kin-9').then((r) => r.fields.location.value), 'hospital');
});

test('scene_status is a plain English line of at most 500 characters, per Kin', async () => {
  const repo = makeRepo();
  await handleRun({ event: { trigger: 'action', action: 'update_scene', kin: 'a', input: { state_updates: { makeup: 'none', hair: 'low bun' }, item_changes: [{ op: 'wear', item_name: 'jeans', slot: 'bottomwear' }] } }, repo, provider: answer('{}'), clock });
  const a = await handleRun({ event: { trigger: 'action', action: 'scene_status', kin: 'a', input: {} }, repo, provider: answer('{}'), clock });
  const b = await handleRun({ event: { trigger: 'action', action: 'scene_status', kin: 'b', input: {} }, repo, provider: answer('{}'), clock });
  assert.match(a.message, /Wearing: Jeans\. .*Hair: low bun\. Makeup: none\./);
  assert.match(b.message, /Location: unknown\. Posture: unknown\. Wearing: unknown/);
  assert.ok(a.message.length <= 500);
});

test('missing Kin, unknown action and unsupported trigger fail with a clear line', async () => {
  const repo = makeRepo();
  assert.match((await handleRun({ event: { trigger: 'action', action: 'read_scene', input: {} }, repo, provider: answer('{}') })).message, /No Kin/);
  assert.match((await handleRun({ event: { trigger: 'action', action: 'nope', kin: 'a', input: {} }, repo, provider: answer('{}') })).message, /Unknown action/);
  assert.match((await handleRun({ event: { trigger: 'schedule' }, repo, provider: answer('{}') })).message, /Unsupported trigger/);
});

test('a manual edit saved by the screen while the Kin is still answering is not overwritten', async () => {
  const repo = makeRepo();
  await handleRun({ event: askEvent('kin-1'), repo, provider: answer({ state_updates: { location: 'living room' } }), clock });
  const provider = { extract: async () => {
    const original = await repo.getRecord('kin-1'); // the screen saves a correction during the slow answer
    const draft = structuredClone(original); draft.fields.location.value = 'kitchen';
    await repo.updateRecord('kin-1', null, (latest) => mergeManualEdit(latest, original, draft, { now: NOW }));
    return JSON.stringify({ state_updates: { location: 'garden', position: 'standing' } });
  } };
  const out = await handleRun({ event: askEvent('kin-1'), repo, provider, clock });
  assert.equal(out.ok, true);
  assert.match(out.message, /1 change\(s\) skipped/);
  const rec = await repo.getRecord('kin-1');
  assert.equal(rec.fields.location.value, 'kitchen');
  assert.equal(rec.fields.position.value, 'standing');
});

test('two Kins with the same name stay independent in the run', async () => {
  const repo = makeRepo();
  await handleRun({ event: askEvent('alex-1', 'Alex'), repo, provider: answer({ state_updates: { hair: 'long' } }), clock });
  await handleRun({ event: askEvent('alex-2', 'Alex'), repo, provider: answer({ state_updates: { hair: 'short' } }), clock });
  assert.equal((await repo.getRecord('alex-1')).fields.hair.value, 'long');
  assert.equal((await repo.getRecord('alex-2')).fields.hair.value, 'short');
});

test('a large wardrobe still fits in 8,000 characters; an impossible one fails with advice', async () => {
  const repo = makeRepo();
  const many = Array.from({ length: 60 }, (_, i) => ({ op: 'move', item_name: `gadget number ${i} with a long descriptive name`, to: { type: 'scene', place: `shelf ${i}` } }));
  await handleRun({ event: { trigger: 'action', action: 'update_scene', kin: 'k', input: { item_changes: many } }, repo, provider: answer('{}'), clock });
  let size = 0;
  const out = await handleRun({ event: askEvent('k'), repo, provider: { extract: async ({ prompt }) => { size = prompt.length; return '{}'; } }, clock });
  assert.equal(out.ok, true);
  assert.ok(size <= KIN_ASK_BUDGET, `${size}`);
});

test('KinFilesStorage: missing file is null, a failed read of an existing file is an error (never silently empty)', async () => {
  const files = new Map();
  const calls = [];
  const run = async (args, { input } = {}) => {
    calls.push(args.join(' '));
    const [, cmd, path] = args;
    if (cmd === 'put') { files.set(path, input); return { code: 0, stdout: '', stderr: '' }; }
    if (cmd === 'get') return files.has(path) ? { code: 0, stdout: files.get(path), stderr: '' } : { code: 1, stdout: '', stderr: 'no such file' };
    if (cmd === 'ls') return { code: 0, stdout: [...files.keys()].join('\n'), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const st = new KinFilesStorage(run);
  assert.equal(await st.get('some:key'), null);
  await st.set('some:key', '{"a":1}');
  assert.equal(await st.get('some:key'), '{"a":1}');
  const flaky = new KinFilesStorage(async (args) => (args[1] === 'get' ? { code: 2, stdout: '', stderr: 'network blip' } : run(args)));
  await assert.rejects(() => flaky.get('some:key'), /Could not read/);
});

test('KinAskProvider passes the Kin id and prompt to kin ask and reports failures', async () => {
  let args;
  const ok = new KinAskProvider(async (a) => { args = a; return { code: 0, stdout: '{"state_updates":{}}', stderr: '' }; });
  assert.equal(await ok.extract({ prompt: 'P', profile: { id: 'kin-7' } }), '{"state_updates":{}}');
  assert.deepEqual(args, ['ask', '--kin', 'kin-7', 'P']);
  const bad = new KinAskProvider(async () => ({ code: 4, stdout: '', stderr: 'grant missing' }));
  await assert.rejects(() => bad.extract({ prompt: 'P', profile: { id: 'x' } }), /grant missing/);
});

test('the question stays inside the budget (7,000), which is inside the hard limit (8,000), with a long name too', async () => {
  assert.ok(KIN_ASK_BUDGET < KIN_ASK_LIMIT);
  const { createRecord } = await import('../screen/src/core/model.js');
  const p = buildHostChatPrompt({ profile: { id: 'k', name: 'N'.repeat(500) }, record: createRecord('k') });
  assert.ok(p.length <= KIN_ASK_BUDGET, `${p.length}`);
  assert.ok(!p.includes('N'.repeat(61)), 'long names are cut');
});

test('a wardrobe too large for the budget fails with advice instead of sending a long question', async () => {
  const repo = makeRepo();
  const worn = Array.from({ length: 90 }, (_, i) => ({ op: 'wear', item_name: `layered piece number ${i} in dark green`, slot: ['topwear', 'bottomwear', 'footwear', 'neck-accessory', 'arms-accessory', 'head-accessory'][i % 6] }));
  await handleRun({ event: { trigger: 'action', action: 'update_scene', kin: 'big', input: { item_changes: worn } }, repo, provider: { extract: async () => '{}' }, clock });
  let asked = false;
  const out = await handleRun({ event: askEvent('big'), repo, provider: { extract: async () => { asked = true; return '{}'; } }, clock });
  assert.equal(out.ok, false);
  assert.equal(asked, false, 'nothing was sent');
  assert.match(out.message, /too large to send in one question/);
  assert.ok(out.message.length <= 500);
});
