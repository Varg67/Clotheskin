import test from 'node:test';
import assert from 'node:assert/strict';
import { run, fresh, names, byName } from './helpers.js';
import { checkInvariants, displayValue } from '../screen/src/core/model.js';

function dressed() {
  let r = fresh();
  r = run(r, {
    state_updates: { location: 'living room at the shared house', position: 'sitting on the sofa' },
    item_changes: [
      { op: 'wear', item_name: 'T-shirt', slot: 'topwear' },
      { op: 'wear', item_name: 'lab coat', slot: 'topwear', over_item_name: 'T-shirt', condition: 'wet' },
    ],
  }).record;
  return r;
}

test('spec example: cardigan over T-shirt, bun, standing; location untouched', () => {
  const start = dressed();
  const out = run(start, {
    state_updates: { hair: 'bun', position: 'standing' },
    item_changes: [{ op: 'wear', item_name: 'green cardigan', slot: 'topwear', over_item_name: 'T-shirt' }],
    unresolved: [],
  });
  assert.equal(out.record.fields.hair.value, 'bun');
  assert.equal(out.record.fields.position.value, 'standing');
  assert.equal(out.record.fields.location.value, 'living room at the shared house');
  // layer order inner -> outer: T-shirt, green cardigan, lab coat
  assert.deepEqual(names(out.record, 'topwear'), ['T-shirt', 'green cardigan', 'lab coat']);
  assert.deepEqual(checkInvariants(out.record), []);
});

test('re-reading the same message twice yields a single cardigan', () => {
  const doc = { state_updates: {}, item_changes: [{ op: 'wear', item_name: 'green cardigan', slot: 'topwear', over_item_name: 'T-shirt' }] };
  let r = dressed();
  r = run(r, doc).record;
  r = run(r, doc).record;
  r = run(r, doc).record;
  assert.equal(Object.values(r.items).filter((i) => i.name === 'green cardigan').length, 1);
  assert.equal(names(r, 'topwear').filter((n) => n === 'green cardigan').length, 1);
  assert.equal(Object.values(r.items).filter((i) => i.name === 'T-shirt').length, 1);
});

test('wet lab coat taken off stays wet on the chair; T-shirt remains worn', () => {
  const r = run(dressed(), {
    item_changes: [{ op: 'remove', item_name: 'lab coat', to: { type: 'scene', place: 'chair' } }],
  }).record;
  assert.deepEqual(names(r, 'topwear'), ['T-shirt']);
  const coat = byName(r, 'lab coat');
  assert.equal(coat.condition, 'wet');
  assert.deepEqual(coat.place, { type: 'scene', place: 'chair' });
  assert.deepEqual(checkInvariants(r), []);
});

test('glasses stored in the left pocket of the cardigan stay there when the cardigan comes off', () => {
  let r = run(dressed(), {
    item_changes: [
      { op: 'wear', item_name: 'glasses', slot: 'eyes-accessory' },
      { op: 'wear', item_name: 'green cardigan', slot: 'topwear', over_item_name: 'T-shirt' },
    ],
  }).record;
  r = run(r, {
    item_changes: [
      { op: 'move', item_name: 'glasses', to: { type: 'pocket', container_item_name: 'green cardigan', pocket: 'left pocket', side: 'left' } },
      { op: 'remove', item_name: 'green cardigan' },
    ],
  }).record;
  assert.deepEqual(names(r, 'eyes-accessory'), []);
  assert.ok(!names(r, 'topwear').includes('green cardigan'));
  const g = byName(r, 'glasses');
  const c = byName(r, 'green cardigan');
  assert.equal(g.place.type, 'pocket');
  assert.equal(g.place.itemId, c.id);
  assert.equal(c.pockets.find((p) => p.id === g.place.pocketId).label, 'left pocket');
  assert.deepEqual(checkInvariants(r), []);
});

test('phone goes into the brown bag and travels with it; never in hand or pocket', () => {
  const r = run(dressed(), {
    item_changes: [
      { op: 'move', item_name: 'phone', to: { type: 'bag', container_item_name: 'brown bag' } },
      { op: 'move', item_name: 'brown bag', kind: 'bag', to: { type: 'scene', place: 'living room' } },
    ],
  }).record;
  const phone = byName(r, 'phone');
  const bag = byName(r, 'brown bag');
  assert.equal(bag.kind, 'bag');
  assert.deepEqual(phone.place, { type: 'bag', itemId: bag.id });
  assert.deepEqual(bag.place, { type: 'scene', place: 'living room' });
  assert.deepEqual(checkInvariants(r), []);
});

test('held phone with pocketless trousers and no bag: hand is valid, no container invented', () => {
  let r = run(dressed(), {
    item_changes: [{ op: 'wear', item_name: 'trousers', slot: 'bottomwear', pockets: [] }],
  }).record;
  r = run(r, { item_changes: [{ op: 'move', item_name: 'phone', to: { type: 'held', hand: 'right' } }] }).record;
  assert.deepEqual(byName(r, 'phone').place, { type: 'held', hand: 'right' });
  assert.deepEqual(byName(r, 'trousers').pockets, []);
  assert.equal(Object.values(r.items).filter((i) => i.kind === 'bag').length, 0);
  // a pocket destination on confirmed pocketless trousers is skipped, not invented
  const bad = run(r, { item_changes: [{ op: 'move', item_name: 'phone', to: { type: 'pocket', container_item_name: 'trousers' } }] });
  assert.equal(bad.skipped.length, 1);
  assert.deepEqual(byName(bad.record, 'phone').place, { type: 'held', hand: 'right' });
});

test('makeup: absent from updates keeps previous (even unknown); "none" shows No makeup', () => {
  let r = fresh();
  r = run(r, { state_updates: { position: 'standing' } }).record;
  assert.equal(r.fields.makeup.value, null);
  assert.equal(displayValue('makeup', r.fields.makeup.value), 'Unknown');
  r = run(r, { state_updates: { makeup: 'None' } }).record;
  assert.equal(r.fields.makeup.value, 'none');
  assert.equal(displayValue('makeup', r.fields.makeup.value), 'No makeup');
  r = run(r, { state_updates: {} }).record;
  assert.equal(r.fields.makeup.value, 'none');
});

test('leaving changes posture only; arrival changes location', () => {
  let r = dressed();
  r = run(r, { state_updates: { position: 'standing' } }).record;
  assert.equal(r.fields.location.value, 'living room at the shared house');
  r = run(r, { state_updates: { location: 'hospital' } }).record;
  assert.equal(r.fields.location.value, 'hospital');
});

test('one-piece dress counts as a single worn item; clip goes to head-accessory; hair unchanged', () => {
  let r = run(dressed(), { state_updates: { hair: 'loose' } }).record;
  r = run(r, {
    item_changes: [
      { op: 'wear', item_name: 'black dress', slot: 'topwear', covers: ['bottomwear'] },
      { op: 'wear', item_name: 'hair clip', slot: 'head-accessory' },
    ],
  }).record;
  const dress = byName(r, 'black dress');
  assert.equal(Object.values(r.items).filter((i) => i.name === 'black dress').length, 1);
  assert.ok(r.clothing.topwear.includes(dress.id) && r.clothing.bottomwear.includes(dress.id));
  assert.deepEqual(names(r, 'head-accessory'), ['hair clip']);
  assert.equal(r.fields.hair.value, 'loose');
  // taking the dress off clears both slots
  const off = run(r, { item_changes: [{ op: 'remove', item_name: 'black dress' }] }).record;
  assert.ok(!off.clothing.topwear.includes(dress.id) && !off.clothing.bottomwear.includes(dress.id));
  assert.deepEqual(checkInvariants(off), []);
});

test('empty slot (confirmed) differs from unknown slot', () => {
  let r = fresh();
  assert.equal(r.clothing.headwear, null);
  r = run(r, { item_changes: [{ op: 'wear', item_name: 'cap', slot: 'headwear' }] }).record;
  r = run(r, { item_changes: [{ op: 'remove', item_name: 'cap' }] }).record;
  assert.deepEqual(r.clothing.headwear, []);
  assert.equal(r.clothing.footwear, null);
});

test('wear mode and condition changes are separate attributes', () => {
  let r = run(dressed(), { item_changes: [
    { op: 'change_wear_mode', item_name: 'lab coat', wear_mode: 'open' },
    { op: 'change_condition', item_name: 'lab coat', condition: 'stained' },
  ] }).record;
  const coat = byName(r, 'lab coat');
  assert.equal(coat.wearMode, 'open');
  assert.equal(coat.condition, 'stained');
  r = run(r, { item_changes: [{ op: 'change_wear_mode', item_name: 'lab coat', wear_mode: null }] }).record;
  assert.equal(byName(r, 'lab coat').wearMode, null);
  assert.equal(byName(r, 'lab coat').condition, 'stained');
});

test('ambiguous reference: independent changes apply, ambiguity goes to unresolved', () => {
  let r = run(fresh(), { item_changes: [
    { op: 'wear', item_name: 'green cardigan', slot: 'topwear' },
    { op: 'wear', item_name: 'grey cardigan', slot: 'topwear' },
  ] }).record;
  const before = structuredClone(byName(r, 'green cardigan'));
  const out = run(r, {
    state_updates: { hair: 'loose' },
    item_changes: [{ op: 'change_condition', item_name: 'cardigan', condition: 'wet' }],
  });
  assert.equal(out.record.fields.hair.value, 'loose');
  assert.deepEqual(byName(out.record, 'green cardigan'), before);
  assert.equal(out.record.unresolved.length, 1);
  assert.match(out.record.unresolved[0].note, /Ambiguous reference "cardigan"/);
});

test('removing an item never invents or drops the others; layered removal keeps inner layers', () => {
  const r = run(dressed(), { item_changes: [{ op: 'remove', item_name: 'T-shirt' }] }).record;
  assert.deepEqual(names(r, 'topwear'), ['lab coat']);
});

test('moving a bag does not need contents to move: contents reference the container', () => {
  let r = run(fresh(), { item_changes: [
    { op: 'move', item_name: 'keys', to: { type: 'bag', container_item_name: 'backpack' } },
    { op: 'wear', item_name: 'backpack', slot: 'bags' },
  ] }).record;
  assert.deepEqual(names(r, 'bags'), ['backpack']);
  r = run(r, { item_changes: [{ op: 'move', item_name: 'backpack', to: { type: 'scene', place: 'hallway' } }] }).record;
  assert.deepEqual(r.bags, []);
  assert.equal(byName(r, 'keys').place.itemId, byName(r, 'backpack').id);
  assert.deepEqual(checkInvariants(r), []);
});

test('containers cannot contain themselves or each other', () => {
  let r = run(fresh(), { item_changes: [
    { op: 'move', item_name: 'small bag', kind: 'bag', to: { type: 'bag', container_item_name: 'big bag' } },
  ] }).record;
  const out = run(r, { item_changes: [{ op: 'move', item_name: 'big bag', to: { type: 'bag', container_item_name: 'small bag' } }] });
  assert.equal(out.skipped.length, 1);
  assert.deepEqual(checkInvariants(out.record), []);
});
