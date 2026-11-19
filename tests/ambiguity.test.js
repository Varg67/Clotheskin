// Ambiguity tests: for each way the Kin could misread the Workshop prompt, a plausible WRONG answer is fed
// through the real pipeline (parse -> validate -> apply) and we check what the app does with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { repo as makeRepo, byName, names, NOW } from './helpers.js';
import { handleRun } from '../run/actions.js';
import { HOST_CHAT_PROMPT, buildHostChatPrompt, KIN_ASK_BUDGET } from '../screen/src/core/prompt.js';
import { renderCompactContract } from '../screen/src/core/contract.js';
import { parseResponseText, validateDocument } from '../screen/src/core/validate.js';
import { createRecord, checkInvariants } from '../screen/src/core/model.js';

const clock = () => new Date(NOW);
const ask = (kin = 'isa') => ({ trigger: 'action', action: 'read_scene', input: { kin, name: 'Isa' } });
const answering = (x) => ({ extract: async () => (typeof x === 'string' ? x : JSON.stringify(x)) });
async function seeded() {
  const repo = makeRepo();
  await handleRun({ event: { trigger: 'action', action: 'update_scene', kin: 'isa', input: {
    state_updates: { location: 'living room at the shared house', position: 'sitting on the sofa', hair: 'loose' },
    item_changes: [{ op: 'wear', item_name: 'T-shirt', slot: 'topwear' }, { op: 'wear', item_name: 'jeans', slot: 'bottomwear' }, { op: 'wear', item_name: 'glasses', slot: 'eyes-accessory' }],
  } }, repo, provider: answering('{}'), clock });
  return repo;
}
const run = async (repo, reply) => handleRun({ event: ask(), repo, provider: answering(reply), clock });

// ---- 1. "Leave unmentioned details unknown": the Kin writes the word "unknown" instead of omitting the key
test('placeholders such as unknown / n/a / not mentioned never become values', async () => {
  const repo = makeRepo();
  const out = await run(repo, { state_updates: { makeup: 'unknown', hair: 'not mentioned', position: 'n/a', location: 'unspecified' } });
  assert.equal(out.ok, true);
  const rec = await repo.getRecord('isa');
  for (const f of ['makeup', 'hair', 'position', 'location']) assert.equal(rec.fields[f].value, null, f);
});

test('"none" is a real value only for makeup; for hair, posture or place it is a placeholder', async () => {
  const repo = await seeded();
  await run(repo, { state_updates: { makeup: 'none', hair: 'none', position: 'none', location: 'none' } });
  const rec = await repo.getRecord('isa');
  assert.equal(rec.fields.makeup.value, 'none');
  assert.equal(rec.fields.hair.value, 'loose');
  assert.equal(rec.fields.position.value, 'sitting on the sofa');
  assert.equal(rec.fields.location.value, 'living room at the shared house');
});

// ---- 2. "position" / "location" are easy to swap
test('posture written into location, and place written into position, are not accepted', async () => {
  const repo = await seeded();
  const out = await run(repo, { state_updates: { position: 'in the kitchen', location: 'standing by the window' } });
  const rec = await repo.getRecord('isa');
  assert.equal(rec.fields.position.value, 'sitting on the sofa');
  assert.equal(rec.fields.location.value, 'living room at the shared house');
  assert.match(out.message, /2 change\(s\) skipped|needs? review|skipped/i);
  assert.ok(rec.unresolved.some((u) => /looks like a posture|looks like a place/.test(u.note)));
});

test('legitimate values with similar words still pass ("leaning in the doorway", "kitchen")', async () => {
  const repo = await seeded();
  await run(repo, { state_updates: { position: 'leaning in the doorway', location: 'kitchen' } });
  const rec = await repo.getRecord('isa');
  assert.equal(rec.fields.position.value, 'leaning in the doorway');
  assert.equal(rec.fields.location.value, 'kitchen');
});

// ---- 3. Slot names are obscure ("topunderwear", "bottom-accessory", "footunderwear")
test('common slot words the Kin may use instead of the identifiers are mapped', () => {
  const doc = { item_changes: [
    { op: 'wear', item_name: 'a', slot: 'top' }, { op: 'wear', item_name: 'b', slot: 'Bottom Wear' }, { op: 'wear', item_name: 'c', slot: 'top_underwear' },
    { op: 'wear', item_name: 'd', slot: 'shoes' }, { op: 'wear', item_name: 'e', slot: 'socks' }, { op: 'wear', item_name: 'f', slot: 'necklace' },
    { op: 'wear', item_name: 'g', slot: 'head accessory' }, { op: 'wear', item_name: 'h', slot: 'hat' },
    { op: 'wear', item_name: 'i', slot: 'topwear', covers: ['Bottom'] },
  ] };
  const v = validateDocument(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.doc.item_changes.map((c) => c.slot), ['topwear', 'bottomwear', 'topunderwear', 'footwear', 'footunderwear', 'neck-accessory', 'head-accessory', 'headwear', 'topwear']);
  assert.deepEqual(v.doc.item_changes[8].covers, ['bottomwear']);
});

test('a slot that cannot be understood still rejects the whole answer and keeps the saved data', async () => {
  const repo = await seeded();
  const before = await repo.getRecord('isa');
  const out = await run(repo, { state_updates: { hair: 'bun' }, item_changes: [{ op: 'wear', item_name: 'cape', slot: 'upper body armour' }] });
  assert.equal(out.ok, false);
  assert.match(out.message, /slot must be one of/);
  assert.deepEqual((await repo.getRecord('isa')).fields, before.fields);
});

// ---- 4. "Use known ids": the Kin invents or misplaces ids
test('an invented id with a name still resolves by name; a name placed in the id field resolves by name', async () => {
  const repo = await seeded();
  await run(repo, { item_changes: [{ op: 'change_condition', item_id: 't-shirt-999', item_name: 'T-shirt', condition: 'wet' }, { op: 'change_condition', item_id: 'jeans', condition: 'muddy' }] });
  const rec = await repo.getRecord('isa');
  assert.equal(byName(rec, 'T-shirt').condition, 'wet');
  assert.equal(byName(rec, 'jeans').condition, 'muddy');
});

test('an invented id with no name is skipped, not turned into a new item', async () => {
  const repo = await seeded();
  const n = Object.keys((await repo.getRecord('isa')).items).length;
  await run(repo, { item_changes: [{ op: 'change_condition', item_id: 'nonexistent-42', condition: 'torn' }] });
  assert.equal(Object.keys((await repo.getRecord('isa')).items).length, n);
});

test('an item first reported as an object and later worn becomes a real garment/accessory', async () => {
  const repo = makeRepo();
  await run(repo, { item_changes: [{ op: 'move', item_name: 'scarf', to: { type: 'scene', place: 'chair' } }] });
  await run(repo, { item_changes: [{ op: 'wear', item_name: 'scarf', slot: 'neck-accessory' }] });
  const rec = await repo.getRecord('isa');
  assert.equal(byName(rec, 'scarf').kind, 'accessory');
  assert.deepEqual(names(rec, 'neck-accessory'), ['scarf']);
});

// ---- 5. Net result vs history: the chat covers a day, the state was already processed
test('chronological history in the answer ends in the right place (put on, taken off, put on again)', async () => {
  const repo = await seeded();
  await run(repo, { item_changes: [
    { op: 'wear', item_name: 'jacket', slot: 'topwear' }, { op: 'remove', item_name: 'jacket', to: { type: 'scene', place: 'chair' } }, { op: 'wear', item_name: 'jacket', slot: 'topwear' },
  ] });
  const rec = await repo.getRecord('isa');
  assert.deepEqual(names(rec, 'topwear'), ['T-shirt', 'jacket']);
  assert.equal(Object.values(rec.items).filter((i) => i.name === 'jacket').length, 1);
  assert.deepEqual(checkInvariants(rec), []);
});

test('re-reporting what the state already says is a no-op (no history noise, no duplicates)', async () => {
  const repo = await seeded();
  const before = await repo.getRecord('isa');
  const out = await run(repo, { state_updates: { hair: 'loose', position: 'sitting on the sofa' }, item_changes: [{ op: 'wear', item_name: 'T-shirt', slot: 'topwear' }, { op: 'wear', item_name: 'jeans', slot: 'bottomwear' }] });
  assert.match(out.message, /No changes found/);
  const after = await repo.getRecord('isa');
  assert.deepEqual(after.clothing, before.clothing);
  assert.deepEqual(after.items, before.items);
});

// ---- 6. Output format slips
test('the Kin adds extra keys (notes, explanation): ignored with a warning, the real changes still apply', async () => {
  const repo = await seeded();
  const out = await run(repo, { state_updates: { hair: 'bun' }, item_changes: [{ op: 'wear', item_name: 'cap', slot: 'headwear', color: 'red' }], notes: 'she also looked tired', unresolved: [] });
  assert.equal(out.ok, true);
  const rec = await repo.getRecord('isa');
  assert.equal(rec.fields.hair.value, 'bun');
  assert.deepEqual(names(rec, 'headwear'), ['cap']);
  assert.ok(rec.history.at(-1).skipped.some((s) => /Ignored/.test(s) && /notes/.test(s)));
});

test('type mistakes are still errors (a wrong type must not be guessed at)', () => {
  assert.equal(validateDocument({ state_updates: { hair: 5 } }).ok, false);
  assert.equal(validateDocument({ item_changes: [{ op: 'wear', item_name: 'x', slot: 'topwear', pockets: 'left' }] }).ok, false);
});

test('single operation instead of an array, and a lone unresolved string, are accepted', () => {
  const v = validateDocument({ item_changes: { op: 'remove', item_name: 'coat' }, unresolved: 'two coats, unclear which' });
  assert.equal(v.ok, true);
  assert.equal(v.doc.item_changes.length, 1);
  assert.deepEqual(v.doc.unresolved, ['two coats, unclear which']);
  assert.equal(validateDocument({ item_changes: 'none' }).ok, false);
});

test('trailing commas and curly quotes (common slips) are repaired; real garbage is not', () => {
  assert.ok(parseResponseText('{"state_updates":{"hair":"bun",},"item_changes":[],}').ok);
  assert.ok(parseResponseText('{“state_updates”:{“hair”:“bun”}}').ok);
  assert.ok(parseResponseText('Sure! {"state_updates":{"hair":"bun"}} Hope that helps').ok);
  assert.equal(parseResponseText('{"state_updates": {hair: bun').ok, false);
  const apostrophe = parseResponseText('{"state_updates":{"location":"Isa’s room"}}');
  assert.equal(apostrophe.value.state_updates.location, 'Isa’s room', 'a legitimate curly apostrophe is kept');
});

// ---- 7. The wording itself: each ambiguous idea must be pinned down in the text the Kin reads
test('the prompt pins down the ambiguous ideas', () => {
  const rec = createRecord('k');
  const p = buildHostChatPrompt({ profile: { id: 'k', name: 'Isa' }, record: rec });
  assert.ok(p.length <= KIN_ASK_BUDGET);
  const must = [
    [/position = body posture only/, 'position means posture'],
    [/location = the place/, 'location means place'],
    [/never colou?r/, 'hair is style/condition, not colour'],
    [/exact wording of a known place or item/, 'reuse names so places and items match'],
    [/net result, not the history/, 'net result, not history'],
    [/changes clothes, report each item taken off/, 'changing clothes means removals'],
    [/only if your replies went along with it/, "the person's narration about you needs your acceptance"],
    [/do not write unknown, none or n\/a/, 'no placeholder values'],
    [/T-shirts/, 'topwear examples'],
    [/bra, undershirt, underpants only/, 'underwear means intimate garments only'],
    [/after the last message, using the whole recent chat/, '"as of the last message" is not "only the last message"'],
  ];
  for (const [re, why] of must) assert.match(p, re, why);
  assert.ok(!/as of the last message/.test(HOST_CHAT_PROMPT), 'old wording that could mean "only the last message"');
  assert.ok(renderCompactContract().includes('topwear ='));
});
