import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutfit, describeOutfit, joinNatural, normalizeSlot, parseReading, describeReading, describeLocation, cleanLocation } from '../screen/src/core/outfit.js';
import { DEMO_SCENES } from '../screen/src/demo/demo.js';

const say = (json) => { const p = parseOutfit(typeof json === 'string' ? json : JSON.stringify(json)); assert.ok(p.ok, p.error); return describeOutfit(p.outfit); };

test('the brief example: perfumed white shirt, leather jacket, blue jeans become one sentence', () => {
  assert.equal(
    say({ topwear: ['a perfumed white shirt', 'a leather jacket'], bottomwear: ['blue jeans'] }),
    'Wearing a leather jacket, a perfumed white shirt and blue jeans.',
  );
});

test('commas and "and": one, two, three and four pieces', () => {
  assert.equal(joinNatural([]), '');
  assert.equal(joinNatural(['a']), 'a');
  assert.equal(joinNatural(['a', 'b']), 'a and b');
  assert.equal(joinNatural(['a', 'b', 'c', 'd']), 'a, b, c and d');
  assert.equal(say({ bottomwear: ['jeans'] }), 'Wearing jeans.');
});

test('branches are put in order: head, top, bottom, feet, then accessories, whatever order the JSON had', () => {
  const shuffled = { 'neck-accessory': ['a silver necklace'], footwear: ['white sneakers'], bottomwear: ['blue jeans'], 'eyes-accessory': ['glasses'], headwear: ['a cap'], topwear: ['a hoodie'] };
  assert.equal(say(shuffled), 'Wearing a cap, a hoodie, blue jeans and white sneakers, with glasses and a silver necklace.');
});

test('inside a branch the innermost piece is listed first in the JSON and named last in the sentence', () => {
  assert.equal(say({ topwear: ['a shirt', 'a sweater', 'a coat'] }), 'Wearing a coat, a sweater and a shirt.');
});

test('accessories and bags: with-clause; accessories alone get their own wording', () => {
  assert.equal(say({ topwear: ['a black dress'], bags: ['a brown backpack'], 'ears-accessory': ['small hoops'] }), 'Wearing a black dress, with small hoops and a brown backpack.');
  assert.equal(say({ 'eyes-accessory': ['round glasses'] }), 'Accessories: round glasses.');
});

test('underwear is only mentioned when there is nothing else to say about clothing', () => {
  assert.equal(say({ topwear: ['a shirt'], topunderwear: ['a bra'] }), 'Wearing a shirt.');
  assert.equal(say({ topunderwear: ['a black bra'], bottomunderwear: ['briefs'] }), 'Wearing a black bra and briefs.');
});

test('an empty answer means nothing was said, not an error', () => {
  assert.equal(say('{}'), 'No outfit described in the recent chat.');
  assert.equal(say({ topwear: [], bottomwear: null }), 'No outfit described in the recent chat.');
});

test('every demo scene produces its three sentences (or the documented error)', () => {
  const three = ({ location, doing, outfit }) => ({ location, doing, outfit });
  const full = Object.fromEntries(DEMO_SCENES.map((sc) => { const p = parseReading(sc.response); return [sc.id, p.ok ? describeReading(p) : `ERROR ${p.error}`]; }));
  const out = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, typeof v === 'string' ? v : three(v)]));
  assert.deepEqual([full['accessories-bag'].hair, full['accessories-bag'].makeup], ['Up in a messy bun.', 'Red lipstick.']);
  assert.deepEqual([full.travelling.hair, full.travelling.makeup], ['No hair described in the recent chat.', 'No makeup described in the recent chat.']);
  assert.deepEqual(out['pt-jeans-jacket'], { location: 'In the living room.', doing: 'Standing, adjusting her collar.', outfit: 'Wearing a leather jacket, a perfumed white shirt and blue jeans.' });
  assert.deepEqual(out['accessories-bag'], { location: 'At a café in Alfenas.', doing: 'Sitting at a table, sipping a latte.', outfit: 'Wearing a black dress and ankle boots, with round glasses, a silver necklace and a brown backpack.' });
  assert.deepEqual(out['taken-off'], { location: 'In the living room.', doing: 'Standing, taking off a cardigan.', outfit: 'Wearing a T-shirt and jeans.' });
  assert.deepEqual(out.travelling, { location: 'On the bus to the hospital.', doing: 'Scrolling on a phone.', outfit: 'Accessories: headphones.' });
  assert.deepEqual(out['plan-not-move'], { location: 'At home.', doing: 'Lounging on the sofa.', outfit: 'Wearing pyjamas.' });
  assert.deepEqual(out['pose-is-place'], { location: 'In the kitchen.', doing: 'Chopping onions.', outfit: 'No outfit described in the recent chat.' });
  assert.deepEqual(out['loose-keys'], { location: 'At the park.', doing: 'Walking around the park.', outfit: 'Wearing a striped sweater, sneakers and a cap, with a watch.' });
  assert.deepEqual(out['nothing-said'], { location: 'No location described in the recent chat.', doing: 'No pose or action described in the recent chat.', outfit: 'No outfit described in the recent chat.' });
  assert.match(out['in-character'], /^ERROR The answer is not valid JSON/);
});

// ---- ambiguity: plausible wrong answers from the Kin
test('placeholders never appear in the sentence', () => {
  assert.equal(say({ topwear: ['unknown'], bottomwear: ['n/a', 'none', 'not mentioned', 'no pants mentioned'], footwear: ['sandals'] }), 'Wearing sandals.');
});

test('slot words the Kin may use instead of the identifiers are understood', () => {
  assert.equal(normalizeSlot('Top Wear'), 'topwear');
  assert.equal(normalizeSlot('top_underwear'), 'topunderwear');
  assert.equal(normalizeSlot('shoes'), 'footwear');
  assert.equal(normalizeSlot('necklace'), 'neck-accessory');
  assert.equal(normalizeSlot('upper body armour'), undefined);
  assert.equal(say({ top: ['a tee'], bottom: ['shorts'], shoes: ['flip-flops'], glasses: ['sunglasses'] }), 'Wearing a tee, shorts and flip-flops, with sunglasses.');
});

test('a Kin that answers with "clothing" and "accessories" instead of slots is still understood', () => {
  assert.equal(say({ clothing: ['a striped sweater', 'jeans'], accessories: ['a watch'] }), 'Wearing a striped sweater and jeans, with a watch.');
});

test('a single string instead of a list, repeated pieces and trailing punctuation are tidied', () => {
  assert.equal(say({ bottomwear: 'blue jeans.', topwear: ['a shirt', 'A Shirt', 'a shirt;'] }), 'Wearing a shirt and blue jeans.');
});

test('unknown keys are ignored with a warning; a wrong value type is an error', () => {
  const ok = parseOutfit('{"topwear":["a shirt"],"mood":"tired","notes":["x"]}');
  assert.equal(ok.ok, true);
  assert.equal(ok.warnings.length, 2);
  assert.match(ok.warnings[0], /"mood" is not a slot/);
  const bad = parseOutfit('{"topwear":{"name":"shirt"}}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /"topwear" must be a text or a list of texts/);
  assert.equal(parseOutfit('{"topwear":[1,2]}').ok, false);
  assert.equal(parseOutfit('["a shirt"]').ok, false);
});

test('format slips are repaired: fences, narration around JSON, trailing commas, curly quotes', () => {
  const want = 'Wearing a shirt.';
  assert.equal(say('```json\n{"topwear":["a shirt"]}\n```'), want);
  assert.equal(say('*smiles* Here: {"topwear":["a shirt"]} hope it helps'), want);
  assert.equal(say('{"topwear":["a shirt",],}'), want);
  assert.equal(say('{“topwear”:[“a shirt”]}'), want);
});

test('answers that are not JSON at all fail with a readable English message', () => {
  for (const text of ['*giggles* I am wearing a red scarf, silly!', '', '   ', '{"topwear": [shirt']) {
    const p = parseOutfit(text);
    assert.equal(p.ok, false, text);
    assert.match(p.error, /empty|not valid JSON/);
  }
});

test('long or numerous pieces are capped, so a runaway answer cannot flood the card', () => {
  const many = Array.from({ length: 30 }, (_, i) => `piece ${i}`);
  const p = parseOutfit(JSON.stringify({ topwear: many, bottomwear: ['x'.repeat(500)] }));
  assert.equal(p.outfit.topwear.length, 8);
  assert.equal(p.outfit.bottomwear[0].length, 80);
});

test('a curly apostrophe inside a value is kept', () => {
  assert.equal(say('{"topwear":["Isa’s old band T-shirt"]}'), 'Wearing Isa’s old band T-shirt.');
});

// ---- hair and makeup
test('hair and makeup: one short phrase each, lists joined, slips repaired, nothing guessed', () => {
  const read = (o) => { const p = parseReading(JSON.stringify(o)); assert.ok(p.ok, p.error); return describeReading(p); };
  assert.deepEqual([read({ hair: 'long black hair in a ponytail', makeup: 'red lipstick and eyeliner' }).hair, read({ makeup: 'red lipstick and eyeliner' }).makeup], ['Long black hair in a ponytail.', 'Red lipstick and eyeliner.']);
  assert.equal(read({ makeup: ['mascara', 'pink lip gloss', 'blush'] }).makeup, 'Mascara, pink lip gloss and blush.');
  assert.equal(read({ hair: 'My hair is wet and loose.' }).hair, 'Wet and loose.');
  assert.equal(read({ Hairstyle: '*a messy bun*' }).hair, 'A messy bun.');
  for (const v of ['bare face', 'no makeup', 'No make-up', 'makeup-free']) assert.equal(read({ makeup: v }).makeup, 'No makeup.', v);
  for (const v of ['none', 'unknown', 'not mentioned', '']) assert.equal(read({ makeup: v }).makeup, 'No makeup described in the recent chat.', v);
  assert.equal(read({ hair: 'n/a' }).hair, 'No hair described in the recent chat.');
  assert.ok(read({ hair: 'x '.repeat(200) }).hair.length <= 102);
  const p = parseReading(JSON.stringify({ hair: 'a bun', topwear: ['a shirt'] }));
  assert.deepEqual(p.warnings, [], 'hair is not an unknown slot');
  assert.deepEqual(Object.keys(p.outfit), ['topwear'], 'hair is not clothing');
  assert.match(parseReading('{"hair":{"a":1}}').error, /"hair" must be a text/);
});
