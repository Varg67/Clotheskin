import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTFIT_PROMPT, buildOutfitPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { WEAR_SLOTS } from '../screen/src/core/constants.js';
import { handleRun } from '../run/actions.js';
import { KinAskProvider } from '../run/kin-cli.js';
import { parseReading } from '../screen/src/core/outfit.js';
import { packReading } from '../run/actions.js';

// The run also says when it stored the reading; that is checked in prompt-run.test.js.
const noAt = ({ at, ...rest }) => { assert.match(at, /^\d{4}-\d\d-\d\dT/); return rest; };

const answering = (x) => ({ extract: async () => x });
const ev = (extra = {}) => ({ trigger: 'action', action: 'read_outfit', input: { kin: 'k1', name: 'Isa' }, ...extra });

test('the prompt demands English-only, concise, one-line JSON and pins down the ambiguous ideas', () => {
  const p = buildOutfitPrompt({ name: 'Isa' });
  assert.match(p, /^You are Isa\./);
  assert.match(p, /understand both, but answer in English only/);
  assert.match(p, /Be concise/);
  assert.match(p, /minified JSON only, on one line/);
  assert.match(p, /Apply later changes: something taken off is no longer worn/);
  assert.match(p, /Ignore plans, wishes and hypothetical outfits/);
  assert.match(p, /never guess/);
  assert.match(p, /If the chat says nothing about any of this, answer \{\}/);
  assert.match(p, /where you are, how you are positioned, what you are doing, what you are wearing and how your hair and makeup look/);
  assert.match(p, /"location": where you are right now, as a short phrase starting with in, at or on/);
  assert.match(p, /The place only, not your posture/);
  assert.match(p, /planning to go somewhere is not being there/);
  assert.match(p, /a place you have left is no longer where you are/);
  assert.match(p, /bra, undershirt, underpants only/);
  for (const slot of WEAR_SLOTS) assert.ok(p.includes(slot), slot);
  assert.ok(!p.includes('{{'), 'no unfilled placeholder');
});

test('the example inside the prompt has the valid format, but sent back unchanged it is a copy, not a reading', () => {
  const example = OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1];
  assert.match(parseReading(example).error, /copied the example/);
  // the same shape with the Kin's own values is a valid answer
  const p = parseReading(example.replace('flipping through a book', 'reading a novel').replace('a grey hoodie', 'a red hoodie').replace('black leggings', 'blue jeans').replace('white sneakers', 'boots').replace('a loose braid', 'a bun'));
  assert.equal(p.ok, true);
  assert.equal(p.location, 'at a bookstore');
  assert.equal(p.pose, 'standing by a shelf');
  assert.equal(p.action, 'reading a novel');
  assert.deepEqual(Object.keys(p.outfit), ['topwear', 'bottomwear', 'footwear']);
  assert.deepEqual(p.warnings, []);
});

test('Workshop prompt has no chat block (the Kin sees its own chat); local prompt carries the pasted chat verbatim', () => {
  assert.ok(!buildOutfitPrompt({ name: 'Isa' }).includes('RECENT CHAT'));
  const chat = 'Isa: Visto um cardigan verde $& por cima da camiseta.\nUser: ok';
  const p = buildOutfitPrompt({ name: 'Isa', chat });
  assert.ok(p.includes(`RECENT CHAT:\n${chat}\n`));
});

test('the question is small: far below the 8,000 character limit, even with a long name', () => {
  const p = buildOutfitPrompt({ name: 'N'.repeat(500) });
  assert.ok(p.length < 3500, `${p.length}`);
  assert.ok(p.length < KIN_ASK_LIMIT);
  assert.ok(!p.includes('N'.repeat(61)), 'long names are cut');
});

test('read_outfit: the Kin is asked by id; the outfit comes back as one sentence', async () => {
  let asked;
  const provider = { extract: async (a) => { asked = a; return '{"location":"in the living room","topwear":["a perfumed white shirt","a leather jacket"],"bottomwear":["blue jeans"]}'; } };
  const out = await handleRun({ event: ev(), provider });
  assert.equal(out.ok, true);
  assert.deepEqual(noAt(JSON.parse(out.message)), { location: 'In the living room.', doing: 'No pose or action described in the recent chat.', outfit: 'Wearing a leather jacket, a perfumed white shirt and blue jeans.' });
  assert.equal(asked.kinId, 'k1');
  assert.match(asked.prompt, /^You are Isa\./);
});

test('a Kin that has not said anything gives two calm sentences, not an error', async () => {
  const out = await handleRun({ event: ev(), provider: answering('{}') });
  assert.equal(out.ok, true);
  assert.deepEqual(noAt(JSON.parse(out.message)), { location: 'No location described in the recent chat.', doing: 'No pose or action described in the recent chat.', outfit: 'No outfit described in the recent chat.' });
});

test('a bad location type fails the whole reading clearly; nothing is invented', async () => {
  const out = await handleRun({ event: ev(), provider: answering('{"location":42,"topwear":["a shirt"]}') });
  assert.equal(out.ok, false);
  assert.match(out.message, /"location" must be a text/);
});

test('the Kin answering in character fails clearly and nothing is invented', async () => {
  const out = await handleRun({ event: ev(), provider: answering('*laughs* Oh, a form? Silly!') });
  assert.equal(out.ok, false);
  assert.match(out.message, /not valid JSON/);
  assert.match(out.message, /Nothing was changed/);
});

test('the Kin id may come from the platform (a Kin used the action) or from the input', async () => {
  let id;
  const p = { extract: async ({ kinId }) => { id = kinId; return '{}'; } };
  await handleRun({ event: { trigger: 'action', action: 'read_outfit', kin: 'from-platform', input: {} }, provider: p });
  assert.equal(id, 'from-platform');
  assert.match((await handleRun({ event: { trigger: 'action', action: 'read_outfit', input: {} }, provider: p })).message, /No Kin/);
});

test('unknown action, unsupported trigger and provider failure are reported in one clear line', async () => {
  assert.match((await handleRun({ event: { trigger: 'action', action: 'nope', input: { kin: 'k' } }, provider: answering('{}') })).message, /Unknown action/);
  assert.match((await handleRun({ event: { trigger: 'inbound' }, provider: answering('{}') })).message, /Unsupported trigger/);
  const failing = { extract: async () => { throw new Error('The Kin could not be asked: grant missing'); } };
  const out = await handleRun({ event: ev(), provider: failing });
  assert.equal(out.ok, false);
  assert.match(out.message, /grant missing/);
});

test('the line given back is JSON with both sentences and never exceeds the 500 characters kin end allows', async () => {
  const many = JSON.stringify({ location: 'at a very long named place in the middle of a big city', topwear: Array.from({ length: 8 }, (_, i) => `a very long descriptive jacket number ${i} with details`), 'neck-accessory': Array.from({ length: 8 }, (_, i) => `a very long descriptive necklace number ${i}`) });
  const out = await handleRun({ event: ev(), provider: answering(many) });
  assert.ok(out.message.length <= 500, `${out.message.length}`);
  const o = JSON.parse(out.message);
  assert.equal(o.location, 'At a very long named place in the middle of a big city.', 'the location is never cut');
  assert.match(o.outfit, /^Wearing a very long descriptive/);
  assert.ok(o.outfit.endsWith('…'), 'only the outfit is shortened, and it says so');
});

test('packReading leaves a short reading untouched and always returns valid JSON within the limit', () => {
  const short = { location: 'In the kitchen.', doing: 'Standing, chopping onions.', outfit: 'Wearing jeans.' };
  assert.deepEqual(JSON.parse(packReading(short)), short);
  for (const n of [1, 5, 20, 80]) {
    const p = packReading({ location: 'At the hospital.', doing: 'Sitting, waiting.', outfit: `Wearing ${Array.from({ length: n }, (_, i) => `piece ${i}`).join(', ')}.` });
    assert.ok(p.length <= 500);
    assert.doesNotThrow(() => JSON.parse(p));
  }
});

test('KinAskProvider passes the Kin id and prompt to kin ask and reports failures', async () => {
  let args;
  const ok = new KinAskProvider(async (a) => { args = a; return { code: 0, stdout: '{}', stderr: '' }; });
  assert.equal(await ok.extract({ prompt: 'P', kinId: 'kin-7' }), '{}');
  assert.deepEqual(args, ['ask', '--kin', 'kin-7', 'P']);
  const bad = new KinAskProvider(async () => ({ code: 4, stdout: '', stderr: 'grant missing' }));
  await assert.rejects(() => bad.extract({ prompt: 'P', kinId: 'x' }), /grant missing/);
});
