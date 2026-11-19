import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTFIT_PROMPT, buildOutfitPrompt, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { WEAR_SLOTS } from '../screen/src/core/constants.js';
import { handleRun } from '../run/actions.js';
import { KinAskProvider } from '../run/kin-cli.js';
import { parseOutfit } from '../screen/src/core/outfit.js';

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
  assert.match(p, /If the chat says nothing about what you wear, answer \{\}/);
  assert.match(p, /bra, undershirt, underpants only/);
  for (const slot of WEAR_SLOTS) assert.ok(p.includes(slot), slot);
  assert.ok(!p.includes('{{'), 'no unfilled placeholder');
});

test('the example inside the prompt is itself a valid answer', () => {
  const example = OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1];
  const p = parseOutfit(example);
  assert.equal(p.ok, true);
  assert.deepEqual(Object.keys(p.outfit), ['topwear', 'bottomwear', 'eyes-accessory']);
});

test('Workshop prompt has no chat block (the Kin sees its own chat); local prompt carries the pasted chat verbatim', () => {
  assert.ok(!buildOutfitPrompt({ name: 'Isa' }).includes('RECENT CHAT'));
  const chat = 'Isa: Visto um cardigan verde $& por cima da camiseta.\nUser: ok';
  const p = buildOutfitPrompt({ name: 'Isa', chat });
  assert.ok(p.includes(`RECENT CHAT:\n${chat}\n`));
});

test('the question is small: far below the 8,000 character limit, even with a long name', () => {
  const p = buildOutfitPrompt({ name: 'N'.repeat(500) });
  assert.ok(p.length < 2500, `${p.length}`);
  assert.ok(p.length < KIN_ASK_LIMIT);
  assert.ok(!p.includes('N'.repeat(61)), 'long names are cut');
});

test('read_outfit: the Kin is asked by id; the outfit comes back as one sentence', async () => {
  let asked;
  const provider = { extract: async (a) => { asked = a; return '{"topwear":["a perfumed white shirt","a leather jacket"],"bottomwear":["blue jeans"]}'; } };
  const out = await handleRun({ event: ev(), provider });
  assert.deepEqual(out, { ok: true, message: 'Wearing a leather jacket, a perfumed white shirt and blue jeans.' });
  assert.equal(asked.kinId, 'k1');
  assert.match(asked.prompt, /^You are Isa\./);
});

test('a Kin that has not said anything about clothes gives a calm sentence, not an error', async () => {
  assert.deepEqual(await handleRun({ event: ev(), provider: answering('{}') }), { ok: true, message: 'No outfit described in the recent chat.' });
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
  assert.match((await handleRun({ event: { trigger: 'schedule' }, provider: answering('{}') })).message, /Unsupported trigger/);
  const failing = { extract: async () => { throw new Error('The Kin could not be asked: grant missing'); } };
  const out = await handleRun({ event: ev(), provider: failing });
  assert.equal(out.ok, false);
  assert.match(out.message, /grant missing/);
});

test('the line given back never exceeds the 500 characters kin end allows', async () => {
  const many = JSON.stringify({ topwear: Array.from({ length: 8 }, (_, i) => `a very long descriptive jacket number ${i} with details`), 'neck-accessory': Array.from({ length: 8 }, (_, i) => `a very long descriptive necklace number ${i}`) });
  const out = await handleRun({ event: ev(), provider: answering(many) });
  assert.ok(out.message.length <= 500, `${out.message.length}`);
});

test('KinAskProvider passes the Kin id and prompt to kin ask and reports failures', async () => {
  let args;
  const ok = new KinAskProvider(async (a) => { args = a; return { code: 0, stdout: '{}', stderr: '' }; });
  assert.equal(await ok.extract({ prompt: 'P', kinId: 'kin-7' }), '{}');
  assert.deepEqual(args, ['ask', '--kin', 'kin-7', 'P']);
  const bad = new KinAskProvider(async () => ({ code: 4, stdout: '', stderr: 'grant missing' }));
  await assert.rejects(() => bad.extract({ prompt: 'P', kinId: 'x' }), /grant missing/);
});
