import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../run/program.js';
import { fakeKindroid } from './support/fake-kindroid.js';

const answers = {
  read: { location: 'in a vault', hair: 'a violet braid', topwear: ['a satin vest'], makeup: 'coral lipstick' },
  wake: { dream: 'A silver whale', remembered: 'some' },
};
const event = (op) => ({ trigger: 'action', action: 'update_status', kin: 'k1', input: { op } });
function action(k, op) {
  if (op === 'wake') {
    const entry = k.entry() || {};
    const sleep = { until: '2026-11-21T07:00:00Z', wakeAt: '2026-11-21T07:10:00Z' };
    k.files.set('status.json', JSON.stringify({ kins: { k1: { ...entry, sleep } } }));
  }
  return runProgram({ event: event(op), kin: k.kin, clock: k.clock, retryAfterMs: 0 });
}
function setup(enabled) {
  const k = fakeKindroid({ settings: { tellLook: enabled, tellDream: enabled } });
  k.answers.reading.push(JSON.stringify(answers.read));
  k.answers.dream.push(JSON.stringify(answers.wake));
  return k;
}
const privateWords = /vault|violet|satin|lipstick|whale/i;
for (const op of ['read', 'wake']) {
  test(`${op}: preference changes in the same session take effect on the next action`, async () => {
    const k = setup(false);
    for (const enabled of [false, true, false]) {
      k.settings({ tellLook: enabled, tellDream: enabled });
      const result = await action(k, op);
      assert.equal(result.ok, true);
      assert.equal(privateWords.test(result.message), enabled);
    }
  });
  test(`${op}: permission changes during the Kin question apply to notes and result`, async () => {
    for (const before of [false, true]) {
      const k = setup(before);
      k.answers[op === 'read' ? 'reading' : 'dream'][0] = async () => {
        k.settings({ tellLook: !before, tellDream: !before, reachOut: !before });
        return JSON.stringify(answers[op]);
      };
      const result = await action(k, op);
      assert.equal(privateWords.test(result.message), !before);
      assert.equal(k.tells().length, before ? 0 : op === 'read' ? 3 : 1);
      if (!before && op === 'wake') assert.equal(k.tells()[0][2].reachOut, true);
    }
  });
  test(`${op}: final result rechecks consent even after a note was sent`, async () => {
    for (const change of ['off', 'unreadable', 'malformed', 'missing']) {
      const k = setup(true);
      const put = k.kin.put;
      k.kin.put = async (...args) => {
        await put(...args);
        if (change === 'off') k.settings({ tellLook: false, tellDream: false });
        if (change === 'unreadable') k.unreadable = 'settings.json';
        if (change === 'malformed') k.files.set('settings.json', '{');
        if (change === 'missing') k.files.delete('settings.json');
      };
      assert.deepEqual(await action(k, op), { ok: true, message: 'Status updated.' });
      assert.ok(k.tells().length);
      assert.ok(k.entry()[op === 'wake' ? 'dream' : 'reading']);
    }
  });
  test(`${op}: missing, invalid or unreadable consent cannot authorize a note or result`, async () => {
    for (const raw of [null, '{', '[]', '{"tellLook":"true","tellDream":1}', '{"nested":{"tellDream":true,"tellLook":true}}']) {
      const k = setup(true);
      if (raw === null) k.files.delete('settings.json');
      else k.files.set('settings.json', raw);
      assert.deepEqual(await action(k, op), { ok: true, message: 'Status updated.' });
      assert.equal(k.tells().length, 0);
    }
  });
}
test('turning off look after the first memory note blocks all later notes and the final result', async () => {
  const k = setup(true);
  const tell = k.kin.tell;
  k.kin.tell = async (...args) => { await tell(...args); k.settings({ tellLook: false }); };
  assert.deepEqual(await action(k, 'read'), { ok: true, message: 'Status updated.' });
  assert.equal(k.tells().length, 1);
  assert.deepEqual(Object.keys(k.entry().told), ['outfit']);
  assert.equal(k.entry().reading.hair, 'A violet braid.');
});

test('embedded objects and a mixed scene summary cannot become look or dream disclosures', async () => {
  const k = setup(true);
  const hidden = '{"summary":"PRIVATE_PAYLOAD"}';
  k.answers.reading[0] = JSON.stringify({ hair: hidden, topwear: [hidden], makeup: { lips: hidden, summary: 'PRIVATE_PAYLOAD' } });
  const r = await action(k, 'read');
  assert.deepEqual(r, { ok: true, message: 'Status updated.' });
  for (const reply of [{ dream: hidden }, { summary: 'PRIVATE_PAYLOAD', location: 'PRIVATE_PAYLOAD' }]) {
    k.answers.dream[0] = JSON.stringify(reply);
    const w = await action(k, 'wake');
    assert.equal(w.ok, true);
    assert.doesNotMatch(w.message, /PRIVATE_PAYLOAD/);
  }
  assert.equal(k.tells().length, 0);
});
