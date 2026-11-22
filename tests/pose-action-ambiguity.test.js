// Ambiguity tests for pose + action: plausible WRONG answers from the Kin go through the real pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, describeReading } from '../src/core/outfit.js';
import { describeDoing, cleanPose, cleanAction } from '../src/core/phrases.js';
import { poseIcon } from '../src/screen/icons.js';
import { OUTFIT_PROMPT, buildOutfitPrompt } from '../src/core/prompt.js';
import { runProgram } from '../run/program.js';
import { ACTION } from '../src/core/state.js';
import { fakeKindroid } from './support/fake-kindroid.js';
import { DEMO_SCENES } from '../dev/scenes.js';

const NOD = 'No pose or action described in the recent chat.';
const doing = (o) => { const p = parseReading(JSON.stringify(o)); assert.ok(p.ok, p.error); return describeReading(p).doing; };
const act = (action) => doing({ action });
const pose = (v) => doing({ pose: v });

test('pose and action become one sentence: pose first, then the action, with a comma', () => {
  assert.equal(doing({ pose: 'sitting on the sofa', action: 'drinking coffee' }), 'Sitting on the sofa, drinking coffee.');
  assert.equal(pose('standing by the window'), 'Standing by the window.');
  assert.equal(act('reading a book'), 'Reading a book.');
  assert.equal(doing({}), NOD);
});

test('an action the Kin also wrote inside the pose is not said twice', () => {
  assert.equal(doing({ pose: 'sitting on the sofa, drinking coffee', action: 'drinking coffee' }), 'Sitting on the sofa, drinking coffee.');
  assert.equal(doing({ pose: 'lying in bed reading', action: 'reading' }), 'Lying in bed reading.');
});

// ---- 1. "short -ing phrase": the Kin writes a full sentence or a different tense
test('a subject or helper verb in front of the action is removed', () => {
  for (const v of ['I am reading a book', "I'm reading a book", 'she is reading a book', "she's reading a book", 'currently reading a book', 'is reading a book', 'right now I am reading a book', 'They are reading a book']) {
    assert.equal(act(v), 'Reading a book.', v);
  }
});

// ---- 2. "Not plans, not things already finished": the Kin reports a plan or the past
test('plans, intentions, the past and future time words are not an action', () => {
  for (const v of ['going to read later', 'about to leave', 'will sleep', 'planning to cook', 'plans to go out', 'wants to take a nap', 'wanted to call her', 'used to run', 'finished eating', 'stopped reading', 'was cooking', 'had dinner', 'reading later', 'cooking tomorrow', 'leaving soon', 'going to bed tonight']) {
    assert.equal(act(v), NOD, v);
  }
});

test('movement in progress is an action ("going to the store")', () => {
  assert.equal(act('going to the store'), 'Going to the store.');
  assert.equal(act('walking to the bus stop'), 'Walking to the bus stop.');
});

// ---- 3. "Not feelings"
test('feelings and states of mind are not an action', () => {
  for (const v of ['feeling tired', 'being sleepy', 'seeming bored']) assert.equal(act(v), NOD, v);
  assert.equal(act('looking out of the window'), 'Looking out of the window.', 'looking is an action');
});

// ---- 4. Nothing to say
test('"nothing" in any form is not an action or a pose', () => {
  for (const v of ['nothing', 'nothing in particular', 'doing nothing', 'idle', 'none', 'unknown', 'n/a', 'not mentioned', '', '*', '?']) {
    assert.equal(act(v), NOD, JSON.stringify(v));
    assert.equal(pose(v), NOD, JSON.stringify(v));
  }
});

// ---- 5. Pose vs location: the two are easy to swap
test('a "pose" that is really a place becomes the location when there is none, and is dropped when there is one', () => {
  const alone = parseReading('{"pose":"in the kitchen","action":"chopping onions"}');
  assert.equal(describeReading(alone).location, 'In the kitchen.');
  assert.equal(describeReading(alone).doing, 'Chopping onions.');
  const both = parseReading('{"location":"at the shared house","pose":"in the kitchen"}');
  assert.equal(describeReading(both).location, 'At the shared house.');
  assert.equal(describeReading(both).doing, NOD);
});

test('a real pose that mentions a place word is kept ("lying in bed", "standing at the counter", "on the sofa")', () => {
  assert.equal(pose('lying in bed'), 'Lying in bed.');
  assert.equal(pose('standing at the counter'), 'Standing at the counter.');
  assert.equal(pose('on the sofa'), 'On the sofa.');
  assert.equal(pose('leaning against the wall'), 'Leaning against the wall.');
});

test('posture written into the location does not create a pose (it is only cleaned out of the place)', () => {
  const p = describeReading(parseReading('{"location":"sitting on the sofa in the living room"}'));
  assert.equal(p.location, 'On the sofa in the living room.');
  assert.equal(p.doing, NOD);
});

// ---- 6. Format slips shared with the other keys
test('clothes inside the pose, markdown, quotes and long text are cleaned', () => {
  assert.equal(pose('standing, wearing a robe'), 'Standing.');
  assert.equal(pose('*sitting on the sofa*'), 'Sitting on the sofa.');
  assert.equal(act('"drinking coffee"'), 'Drinking coffee.');
  const long = act(`reading ${Array.from({ length: 60 }, (_, i) => `chapter${i}`).join(' ')}`);
  assert.ok(long.length <= 85, `${long.length}`);
  assert.ok(long.endsWith('…'));
});

test('a list of texts is joined; an object or a number is an error', () => {
  assert.equal(act(['reading a book']), 'Reading a book.');
  for (const bad of [{ pose: { a: 1 } }, { pose: 5 }, { action: { verb: 'read' } }, { action: ['reading', 3] }]) {
    const p = parseReading(JSON.stringify(bad));
    assert.equal(p.ok, false, JSON.stringify(bad));
    assert.match(p.error, /"(pose|action)" must be a text/);
  }
});

// ---- 7. The Kin names the keys differently
test('posture / position / stance and activity / doing / current_action are understood and never reported as unknown keys', () => {
  for (const key of ['posture', 'position', 'Stance', 'body_position']) {
    const p = parseReading(JSON.stringify({ [key]: 'standing', topwear: ['a coat'] }));
    assert.equal(p.pose, 'standing', key);
    assert.deepEqual(p.warnings, [], key);
    assert.deepEqual(Object.keys(p.outfit), ['topwear']);
  }
  for (const key of ['activity', 'doing', 'Doing Now', 'current_action', 'currentActivity']) {
    const p = parseReading(JSON.stringify({ [key]: 'reading' }));
    assert.equal(p.action, 'reading', key);
    assert.deepEqual(p.warnings, [], key);
  }
});

// ---- 8. Icon
test('the pose row icon follows the pose', () => {
  assert.equal(poseIcon('sitting on the sofa'), 'sitting');
  assert.equal(poseIcon('lying in bed'), 'sitting');
  assert.equal(poseIcon('Standing by the window.'), 'standing');
  assert.equal(poseIcon('Walking around the park.'), 'standing');
  assert.equal(poseIcon(null), 'person');
  assert.equal(poseIcon('Chopping onions.'), 'person');
});

// ---- 9. The whole run, and the worst case: still three sentences, and a kin end line within 500 characters
test('a messy answer with everything gives three clean sentences; the worst case still fits kin end', async () => {
  const read = async (answer) => {
    const k = fakeKindroid();
    k.answers.reading.push(answer);
    const out = await runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: 'k1' } }, kin: k.kin, clock: k.clock });
    return { out, reading: k.entry().reading };
  };
  const messy = '*smiles* ```json\n{“location”: “in the kitchen”, “pose”: “*standing at the counter*”, “action”: “I am chopping onions”, “topwear”: [“a white shirt”,],}\n```';
  const { reading } = await read(messy);
  assert.deepEqual([reading.location, reading.doing, reading.outfit], ['In the kitchen.', 'Standing at the counter, chopping onions.', 'Wearing a white shirt.']);

  const w = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const worst = JSON.stringify({ location: `in ${w(60)}`, pose: `standing ${w(40)}`, action: `reading ${w(40)}`, topwear: Array.from({ length: 8 }, (_, i) => `a very long descriptive jacket number ${i} with details`), 'neck-accessory': Array.from({ length: 8 }, (_, i) => `a very long necklace number ${i}`) });
  const big = await read(worst);
  assert.ok(big.out.message.length <= 500, `${big.out.message.length}`);
  assert.ok(big.reading.location.length > 20 && big.reading.doing.length > 20, 'location and doing are kept');
  assert.match(big.reading.outfit, /^Wearing/);
});

// ---- 10. The wording
test('the prompt pins down pose and action and how they differ from the location', () => {
  const p = buildOutfitPrompt({ name: 'Isa' });
  const must = [
    [/your pose, what you are doing, what you are wearing, and your hair and makeup/, 'the four things asked'],
    [/"pose": your body position/, 'what pose means'],
    [/it may name the furniture, "location" is the room or place/, 'pose vs location'],
    [/"action": what you are doing now, a short -ing phrase/, 'what action means'],
    [/not plans, finished things or feelings/, 'what action is not'],
    [/a finished action is no longer what you are doing/, 'old actions expire'],
    [/never copy its values/, 'do not copy the example'],
  ];
  for (const [re, why] of must) assert.match(p, re, why);
  assert.ok(p.length < 3500, `${p.length}`);
});

test('the prompt example (pose and action too) is not any demo scenario', () => {
  const example = JSON.parse(OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1]);
  for (const s of DEMO_SCENES) {
    let r; try { r = JSON.parse(s.response); } catch { continue; }
    assert.notEqual(r.pose, example.pose, s.id);
    assert.notEqual(r.action, example.action, s.id);
  }
});

test('the cleaners keep their contract: null for nothing, undefined for a wrong type', () => {
  assert.equal(cleanPose(null), null);
  assert.equal(cleanAction(undefined), null);
  assert.equal(cleanPose(3), undefined);
  assert.equal(cleanAction({}), undefined);
  assert.equal(describeDoing({}), NOD);
  assert.equal(describeDoing({ pose: null, action: 'reading' }), 'Reading.');
});
