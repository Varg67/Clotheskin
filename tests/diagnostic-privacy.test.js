import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../run/program.js';
import { fakeKindroid } from './support/fake-kindroid.js';
import { serviceProblem } from '../src/core/schedule.js';
import { normalizeStatus } from '../src/core/state.js';

const marker = 'CANARY_TEST_ONLY_PRIVATE';
const diagnostic = '403 Forbidden, Authorization: Bearer ' + marker;
const schedule = { trigger: 'schedule' };

function run(k, logs, event = schedule) {
  return runProgram({ event, kin: k.kin, clock: k.clock, retryAfterMs: 0, log: line => logs.push(line) });
}

test('service diagnostics are fixed categories even if a credential follows the status', () => {
  for (const [reason, expected] of [
    ['403 Forbidden', 'access denied'], ['maintenance', 'Kindroid is under maintenance'],
    ['ETIMEDOUT', 'request timed out'], ['429', 'service busy'], ['unclassified error', 'service request failed'],
  ]) {
    const filtered = serviceProblem(new Error(reason + ' ' + marker));
    assert.equal(filtered, expected);
    assert.equal(serviceProblem(filtered), expected, 'safe across both CLI and run boundaries');
  }
});

for (const failure of ['ask', 'tell look', 'tell dream', 'kins', 'files get', 'files put']) {
  test('private service error stays out of outputs: ' + failure, async () => {
    const k = fakeKindroid({settings:{autoState:'running', kinId:'k1', tellLook:true, tellDream:true}});
    const logs = [];
    const reject = async () => { throw new Error(diagnostic); };
    k.answers.reading.push('{"topwear":["a blue shirt"]}');
    let event = schedule;
    if (failure === 'tell dream') {
      k.answers.reading.splice(0, 1, '{"action":"sleeping"}');
      k.answers.sleep.push('{"sleeping":true,"wake_at":"07:30"}');
      await run(k, logs);
      assert.ok(k.entry().sleep);
      k.answers.dream.push('{"dream":"I saw a lake","remembered":"all"}');
      event = {trigger:'action',action:'update_status',input:{kin:'k1',op:'wake'}};
    }
    let called = false;
    const fail = () => { called = true; return reject(); };
    if (failure.startsWith('tell')) k.kin.tell = fail;
    else if (failure.startsWith('files ')) k.kin[failure.slice(6)] = fail;
    else k.kin[failure] = fail;
    let result;
    try { result = await run(k, logs, event); } catch (e) { result = e.message; }
    assert.ok(called);
    assert.doesNotMatch(JSON.stringify([result, logs, k.status()]), /CANARY_TEST_ONLY_PRIVATE|Authorization/);
  });
}

test('old diagnostics are hidden on read and scrubbed on the next start even while stopped', async () => {
  const k = fakeKindroid({settings:{autoState:'stopped',kinId:'k1'}});
  const legacy = {v:1,runVersion:'0.6.0',kins:{k1:{name:'Isa',lastRunAt:k.clock().toISOString(),errorKind:'server',
    failures:2,error:diagnostic,note:diagnostic},k2:{name:'Marina',lookError:diagnostic}}};
  k.files.set('status.json', JSON.stringify(legacy));
  assert.doesNotMatch(JSON.stringify(normalizeStatus(k.files.get('status.json'))), /CANARY_TEST_ONLY_PRIVATE/);
  const logs=[];
  await run(k,logs);
  assert.doesNotMatch(JSON.stringify([logs,k.status()]), /CANARY_TEST_ONLY_PRIVATE/);
  assert.equal(k.entry().name,'Isa');
  assert.equal(k.entry().failures,2);
  assert.equal(k.entry('k2').name,'Marina');
  const writes=k.puts();
  assert.equal(writes,1);
  await run(k,logs);
  assert.equal(k.puts(),writes);
});
