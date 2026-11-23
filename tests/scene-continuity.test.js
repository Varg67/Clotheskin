import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading } from '../src/core/outfit.js';
import { runProgram } from '../run/program.js';
import { fakeKindroid } from './support/fake-kindroid.js';

function session(name) {
  const k = fakeKindroid({kins: [{id:'k1', name}], settings: {kinId:'k1', tellLook:true}});
  async function read(fields) {
    k.answers.reading.splice(0, Infinity, JSON.stringify(fields));
    const result = await runProgram({event:{trigger:'action',action:'update_status',input:{kin:'k1',op:'read'}},kin:k.kin,clock:k.clock,retryAfterMs:0});
    assert.ok(result.ok,result.message);
    k.advance(15);
    return k.entry().reading;
  }
  return {k,read};
}

test('another speaker never becomes a current observation or sends a look fact', async () => {
  const {k,read} = session('Élodie');
  const first = await read({pose:'standing', action:'making coffee', makeup:'red lipstick', topwear:['a blue shirt']});
  const count = k.tells().length;
  const next = await read({ action:'Marina smiles', makeup:'Marina wears no makeup', topwear:['Marina is wearing a red dress'] });
  assert.equal(next.doing,first.doing);
  assert.deepEqual(next.seen,first.seen);
  assert.equal(k.tells().length,count);
  assert.equal((await read({action:'Élodie is talking with Marina while she is reading'})).doing,'Talking with Marina.');
});

test('explicit stop retires only the named activity and keeps the old posture time', async () => {
  const {read}=session('Sam');
  const first = await read({pose:'sitting on the sofa',action:'reading a book'});
  assert.equal((await read({action:'stopped cooking'})).doing,first.doing);
  const next=await read({action:'stopped reading'});
  assert.equal(next.doing,'Sitting on the sofa.');
  assert.equal(next.seen.doing,first.seen.doing);
  assert.equal((await read({})).doing,next.doing);
});

test('subject is checked inside quotations, emphasis, wrapped documents and lists', () => {
  const parse = doc => parseReading(JSON.stringify(doc),'Isa');
  for (const action of ['Marina smiles','"Marina is sleeping"','*Marina is sleeping* "Morning!"','Marina is folding towels, and she is sleeping','My sister is sleeping']) {
    assert.equal(parse({action}).action,null,action);
  }
  assert.equal(parse({Marina:{action:'making coffee'}}).action,null);
  assert.equal(parse({Isa:{action:'making coffee'}}).action,'making coffee');
  assert.equal(parse({action:['Marina is sleeping','Isa is reading']}).action,'reading');
  assert.equal(parse({action:['reading',4]}).ok,false);
  assert.equal(parse({action:'*Isa is making coffee* "Morning!"'}).action,'making coffee');
});

test('partial wardrobe updates preserve other slots; an explicit removal survives silence', async () => {
  const {k,read}=session('Marina');
  await read({topwear:['a blue shirt'],bottomwear:['black jeans']});
  const earrings=await read({'ears-accessory':['silver earrings']});
  assert.match(earrings.outfit,/blue shirt and black jeans, with silver earrings/);
  assert.match(k.tells().at(-1)[1],/blue shirt and black jeans, with silver earrings/);
  const change=await read({topwear:['a red blouse']});
  assert.doesNotMatch(change.outfit,/blue shirt/);
  assert.match(change.outfit,/black jeans/);
  const removed=await read({topwear:['a red blouse (removed)']});
  assert.doesNotMatch(removed.outfit,/red blouse/);
  assert.equal((await read({location:'at home'})).outfit,removed.outfit);
  const bare=await read({clothing:['naked']});
  assert.doesNotMatch(bare.outfit,/jeans|blouse/);
});

test('an explicit negative retires the matching location only', async () => {
  const {read}=session('Marina');
  const home=await read({location:'at home'});
  assert.equal((await read({location:'not at the station'})).seen.location,home.seen.location);
  const left=await read({location:'I am no longer at home'});
  assert.equal(left.location,'No location described in the recent chat.');
  assert.equal(left.seen.location,undefined);
  assert.equal((await read({action:'walking'})).location,left.location);
});

test('an older status with only a rendered outfit accepts an accessory update', async () => {
  const {k,read}=session('Marina');
  const before=await read({topwear:['a blue shirt'],bottomwear:['black jeans']});
  const persisted=k.status();
  delete persisted.kins.k1.reading.wardrobe;
  k.files.set('status.json',JSON.stringify(persisted));
  const next=await read({'ears-accessory':['silver earrings']});
  assert.ok(next.outfit.startsWith(before.outfit.slice(0,-1)));
  assert.match(next.outfit,/with silver earrings/);
});
