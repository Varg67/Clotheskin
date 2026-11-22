// Ambiguity tests for the location question: plausible WRONG answers from the Kin go through the real pipeline
// (parseReading -> describeReading, and the whole run) and we check what the card would say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, describeReading } from '../src/core/outfit.js';
import { describeLocation, cleanLocation } from '../src/core/phrases.js';
import { OUTFIT_PROMPT, buildOutfitPrompt } from '../src/core/prompt.js';
import { runProgram } from '../run/program.js';
import { ACTION } from '../src/core/state.js';
import { fakeKindroid } from './support/fake-kindroid.js';
import { DEMO_SCENES } from '../dev/scenes.js';

const NONE = 'No location described in the recent chat.';
const where = (location) => { const p = parseReading(JSON.stringify({ location })); assert.ok(p.ok, p.error); return describeReading(p).location; };

// ---- 1. "The place only, not your posture or what you are doing": the Kin adds posture or activity anyway
test('posture or activity in front of the place is dropped; the place stays', () => {
  assert.equal(where('sitting on the sofa in the living room'), 'On the sofa in the living room.');
  assert.equal(where('standing by the window'), 'By the window.');
  assert.equal(where('lying in bed'), 'In bed.');
  assert.equal(where('cooking in the kitchen'), 'In the kitchen.');
  assert.equal(where('waiting at the bus stop'), 'At the bus stop.');
  assert.equal(where('arriving at the hospital'), 'At the hospital.');
});

test('an activity after the place is dropped too', () => {
  assert.equal(where('in the kitchen, cooking dinner'), 'In the kitchen.');
  assert.equal(where('at the library while listening to music'), 'At the library.');
  assert.equal(where('on the sofa, feeling tired'), 'On the sofa.');
  assert.equal(where('at a café and reading a book'), 'At a café.');
});

test('a posture with no place in it is "nothing stated", never a made-up place', () => {
  assert.equal(where('sitting alone'), NONE);
  assert.equal(where('standing'), NONE);
  assert.equal(where('sleeping'), NONE);
});

test('real travelling phrases survive: they are places in this tracker', () => {
  assert.equal(where('heading to work'), 'Heading to work.');
  assert.equal(where('walking to the bus stop'), 'Walking to the bus stop.');
  assert.equal(where('returning home'), 'Returning home.');
  assert.equal(where('on the way to the hospital'), 'On the way to the hospital.');
  assert.equal(where('driving to the beach'), 'Driving to the beach.');
});

// ---- 2. Clothes leak into the location
test('clothes mentioned inside the location are cut off', () => {
  assert.equal(where('in the kitchen wearing a robe'), 'In the kitchen.');
  assert.equal(where('at home, dressed in pyjamas'), 'At home.');
});

// ---- 3. Every other value in the answer is an array, so the Kin may answer location as an array
test('location given as a list is joined; a list with non-text is an error', () => {
  assert.equal(where(['in the living room', 'at the shared house']), 'In the living room, at the shared house.');
  assert.equal(where(['in the kitchen']), 'In the kitchen.');
  assert.equal(where([]), NONE);
  assert.equal(parseReading('{"location":["in the kitchen",5]}').ok, false);
  assert.equal(parseReading('{"location":{"room":"kitchen"}}').ok, false);
  assert.equal(parseReading('{"location":7}').ok, false);
});

// ---- 4. The Kin names the key differently
test('place / where / current_location are understood as the location key, in any case', () => {
  for (const key of ['place', 'where', 'current_location', 'Current Location', 'currentLocation', 'LOCATION']) {
    const p = parseReading(JSON.stringify({ [key]: 'at the gym', topwear: ['a tank top'] }));
    assert.equal(p.location, 'at the gym', key);
    assert.deepEqual(p.warnings, [], `${key} must not be reported as an unknown key`);
    assert.deepEqual(Object.keys(p.outfit), ['topwear']);
  }
});

// ---- 5. Markdown, quotes and wrappers from a roleplay habit
test('asterisks, quotes, brackets and trailing punctuation around the place are removed', () => {
  assert.equal(where('*in the kitchen*'), 'In the kitchen.');
  assert.equal(where('"at the beach"'), 'At the beach.');
  assert.equal(where('(at home)'), 'At home.');
  assert.equal(where('at the park!!'), 'At the park.');
  assert.equal(where('_on the balcony_'), 'On the balcony.');
});

// ---- 6. The Kin answers in Portuguese, despite "English only"
test('a Portuguese place is shown as written, never with a wrong "In" in front', () => {
  assert.equal(where('na cozinha'), 'Na cozinha.');
  assert.equal(where('em casa'), 'Em casa.');
  assert.equal(where('Na casa da Maria'), 'Na casa da Maria.');
  assert.equal(where('no hospital'), 'No hospital.');
  assert.equal(where('numa cafeteria em Alfenas'), 'Numa cafeteria em Alfenas.');
});

// ---- 7. A place written as a bare noun
test('bare nouns: articles and proper names get "In"; "home" gets "At"; other bare words are shown as is', () => {
  assert.equal(where('the kitchen'), 'In the kitchen.');
  assert.equal(where('my room'), 'In my room.');
  assert.equal(where('a café'), 'In a café.');
  assert.equal(where('Alfenas'), 'In Alfenas.');
  assert.equal(where('home'), 'At home.');
  assert.equal(where('kitchen'), 'Kitchen.', 'no invented preposition for an ordinary bare noun');
});

// ---- 8. Vague answers that are not a place
test('vague answers mean nothing was stated', () => {
  for (const v of ['nowhere', 'somewhere', 'somewhere else', 'no specific place', 'no location', 'unclear', 'unsure', 'unknown', 'n/a', 'not mentioned', 'none', '', '   ', '*', '""']) {
    assert.equal(where(v), NONE, JSON.stringify(v));
  }
});

// ---- 9. Runaway length
test('a very long location is cut at a word, with an ellipsis, so it cannot flood the card', () => {
  const long = `in ${Array.from({ length: 60 }, (_, i) => `place${i}`).join(' ')}`;
  const out = where(long);
  assert.ok(out.length <= 125, `${out.length}`);
  assert.ok(out.endsWith('….'.replace('.', '')) || out.endsWith('…'), out);
  assert.ok(!/place\d+…?\.?$/.test(out) || !out.includes('plac…'), 'not cut mid-word');
});

// ---- 10. The whole run: a messy answer still yields clean sentences
test('a messy realistic answer through the whole run gives clean sentences', async () => {
  const messy = '```json\n{“location”: “*sitting on the sofa in the living room, drinking coffee*”, “topwear”: [“a grey hoodie”,], “bottomwear”: “black leggings”,}\n```';
  const k = fakeKindroid();
  k.answers.reading.push(messy);
  const out = await runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: 'k1' } }, kin: k.kin, clock: k.clock });
  assert.equal(out.ok, true);
  const { location, doing, outfit } = k.entry().reading;
  assert.deepEqual({ location, doing, outfit }, { location: 'On the sofa in the living room.', doing: 'No pose or action described in the recent chat.', outfit: 'Wearing a grey hoodie and black leggings.' });
});

// ---- 11. The wording: each ambiguous idea is pinned down in what the Kin reads
test('the prompt pins down the location ideas', () => {
  const p = buildOutfitPrompt({ name: 'Isa' });
  const must = [
    [/"location": the place only/, 'what location means'],
    [/starting with in, at or on/, 'shape'],
    [/not your posture or activity/, 'no posture or activity'],
    [/Travelling is a place/, 'travelling is a place'],
    [/planning to go is not/, 'a plan is not a move'],
    [/a place you have left is no longer where you are/, 'old places expire'],
    [/never guess/, 'no guessing'],
    [/Describe only yourself/, 'not the person'],
    [/shows the format only; never copy its values/, 'do not copy the example'],
    [/if the chat says nothing about any of this, reply \{\}/, 'empty answer allowed'],
  ];
  for (const [re, why] of must) assert.match(p, re, why);
});

test('the example in the prompt is not any demo scenario, so a Kin that copies it is distinguishable', () => {
  const example = JSON.parse(OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1]);
  assert.match(parseReading(JSON.stringify(example)).error, /copied the example/, 'a copy is caught');
  for (const s of DEMO_SCENES) {
    let r; try { r = JSON.parse(s.response); } catch { continue; }
    assert.notEqual(r.location, example.location, s.id);
    assert.notDeepEqual(r.topwear, example.topwear, s.id);
  }
  assert.ok(!/perfumed white shirt/.test(OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1]), 'the brief example is not the prompt example');
  assert.ok(!/living room/.test(OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1]));
});

test('cleanLocation keeps its contract: null for nothing, undefined for a wrong type', () => {
  assert.equal(cleanLocation(null), null);
  assert.equal(cleanLocation(undefined), null);
  assert.equal(cleanLocation(5), undefined);
  assert.equal(cleanLocation({}), undefined);
  assert.equal(describeLocation(null), NONE);
});
