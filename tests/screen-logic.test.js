// The screen's logic without a page: what it says (src/screen/texts.js) and its state and actions
// (src/screen/store.js), with a stand-in channel and announcer. The page itself is covered by tests/e2e/screen.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { warningText, problemText, kinStateLine, visibleDream, automationStatus, changesToTell } from '../src/screen/texts.js';
import { createStore, initialState, knownKins, selectedKin, entryOf, settingsFixes, errorAnswered, newsSince } from '../src/screen/store.js';
import { normalizeSettings, normalizeStatus, normalizeEntry, ACTION } from '../src/core/state.js';

const NOW = new Date('2026-11-20T22:07:00Z');
const at = (patch = {}) => ({ settings: normalizeSettings({ autoState: 'running', intervalS: 900, tz: 'UTC', ...patch }), now: NOW });
const entry = (patch = {}) => normalizeEntry({ lastRunAt: '2026-11-20T22:00:00Z', ...patch });
const READING = { location: 'In the kitchen.', doing: 'Standing, making coffee.', outfit: 'Wearing a grey hoodie.', at: '2026-11-20T22:00:00Z' };

test('texts: warnings and problems say what happened and when the next try is', () => {
  const failing = entry({ errorKind: 'server', error: 'kin ask failed: 503', serverFailures: 3, retryAt: '2026-11-20T22:30:00Z' });
  assert.match(warningText({ kind: 'server', failures: 3 }, failing, at()), /^Kindroid has not answered 3 times in a row\. It may be down\. The next try is around .+\.$/);
  assert.match(warningText({ kind: 'maintenance' }, failing, at()), /^Kindroid seems to be under maintenance\./);
  assert.match(problemText(failing, 'Isa', at()), /^Kindroid did not answer this time \(kin ask failed: 503\)\. It tries again around /);
  assert.equal(problemText(entry({ errorKind: 'answer', error: 'The answer is not valid JSON.' }), 'Isa', at()), "Isa's answer could not be read: The answer is not valid JSON.");
  assert.equal(problemText(entry({ errorKind: 'answer', error: 'x', note: 'The sleep question waits.' }), 'Isa', at()), 'The sleep question waits.', 'a note wins');
});

test('texts: the Kin list line, the dream for a day, and the line under Start / Pause / Stop', () => {
  assert.equal(kinStateLine(entry(), NOW), 'Not read yet');
  assert.match(kinStateLine(entry({ reading: READING }), NOW), /^In the kitchen · 7 minutes ago$/);
  const night = { wakeAt: '2026-11-21T07:30:00Z', until: '2026-11-21T07:20:00Z' };
  assert.match(kinStateLine(entry({ sleep: night }), NOW), /^Asleep until /);
  const dream = { dream: 'Flying', remembered: 'most', at: '2026-11-20T08:00:00Z' };
  assert.ok(visibleDream(entry({ dream }), NOW));
  assert.equal(visibleDream(entry({ dream: { ...dream, at: '2026-11-19T08:00:00Z' } }), NOW), null, 'more than a day ago');
  assert.deepEqual(automationStatus(entry(), at({ autoState: 'stopped' })), { text: 'Stopped. Press Start to update automatically.', wakeNow: false });
  assert.match(automationStatus(entry(), at()).text, /^Next update around /);
  assert.equal(automationStatus(entry(), at({ autoState: 'paused' })).text, 'Paused: nothing is asked until you press Resume.');
  const asleep = automationStatus(entry({ sleep: night }), at());
  assert.equal(asleep.wakeNow, true);
  assert.match(asleep.text, /^Asleep until .+\. The dream question comes around .+\. $/);
  assert.equal(automationStatus(entry({ sleep: night }), at({ autoState: 'paused' })).wakeNow, false);
});

test('texts: what changed is told once, joined; an error is an alert unless the warning already says it', () => {
  const a = entry();
  const b = entry({ lastRunAt: '2026-11-20T22:07:00Z', reading: READING });
  assert.deepEqual(changesToTell(a, b, { name: 'Isa', asked: false, at: at() }), { say: 'In the kitchen. Standing, making coffee. Wearing a grey hoodie.', alert: '' });
  assert.equal(changesToTell(b, b, { name: 'Isa', asked: false, at: at() }).say, '', 'nothing new');
  const failed = entry({ lastRunAt: '2026-11-20T22:07:00Z', errorKind: 'answer', error: 'The answer is not valid JSON.' });
  assert.equal(changesToTell(a, failed, { name: 'Isa', asked: false, at: at() }).alert, "Isa's answer could not be read: The answer is not valid JSON.");
  const down = entry({ lastRunAt: '2026-11-20T22:07:00Z', errorKind: 'server', error: 'x', serverFailures: 3 });
  const told = changesToTell(a, down, { name: 'Isa', asked: false, at: at() });
  assert.match(told.say, /has not answered 3 times/);
  assert.equal(told.alert, '', 'the warning says it already');
});

test('store state: the Kins shown, the one on screen, and what the run needs from the screen', () => {
  const S = initialState([{ id: 'k1', name: 'Isa' }, { id: 'k2', name: 'Bea' }]);
  assert.equal(selectedKin(S), null, 'several attached, none chosen: the person picks');
  S.settings = normalizeSettings({ kinId: 'k2' });
  assert.equal(selectedKin(S).name, 'Bea');
  const picture = initialState(null);
  picture.status = normalizeStatus({ kins: { k9: { name: 'Isa' } } });
  assert.deepEqual(knownKins(picture), [{ id: 'k9', name: 'Isa' }], 'a still picture: names from status.json');
  assert.deepEqual(settingsFixes(initialState([{ id: 'k1', name: 'Isa' }]), 'America/Sao_Paulo'), { tz: 'America/Sao_Paulo', kinId: 'k1' });
  assert.deepEqual(entryOf(S, 'nobody'), normalizeEntry());
});

test('store state: a newer run answers the action\'s error; the first read of a Kin counts as newer, never read does not', () => {
  const S = initialState([{ id: 'k1', name: 'Isa' }]);
  S.error = { kinId: 'k1', text: 'Kindroid did not answer.' };
  const before = S.status;
  assert.equal(errorAnswered(S, before), false, 'B6: nothing ran for a Kin never read: the error stays');
  S.status = normalizeStatus({ kins: { k1: { lastRunAt: '2026-11-20T22:07:00Z' } } });
  assert.equal(errorAnswered(S, before), true);
  assert.equal(newsSince(initialState([]), before, { asked: false, now: NOW }), null, 'no Kin on screen: nothing to tell');
});

/** A stand-in for the page: files in a Map, an action that answers `actionReply` (or throws), what was announced. */
function fakePage({ actionReply = { ok: true, summary: '' }, files = {} } = {}) {
  const store = new Map(Object.entries(files));
  const said = [];
  const channel = {
    read: async (path) => (store.has(path) ? store.get(path) : null),
    write: async (path, body) => { store.set(path, body); },
    action: async (name, input) => { if (actionReply instanceof Error) throw actionReply; return typeof actionReply === 'function' ? actionReply(name, input, store) : actionReply; },
  };
  const announcer = { announce: (t) => said.push(['say', t]), alertOnce: (t) => said.push(['alert', t]), forget: () => {} };
  return { channel, announcer, files: store, said };
}

test('B6: Update status for a Kin never read, when Kindroid does not answer, keeps the error and alerts it', async () => {
  const page = fakePage({ actionReply: new Error('timeout') });
  const store = createStore({ channel: page.channel, kins: [{ id: 'k1', name: 'Isa' }], clock: () => NOW, onChange: () => {}, announcer: page.announcer });
  await store.loadSettings();
  await store.loadStatus();
  await store.update('read');
  assert.deepEqual(store.S.error, { kinId: 'k1', text: 'Kindroid did not answer. Try again in a moment.' });
  assert.deepEqual(page.said.filter(([k]) => k === 'alert'), [['alert', 'Kindroid did not answer. Try again in a moment.']]);
});

test('store actions: Update status runs the action and tells the new reading; Stop saves when it was pressed', async () => {
  const page = fakePage({
    actionReply: (name, input, files) => {
      files.set('status.json', JSON.stringify({ kins: { [input.kin]: { name: 'Isa', lastRunAt: NOW.toISOString(), reading: READING } } }));
      return { ok: true, summary: 'done' };
    },
  });
  const store = createStore({ channel: page.channel, kins: [{ id: 'k1', name: 'Isa' }], clock: () => NOW, onChange: () => {}, announcer: page.announcer });
  await store.loadSettings();
  await store.loadStatus();
  store.syncSettings();
  await store.update('read');
  assert.deepEqual(page.said.at(-1), ['say', 'In the kitchen. Standing, making coffee. Wearing a grey hoodie.']);
  assert.equal(store.S.error, null);
  store.setRun('stopped');
  assert.equal(page.said.length, 1, 'already stopped (the default): nothing to do');
  store.setRun('running');
  store.setRun('stopped');
  await new Promise((r) => setTimeout(r, 0)); // the save goes on after the render
  assert.deepEqual(page.said.slice(1), [['say', 'Automatic update started.'], ['say', 'Automatic update stopped.']]);
  const saved = JSON.parse(page.files.get('settings.json'));
  assert.deepEqual([saved.kinId, saved.autoState, saved.stoppedAt], ['k1', 'stopped', NOW.toISOString()]);
  assert.equal(ACTION, 'update_status');
});

test('a failed action summary from the host is never displayed or announced', async () => {
  const page = fakePage({actionReply:{ok:false,summary:'Authorization: Bearer CANARY_TEST_ONLY_PRIVATE'}});
  const store = createStore({channel:page.channel,kins:[{id:'k1',name:'Isa'}],clock:()=>NOW,onChange:()=>{},announcer:page.announcer});
  await store.loadSettings();
  await store.update('read');
  assert.equal(store.S.error.text, 'The update failed. Try again in a moment.');
  assert.doesNotMatch(JSON.stringify([store.S.error,page.said]), /Authorization|CANARY_TEST_ONLY_PRIVATE/);
});
