import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResponseText, validateDocument } from '../screen/src/core/validate.js';
import { buildPrompt, DEFAULT_EXTRACTION_PROMPT } from '../screen/src/core/prompt.js';
import { renderContract, OP_SPECS } from '../screen/src/core/contract.js';
import { WEAR_SLOTS, CLOTHING_SLOTS, ACCESSORY_SLOTS } from '../screen/src/core/constants.js';
import { DEMO_SCENES } from '../screen/src/demo/demo.js';
import { fresh, profile, run } from './helpers.js';
import { parseConversation } from '../screen/src/core/messages.js';

const SPEC_EXAMPLE = {
  state_updates: { hair: 'bun', position: 'standing' },
  item_changes: [{ op: 'wear', item_name: 'green cardigan', slot: 'topwear', over_item_name: 'T-shirt' }],
  unresolved: [],
};

test('the example response from the brief is valid under the contract', () => {
  assert.equal(validateDocument(SPEC_EXAMPLE).ok, true);
});

test('every demo response validates and the prompt example block stays in sync', () => {
  for (const s of DEMO_SCENES) {
    const p = parseResponseText(s.response);
    assert.ok(p.ok, s.id);
    const v = validateDocument(p.value);
    assert.ok(v.ok, `${s.id}: ${v.errors}`);
  }
});

test('slots exposed by the contract match the canonical identifiers', () => {
  assert.deepEqual(CLOTHING_SLOTS, ['headwear', 'topwear', 'topunderwear', 'bottomwear', 'bottomunderwear', 'footwear', 'footunderwear']);
  assert.equal(ACCESSORY_SLOTS.length, 12);
  assert.deepEqual(OP_SPECS.wear.fields.slot.values, WEAR_SLOTS);
  const text = renderContract();
  for (const s of WEAR_SLOTS) assert.ok(text.includes(s), s);
  for (const op of Object.keys(OP_SPECS)) assert.ok(text.includes(`op "${op}"`));
  assert.match(text, /hip region/);
});

test('structural errors reject the whole document with readable English messages', () => {
  const bad = [
    [{ item_changes: [{ op: 'teleport' }] }, /op must be one of/],
    [{ item_changes: [{ op: 'wear', item_name: 'x' }] }, /slot is required/],
    [{ item_changes: [{ op: 'wear', item_name: 'x', slot: 'cape' }] }, /slot must be one of/],
    [{ item_changes: [{ op: 'wear', slot: 'topwear' }] }, /needs "item_id" or "item_name"/],
    [{ item_changes: [{ op: 'move', item_name: 'x', to: { type: 'pocket' } }] }, /container_item/],
    [{ item_changes: [{ op: 'move', item_name: 'x', to: { type: 'moon' } }] }, /type must be one of/],
    [{ state_updates: { clothing: 'x' } }, /not supported/],
    [{ state_updates: { hair: null } }, /non-empty string/],
    [{ item_changes: 'none' }, /must be an array/],
    [{ unresolved: [1] }, /non-empty string/],
    [{ extra: 1 }, /Unsupported top-level key/],
    [{ item_changes: [{ op: 'wear', item_name: 'x', slot: 'topwear', color: 'red' }] }, /unsupported field "color"/],
  ];
  for (const [doc, re] of bad) {
    const v = validateDocument(doc);
    assert.equal(v.ok, false, JSON.stringify(doc));
    assert.match(v.errors.join(' '), re, JSON.stringify(doc));
  }
  assert.equal(validateDocument([]).ok, false);
});

test('empty collections are valid; missing keys count as empty', () => {
  assert.equal(validateDocument({ state_updates: {}, item_changes: [], unresolved: [] }).ok, true);
  assert.equal(validateDocument({}).ok, true);
});

test('response parsing accepts fences and surrounding text, and reports bad JSON', () => {
  assert.ok(parseResponseText('```json\n{"state_updates":{}}\n```').ok);
  assert.ok(parseResponseText('Here you go: {"state_updates":{}} thanks').ok);
  const bad = parseResponseText('{nope');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not valid JSON/);
  assert.equal(parseResponseText('  ').ok, false);
});

test('prompt injects contract, target, state and speaker-labelled messages without altering them', () => {
  const rec = run(fresh('kin-1'), { item_changes: [{ op: 'wear', item_name: 'jeans', slot: 'bottomwear' }] }).record;
  const messages = parseConversation('Morgan: prendo o cabelo $& num coque\nAlex: *takes off the coat*');
  const prompt = buildPrompt({ profile: profile('kin-1', 'Alex', { pronouns: 'they/them' }), record: rec, messages });
  assert.match(prompt, /TARGET CHARACTER: Alex \(stable ID: kin-1; pronouns: they\/them\)/);
  assert.match(prompt, /PREVIOUS STATE: \{"target":\{"id":"kin-1"/);
  assert.match(prompt, /Morgan: prendo o cabelo \$& num coque\nAlex: \*takes off the coat\*/);
  assert.match(prompt, /OPERATION CONTRACT/);
  assert.ok(!prompt.includes('{{'));
  assert.ok(DEFAULT_EXTRACTION_PROMPT.includes('Update the scene tracker for the target character'));
});

test('conversation parser keeps speakers, multi-line messages and original text', () => {
  const m = parseConversation('Isa: Visto um cardigan\nverde.\nUser: ok\nplain narration');
  assert.equal(m.length, 2);
  assert.equal(m[0].speaker, 'Isa');
  assert.equal(m[0].text, 'Visto um cardigan\nverde.');
  assert.equal(m[1].text, 'ok\nplain narration');
  assert.equal(parseConversation('Just narration here.')[0].speaker, 'Unidentified speaker');
  const again = parseConversation('Isa: Visto um cardigan\nverde.\nUser: ok\nplain narration');
  assert.deepEqual(again.map((x) => x.id), m.map((x) => x.id));
  const twins = parseConversation('Isa: ok\nIsa: ok');
  assert.notEqual(twins[0].id, twins[1].id);
});
