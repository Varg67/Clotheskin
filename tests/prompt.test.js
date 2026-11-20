import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTFIT_PROMPT, buildOutfitPrompt, KIN_ASK_LIMIT } from '../src/core/prompt.js';
import { WEAR_SLOTS } from '../src/core/constants.js';
import { parseReading } from '../src/core/outfit.js';

test('the prompt demands English-only, concise, one-line JSON and pins down the ambiguous ideas', () => {
  const p = buildOutfitPrompt({ name: 'Isa' });
  assert.match(p, /^You are Isa\./);
  assert.match(p, /understand both, but answer in English only/);
  assert.match(p, /Be concise/);
  assert.match(p, /minified JSON only, on one line/);
  assert.match(p, /Apply later changes: something taken off is no longer worn/);
  assert.match(p, /Ignore plans, wishes and hypothetical outfits/);
  assert.match(p, /never guess/);
  assert.match(p, /If the chat says nothing about either, answer \{\}/);
  assert.match(p, /where you are, how you are positioned, what you are doing and what you are wearing/);
  assert.match(p, /"location": where you are right now, as a short phrase starting with in, at or on/);
  assert.match(p, /The place only, not your posture/);
  assert.match(p, /planning to go somewhere is not being there/);
  assert.match(p, /a place you have left is no longer where you are/);
  assert.match(p, /bra, undershirt, underpants only/);
  for (const slot of WEAR_SLOTS) assert.ok(p.includes(slot), slot);
  assert.ok(!p.includes('{{'), 'no unfilled placeholder');
});

test('the example inside the prompt is itself a valid answer', () => {
  const example = OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1];
  const p = parseReading(example);
  assert.equal(p.ok, true);
  assert.equal(p.location, 'at a bookstore');
  assert.equal(p.pose, 'standing by a shelf');
  assert.equal(p.action, 'flipping through a book');
  assert.deepEqual(Object.keys(p.outfit), ['topwear', 'bottomwear', 'footwear']);
  assert.deepEqual(p.warnings, []);
});

test('the prompt carries no chat: the Kin sees its own (chat:read); a name with $& or braces is inserted as written', () => {
  const p = buildOutfitPrompt({ name: 'Isa $& {{name}}' });
  assert.ok(!/RECENT CHAT|\{\{/.test(p.replace('{{name}}', '')));
  assert.match(p, /^You are Isa \$& \{\{name\}\}\./);
});

test('the question is small: far below the 8,000 character limit, even with a long name', () => {
  const p = buildOutfitPrompt({ name: 'N'.repeat(500) });
  assert.ok(p.length < 3500, `${p.length}`);
  assert.ok(p.length < KIN_ASK_LIMIT);
  assert.ok(!p.includes('N'.repeat(61)), 'long names are cut');
});
