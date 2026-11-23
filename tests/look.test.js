// "Tell my Kin its current look" (settings.tellLook): what-if scenarios. The app tells the Kin its outfit, hair and
// makeup with kin tell (look-outfit, look-hair, look-makeup; 12 hours), so it stays consistent in the roleplay.
// Each test is one way this could go wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../run/program.js';
import { ACTION } from '../src/core/state.js';
import { lookFacts, normalizeEntry, afterStop, normalizeSettings, LOOK_TTL_HOURS } from '../src/core/state.js';
import { fakeKindroid } from './support/fake-kindroid.js';

const ON = { autoState: 'running', kinId: 'k1', intervalS: 900, tz: 'America/Sao_Paulo', tellLook: true };
const tick = (k, opts = {}) => runProgram({ event: { trigger: 'schedule' }, kin: k.kin, clock: k.clock, retryAfterMs: 0, ...opts });
const press = (k, id = 'k1') => runProgram({ event: { trigger: 'action', action: ACTION, input: { kin: id } }, kin: k.kin, clock: k.clock, retryAfterMs: 0 });
const answer = (k, o) => k.answers.reading.splice(0, Infinity, typeof o === 'string' ? o : JSON.stringify(o));
const looks = (k) => k.tells().filter(([, , o]) => o.key.startsWith('look-'));
const keys = (k) => looks(k).map(([, , o]) => o.key);
const LOOK = { location: 'in the kitchen', action: 'cooking', topwear: ['a purple shirt'], bottomwear: ['jeans'], hair: 'long dark hair in a ponytail', makeup: 'red lipstick' };

test('1. off (the default): the Kin is never told its look', async () => {
  assert.equal(normalizeSettings({}).tellLook, false);
  const k = fakeKindroid({ settings: { ...ON, tellLook: undefined } });
  answer(k, LOOK);
  await tick(k);
  assert.equal(looks(k).length, 0);
  assert.deepEqual(k.entry().told, {});
});

test('2. on: the first reading tells outfit, hair and makeup, each under its own key, for 12 hours, never reaching out', async () => {
  const k = fakeKindroid({ settings: ON, now: '2026-11-22T21:40:00-03:00' });
  answer(k, LOOK);
  const r = await tick(k);
  assert.deepEqual(keys(k), ['look-outfit', 'look-hair', 'look-makeup']);
  const [outfit, hair, makeup] = looks(k);
  assert.equal(outfit[1], 'Your outfit right now (21:40 on Sunday): wearing a purple shirt and jeans.');
  assert.equal(hair[1], 'Your hair right now (21:40 on Sunday): long dark hair in a ponytail.');
  assert.equal(makeup[1], 'Your makeup right now (21:40 on Sunday): red lipstick.');
  for (const [, , o] of looks(k)) { assert.equal(o.kin, 'k1'); assert.equal(o.ttl, LOOK_TTL_HOURS); assert.ok(!o.reachOut); }
  assert.equal(r.message, 'Wearing a purple shirt and jeans. Long dark hair in a ponytail. Red lipstick.');
});

test('3. the same look at the next reading is not told again (kin tell is for rare facts)', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, LOOK);
  await tick(k);
  k.advance(20);
  answer(k, { ...LOOK, location: 'in the living room', action: 'watching TV' });
  const r = await tick(k);
  assert.equal(looks(k).length, 3, 'only the first three');
  assert.ok(!/Told/.test(r.message));
});

test('4. only what changed is told: a new outfit does not tell the hair again', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, LOOK);
  await tick(k);
  k.advance(20);
  answer(k, { ...LOOK, topwear: ['a black dress'], bottomwear: [] });
  await tick(k);
  assert.deepEqual(keys(k).slice(3), ['look-outfit']);
  assert.match(looks(k)[3][1], /wearing a black dress\.$/);
});

test('5. a look kept from an earlier reading (the Kin said nothing about it) is never told: an old sentence must not become the Kin\'s truth', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, { location: 'in the kitchen', topwear: ['a purple shirt'] });
  await tick(k);
  k.settings({ tellLook: true });
  k.files.set('status.json', JSON.stringify({ kins: { k1: { ...k.entry(), told: {} } } })); // as if never told
  k.advance(20);
  answer(k, { location: 'in the living room' }); // nothing about the outfit: the card keeps it, the Kin is not told
  await tick(k);
  assert.equal(k.entry().reading.outfit, 'Wearing a purple shirt.');
  assert.deepEqual(keys(k), ['look-outfit'], 'only the first reading told it');
});

test('6. "no outfit described", or nothing about hair or makeup: nothing to tell', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, { location: 'in the kitchen', action: 'cooking' });
  await tick(k);
  assert.equal(looks(k).length, 0);
  assert.deepEqual(lookFacts({ fresh: { outfit: 'No outfit described in the recent chat.', hair: null, makeup: null }, told: {}, now: new Date(), when: 'x' }), []);
});

test('7. kin tell fails (Kindroid down, or the note refused): the reading is kept, no reading error, the rest is not tried, and it waits an hour', async () => {
  const k = fakeKindroid({ settings: ON });
  k.tellFails = true;
  answer(k, LOOK);
  const r = await tick(k);
  assert.equal(r.ok, true);
  assert.equal(k.entry().reading.outfit, 'Wearing a purple shirt and jeans.');
  assert.equal(k.entry().error, null, 'not a reading error');
  assert.equal(looks(k).length, 1, 'after the first failure, hair and makeup are not tried in this run');
  assert.deepEqual(k.entry().told, {}, 'nothing marked as told');
  assert.equal(k.entry().lookError, 'service busy');
  k.tellFails = false;
  k.advance(20);
  await tick(k);
  assert.equal(looks(k).length, 1, '20 minutes later: still waiting');
  k.advance(45);
  await tick(k);
  assert.deepEqual(keys(k).slice(1), ['look-outfit', 'look-hair', 'look-makeup'], 'an hour later: told');
  assert.equal(k.entry().lookError, null, 'the problem is cleared');
  assert.equal(k.entry().lookFailedAt, null);
});

test('8. not enough time left in the run: nothing is told and nothing is marked; the reading is saved', async () => {
  const k = fakeKindroid({ settings: ON });
  // The question is asked with 26 s left (15 s for it + 10 s kept) and takes 1.2 s: 24.8 s is too little for a tell (25 s).
  k.answers.reading.push(() => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify(LOOK)), 1200)));
  const r = await tick(k, { budgetMs: 26000 });
  assert.equal(r.ok, true);
  assert.equal(looks(k).length, 0);
  assert.deepEqual(k.entry().told, {});
  assert.equal(k.entry().reading.hair, 'Long dark hair in a ponytail.');
});

test('9. an answer that cannot be read (roleplay twice, or the copied example) tells nothing', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, '*smiles* Estou na cozinha, amor.');
  await tick(k);
  assert.equal(looks(k).length, 0);
  const c = fakeKindroid({ settings: ON });
  answer(c, '{"location":"at a bookstore","pose":"standing by a shelf","action":"flipping through a book","hair":"a loose braid","topwear":["a grey hoodie"],"bottomwear":["black leggings"],"footwear":["white sneakers"]}');
  await tick(c);
  assert.equal(looks(c).length, 0);
});

test('10. after 12 hours the told look has expired in the Kin: the same look is told again', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, LOOK);
  await tick(k);
  k.advance(10 * 60);
  await tick(k);
  assert.equal(looks(k).length, 3, '10 hours: still known');
  k.advance(60 + 1);
  await tick(k);
  assert.equal(looks(k).length, 6, '11 hours: told again before it expires');
});

test('11. Stop and Start: what was told is forgotten, and the look is told again', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, LOOK);
  await tick(k);
  assert.equal(Object.keys(k.entry().told).length, 3);
  k.advance(5);
  k.settings({ autoState: 'stopped', stoppedAt: k.clock().toISOString() });
  k.advance(5);
  await tick(k);
  assert.deepEqual(k.entry().told, {}, 'Stop forgot it');
  k.settings({ autoState: 'running' });
  await tick(k);
  assert.equal(looks(k).length, 6);
  assert.deepEqual(afterStop(normalizeEntry({ told: { outfit: { mark: 'abcd1234', at: '2026-11-22T10:00:00Z' } }, lastRunAt: '2026-11-22T10:00:00Z' }), { stoppedAt: '2026-11-22T11:00:00Z' }).told, {});
});

test('12. two runs at once (a scheduled start and Update status): no failure, and the told marks end up saved', async () => {
  const k = fakeKindroid({ settings: ON });
  let inner;
  k.answers.reading.push(async () => { answer(k, LOOK); inner = await tick(k); return JSON.stringify(LOOK); });
  const outer = await press(k);
  assert.equal(outer.ok, true);
  assert.equal(inner.ok, true);
  assert.equal(Object.keys(k.entry().told).length, 3);
  assert.ok(looks(k).length <= 6, 'at most told twice, under the same keys (the second replaces the first)');
});

test('13. two Kins: each is told its own look, and the marks do not mix', async () => {
  const k = fakeKindroid({ settings: ON, kins: [{ id: 'k1', name: 'Isa' }, { id: 'k2', name: 'Bia' }] });
  answer(k, LOOK);
  await tick(k);
  answer(k, { ...LOOK, topwear: ['a green hoodie'] });
  await press(k, 'k2');
  assert.deepEqual(looks(k).map(([, , o]) => o.kin), ['k1', 'k1', 'k1', 'k2', 'k2', 'k2']);
  assert.match(looks(k)[3][1], /green hoodie/);
  assert.notEqual(k.entry('k1').told.outfit.mark, k.entry('k2').told.outfit.mark);
});

test('14. undressed: "Not wearing anything" is a real change and is told', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, LOOK);
  await tick(k);
  k.advance(20);
  answer(k, { location: 'in the shower', clothing: ['naked'] });
  await tick(k);
  assert.equal(looks(k)[3][1].replace(/\(.*\)/, '()'), 'Your outfit right now (): not wearing anything.');
});

test('15. makeup taken off after a lipstick: the Kin is told it wears none now (the screen hides the row)', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, LOOK);
  await tick(k);
  k.advance(20);
  answer(k, { makeup: 'no makeup' });
  await tick(k);
  assert.deepEqual(keys(k).slice(3), ['look-makeup']);
  assert.match(looks(k)[3][1], /: no makeup\.$/);
});

test('16. a very long outfit is cut to a safe length, on one line', async () => {
  const many = (n) => Array.from({ length: 8 }, (_, i) => `a long descriptive ${n} number ${i}`);
  const k = fakeKindroid({ settings: ON });
  answer(k, { topwear: many('jacket'), bottomwear: many('skirt'), 'neck-accessory': many('necklace') });
  await tick(k);
  const fact = looks(k)[0][1];
  assert.ok(fact.length <= 300, `${fact.length}`);
  assert.ok(!/\n/.test(fact));
});

test('17. falling asleep: the pyjamas are told, and the sleep question is still asked', async () => {
  const k = fakeKindroid({ settings: ON, now: '2026-11-22T23:10:00-03:00' });
  answer(k, { location: 'in the bedroom', pose: 'lying in bed', action: 'sleeping', topwear: ['pyjamas'] });
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  await tick(k);
  assert.deepEqual(k.asks(), ['reading', 'sleep']);
  assert.deepEqual(keys(k), ['look-outfit']);
  assert.ok(k.entry().sleep, 'the night is planned');
  assert.ok(k.entry().told.outfit, 'and the told mark is kept with it');
});

test('18. a damaged status.json told field is read as "nothing told", never a crash', () => {
  for (const told of [null, 'x', [], { outfit: 5 }, { outfit: { mark: 'not hex!', at: 'never' } }, { hair: { mark: 'abcd1234' } }]) {
    assert.deepEqual(normalizeEntry({ told }).told, {}, JSON.stringify(told));
  }
});

test('19. turned off after telling: nothing more is told (what was told expires in the Kin within 12 hours)', async () => {
  const k = fakeKindroid({ settings: ON });
  answer(k, LOOK);
  await tick(k);
  k.settings({ tellLook: false });
  k.advance(20);
  answer(k, { ...LOOK, topwear: ['a black dress'], bottomwear: [] });
  await tick(k);
  assert.equal(looks(k).length, 3);
});

test('20. the dream and the look use different keys: telling one never replaces the other', async () => {
  const k = fakeKindroid({ settings: { ...ON, tellDream: true } });
  answer(k, { location: 'in the bedroom', pose: 'lying in bed', action: 'sleeping', topwear: ['pyjamas'] });
  k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
  k.at('2026-11-23T02:10:00Z');
  await tick(k);
  k.at(k.entry().sleep.until);
  k.answers.dream.push('{"dream":"A train by the sea","remembered":"most"}');
  await tick(k);
  assert.deepEqual(k.tells().map(([, , o]) => o.key), ['look-outfit', 'dream']);
});
