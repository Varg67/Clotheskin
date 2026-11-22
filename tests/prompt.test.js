import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTFIT_PROMPT, buildOutfitPrompt, KIN_ASK_LIMIT } from '../src/core/prompt.js';
import { WEAR_SLOTS } from '../src/core/constants.js';
import { parseReading } from '../src/core/outfit.js';

test('the prompt demands English-only, concise, one-line JSON and pins down the ambiguous ideas', () => {
  const p = buildOutfitPrompt({ name: 'Isa' });
  assert.match(p, /^\[DIRECTIVE — OUT OF CHARACTER\. This is not a roleplay message/);
  assert.match(p, /\n\[END DIRECTIVE\] Your whole reply is one line of minified JSON in English: it starts with \{ and ends with \}\.$/);
  assert.match(p, /^Task: you are Isa\./m);
  assert.match(p, /English only: every key and value in English, whatever language the chat is in; translate it/);
  assert.ok(!/Portuguese/.test(p), 'any companion, any language: the question names no particular one');
  assert.match(p, /short noun phrases with article and key traits, at most 6 words/);
  assert.match(p, /minified JSON only, on one line/);
  assert.match(p, /Apply later changes: something taken off is no longer worn/);
  assert.match(p, /Ignore plans, wishes and hypothetical outfits/);
  assert.match(p, /never guess/);
  assert.match(p, /if the recent chat does not say it, leave that key out, and \{\} is a correct answer/);
  assert.match(p, /report where you are, your pose, what you are doing, what you are wearing, and your hair and makeup/);
  assert.match(p, /"location": the place only, at most 8 words, starting with in, at or on/);
  assert.match(p, /not your posture, activity or who is with you/);
  assert.match(p, /planning to go is not/);
  assert.match(p, /Not from your memories, journal, backstory or earlier days/);
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
  assert.equal(p.action, 'reading a novel');
  assert.equal(p.hair, 'a bun');
  assert.deepEqual(p.warnings, []);
});

test('the prompt carries no chat: the Kin sees its own (chat:read); a name with $& or braces is inserted as written', () => {
  const p = buildOutfitPrompt({ name: 'Isa $& {{name}}' });
  assert.ok(!/RECENT CHAT|\{\{/.test(p.replaceAll('{{name}}', '')));
  assert.match(p, /^Task: you are Isa \$& \{\{name\}\}\./m);
});

test('the question is small: far below the 8,000 character limit, even with a long name', () => {
  const p = buildOutfitPrompt({ name: 'N'.repeat(500) });
  assert.ok(p.length < 3500, `${p.length}`);
  assert.ok(p.length < KIN_ASK_LIMIT);
  assert.ok(!p.includes('N'.repeat(61)), 'long names are cut');
});
