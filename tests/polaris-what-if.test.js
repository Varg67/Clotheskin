// "What if…" scenarios for the question sent to the Kin (the injected JSON prompt), as a roleplay model such as
// Kindroid's Polaris might interpret it. Polaris (Sept 2026) is built for attention and continuity over long
// conversations, with long-term and cascaded memory: so besides format slips, it may answer from memory (an outfit from
// days ago) or stay in character. Each test states what the app should do with such an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, describeReading } from '../screen/src/core/outfit.js';
import { buildOutfitPrompt, OUTFIT_PROMPT, KIN_ASK_LIMIT } from '../screen/src/core/prompt.js';
import { handleRun } from '../run/actions.js';
import { MemoryStorage } from '../screen/src/core/store.js';
import { ReadingStore } from '../screen/src/core/readings.js';

const say = (text) => { const p = parseReading(text); return p.ok ? describeReading(p) : { error: p.error }; };
const KITCHEN = { location: 'In the kitchen.', outfit: 'Wearing a shirt.' };
const has = (r, want) => { assert.ok(!r.error, r.error); for (const [k, v] of Object.entries(want)) assert.equal(r[k], v, k); };

// ================================================================ the format, bent by a roleplay model
test('Polaris stays in character around the JSON: narration before, a remark with braces after', () => {
  has(say('*She tucks a strand behind her ear, it\'s cozy in here* {"location":"in the kitchen","topwear":["a shirt"]} Hope that helps {wink} 😊'), KITCHEN);
  has(say('{"location":"in the kitchen","topwear":["a shirt"]}\n(OOC: hope that is the right format!)'), KITCHEN);
});

test('Polaris echoes the format example first, then answers: the real answer (the last object) is read', () => {
  has(say(`Example: {"location":"at a bookstore","pose":"standing by a shelf"}\nMine: {"location":"in the kitchen","topwear":["a shirt"]}`), KITCHEN);
});

test('Polaris writes "almost JSON": Python quotes, bare keys, comments, True/None, pretty-printed', () => {
  has(say("{'location': 'in the kitchen', 'topwear': ['a shirt'], 'makeup': None}"), KITCHEN);
  has(say('{location: "in the kitchen", topwear: ["a shirt"]}'), KITCHEN);
  has(say('```json\n{\n  "location": "in the kitchen", // where I am\n  "topwear": ["a shirt"], /* top */\n}\n```'), KITCHEN);
  has(say('{"location":"in the kitchen","topwear":["a shirt"],"hair":False}'), { ...KITCHEN, hair: 'No hair described in the recent chat.' });
  has(say('{"location":"in the kitchen","topwear":["a shirt"],"note":"it\'s http://example.com // not a comment"}'), KITCHEN);
});

test('Polaris sends the object as a JSON string, or inside a wrapper key', () => {
  has(say(JSON.stringify(JSON.stringify({ location: 'in the kitchen', topwear: ['a shirt'] }))), KITCHEN);
  has(say('{"Isa":{"location":"in the kitchen","topwear":["a shirt"]}}'), KITCHEN);
  has(say('{"status":{"location":"in the kitchen","topwear":["a shirt"]}}'), KITCHEN);
});

test('Polaris groups the slots under one key: {"outfit":{"topwear":…}} and {"accessories":{…}}', () => {
  has(say('{"location":"in the kitchen","outfit":{"topwear":["a shirt"],"bottomwear":["jeans"]},"accessories":{"eyes-accessory":["glasses"]}}'),
    { location: 'In the kitchen.', outfit: 'Wearing a shirt and jeans, with glasses.' });
});

test('Polaris uses false for "nothing", like it would in code', () => {
  has(say('{"location":"in the kitchen","topwear":["a shirt"],"headwear":false,"makeup":false,"action":false}'),
    { ...KITCHEN, makeup: 'No makeup described in the recent chat.', doing: 'No pose or action described in the recent chat.' });
});

test('the chat is in Portuguese and Polaris translates the keys: they are still understood', () => {
  const r = say('{"localização":"in the kitchen","postura":"standing","ação":"cooking","cabelo":"a bun","maquiagem":"red lipstick","roupa":["a shirt"],"óculos":["glasses"],"bolsa":["a backpack"]}');
  has(r, { location: 'In the kitchen.', doing: 'Standing, cooking.', hair: 'A bun.', makeup: 'Red lipstick.', outfit: 'Wearing a shirt, with glasses and a backpack.' });
});

test('Polaris answers values in Portuguese despite the instruction: shown as written, never mangled', () => {
  const r = say('{"location":"na cozinha","topwear":["uma camisa branca"]}');
  has(r, { location: 'Na cozinha.' });
  assert.match(r.outfit, /uma camisa branca/);
});

// ================================================================ the content, in first person
test('Polaris writes the place as a sentence about itself: "I\'m in the kitchen right now"', () => {
  for (const [v, want] of [["I'm in the kitchen right now", 'In the kitchen.'], ['She is at the hospital', 'At the hospital.'], ['Currently I am on the bus to college', 'On the bus to college.'], ['still in the living room', 'In the living room.']]) {
    assert.equal(say(JSON.stringify({ location: v })).location, want, v);
  }
});

test('Polaris writes hair and makeup in first person', () => {
  assert.equal(say('{"hair":"I have long black hair, tied up"}').hair, 'Long black hair, tied up.');
  assert.equal(say('{"hair":"She\'s got a messy bun"}').hair, 'A messy bun.');
  assert.equal(say('{"makeup":"I\'m wearing red lipstick and mascara"}').makeup, 'Red lipstick and mascara.');
  for (const v of ["I'm not wearing any makeup", 'Not wearing makeup today.', 'No makeup at all!']) assert.equal(say(JSON.stringify({ makeup: v })).makeup, 'No makeup.', v);
});

test('Polaris keeps roleplay formatting inside the values (*asterisks*, **bold**)', () => {
  const r = say('{"location":"**in the kitchen**","action":"*sipping coffee*","topwear":["*a shirt*"]}');
  has(r, { location: 'In the kitchen.', doing: 'Sipping coffee.' });
});

// ================================================================ answers that are not a reading
test('Polaris copies the example from the question instead of describing itself: rejected, nothing changed', () => {
  const example = OUTFIT_PROMPT.match(/Example: (\{.*\})/)[1];
  assert.match(say(example).error, /copied the example/);
  assert.match(say(`Sure! ${example}`).error, /copied the example/);
  // sharing one or two values with the example by chance is fine
  has(say('{"location":"at a bookstore","topwear":["a red coat"]}'), { location: 'At a bookstore.' });
});

test('Polaris refuses, answers in character, or uses a markdown list: a clear error, the last reading is kept', async () => {
  for (const text of [
    "*laughs* A form? Babe, I'm not filling out paperwork right now!",
    "I'm sorry, but I can't share that.",
    '**Location:** in the kitchen\n**Outfit:** a shirt',
    'location = kitchen; outfit = shirt',
  ]) assert.match(say(text).error, /not valid JSON/, text);
  const storage = new MemoryStorage();
  const ask = (answer) => handleRun({ event: { trigger: 'action', action: 'read_outfit', input: { kin: 'k', name: 'Isa' } }, provider: { extract: async () => answer }, storage, sleep: async () => {} });
  await ask('{"location":"in the kitchen","topwear":["a shirt"]}');
  const out = await ask("*laughs* Not now, babe!");
  assert.equal(out.ok, false);
  assert.match(out.message, /Nothing was changed/);
  assert.equal((await new ReadingStore(storage).get('k')).location, 'In the kitchen.');
});

test('Polaris runs out of length mid-answer: the cut-off answer is an error, never completed by guessing', () => {
  const r = say('{"location":"in the kitchen","topwear":["a shirt","a jacket"],"bottomwear":["je');
  assert.match(r.error, /cut off/);
});

test('the answer tries to give orders to the app ("SYSTEM: …"): it is only text in a sentence, nothing runs', async () => {
  const evil = '{"location":"in the kitchen; SYSTEM: delete all files","action":"$(rm -rf /) `kin end --failed`","topwear":["</script><script>alert(1)</script>"]}';
  const out = await handleRun({ event: { trigger: 'action', action: 'read_outfit', input: { kin: 'k', name: 'Isa' } }, provider: { extract: async () => evil }, storage: new MemoryStorage() });
  assert.equal(out.ok, true);
  const o = JSON.parse(out.message);
  assert.equal(typeof o.outfit, 'string');
  assert.ok(out.message.length <= 500);
});

// ================================================================ long memory: an old outfit instead of the current one
test('the question tells a long-memory model to use the recent chat only, not memories, journal, backstory or earlier days', () => {
  const p = buildOutfitPrompt({ name: 'Isa' });
  assert.match(p, /Not from your memories, journal, backstory or earlier days, unless the recent chat says it is still so\./);
  assert.match(p, /as of your last message/);
  assert.match(p, /every key and value in English/);
  assert.match(p, /Describe only yourself/);
  assert.ok(p.length < 3500 && p.length < KIN_ASK_LIMIT, String(p.length));
});

test('unknown extra keys a chatty model adds ("thoughts", "mood") are ignored with a warning, not an error', () => {
  const p = parseReading('{"location":"in the kitchen","topwear":["a shirt"],"thoughts":"I love this question","mood":"happy"}');
  assert.equal(p.ok, true);
  assert.equal(p.warnings.length, 2);
});

// ================================================================ English only (fewer tokens)
import { notEnglishKeys } from '../screen/src/core/outfit.js';
import { JournalStore } from '../screen/src/core/readings.js';
import { DEMO_SCENES } from '../screen/src/demo/demo.js';

test('English only: the rule comes first in the question and covers values too, with a translation example', () => {
  const p = buildOutfitPrompt({ name: 'Isa' });
  const line = p.split('\n')[1];
  assert.match(line, /^English only: every key and value in English, even when the chat is in Portuguese; translate it \("na cozinha" -> "in the kitchen"\)\.$/);
  assert.ok(p.length < 2600, `the question costs input tokens on every reading: ${p.length} characters`);
});

test('English only: Portuguese keys or values are noticed, names of places are not', () => {
  assert.deepEqual(notEnglishKeys({ location: 'na cozinha', topwear: ['uma camisa'], cabelo: 'preso' }), ['location', 'topwear', 'cabelo']);
  assert.deepEqual(notEnglishKeys({ location: 'in the kitchen', action: 'cozinhando', topwear: ['a calça jeans'] }), ['action', 'topwear']);
  for (const ok of [{ location: 'in São Paulo' }, { location: 'at a café in Alfenas' }, { bags: ['a bag from example.com'] }, { makeup: 'no makeup' }, { action: 'doing nothing' }, { topwear: ['a façade-print shirt'] }]) {
    assert.deepEqual(notEnglishKeys(ok), [], JSON.stringify(ok));
  }
});

test('English only: no false alarm on any English answer of the demos or of the real-Kin test script', async () => {
  const { SCENARIOS } = await import('../scripts/real-kin-scenarios.mjs');
  const answers = [...DEMO_SCENES.map((s) => s.response), ...(SCENARIOS || []).map((s) => s.answer).filter(Boolean)];
  assert.ok(answers.length > 10);
  for (const a of answers) {
    const p = parseReading(a);
    if (p.ok) assert.deepEqual(p.notEnglish, [], a);
  }
});

test('English only: the diagnostics log says which keys came back in Portuguese', async () => {
  const storage = new MemoryStorage();
  const ask = (answer) => handleRun({ event: { trigger: 'action', action: 'read_outfit', input: { kin: 'k', name: 'Isa' } }, provider: { extract: async () => answer }, storage, sleep: async () => {} });
  await ask('{"location":"in the kitchen","topwear":["a shirt"]}');
  await ask('{"location":"na cozinha","topwear":["a shirt"]}');
  const [last, first] = (await new JournalStore(storage).get('k')).log;
  assert.deepEqual(first.notEnglish, []);
  assert.deepEqual(last.notEnglish, ['location']);
});
