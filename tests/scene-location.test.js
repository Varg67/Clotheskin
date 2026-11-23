import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLocation, describeLocation } from '../src/core/phrases.js';

const where = (value) => describeLocation(cleanLocation(value));
test('company and remote contacts do not replace a place or erase a route', () => {
  assert.equal(where('walking with Isa to the station'), 'Walking to the station.');
  assert.equal(where('walking with Zoé and Alex through the park'), 'Walking through the park.');
  assert.equal(where('walking with Isa, who is going to work'), 'Walking.');
  assert.equal(where('in the garden with my sister from work'), 'In the garden.');
  assert.equal(where("I'm at home on the phone with Isa, who is at the pharmacy"), 'At home.');
  assert.equal(cleanLocation('on the phone with Isa at the pharmacy'), null);
  assert.equal(where('in a room with a view'), 'In a room with a view.');
});

test('only a confirmed current place or route advances the location', () => {
  for (const text of ['heading to the station tomorrow', 'Maybe at the station or at the airport', 'not at the station']) {
    assert.equal(cleanLocation(text), null, text);
  }
  assert.equal(where('I just left home'), 'Left home.');
  assert.equal(where('I left home and am now at the station'), 'At the station.');
  assert.equal(where('heading to tomorrow’s meeting'), 'Heading to tomorrow’s meeting.');
  assert.equal(where('Left Bank'), 'In Left Bank.');
  assert.equal(where('May Street'), 'In May Street.');
  assert.equal(where('leaving the station'), 'Leaving the station.');
  assert.equal(where('on the bus to the station'), 'On the bus to the station.');
  assert.equal(where('at home until tomorrow'), 'At home until tomorrow.');
});

test('capitalized postures use the same place as lowercase postures; named places survive', () => {
  assert.equal(where('Sitting on the sofa'), 'On the sofa.');
  assert.equal(where('Standing by the gate'), 'By the gate.');
  assert.equal(where('Waiting room'), 'In the waiting room.');
  assert.equal(where('Spring Hill'), 'In Spring Hill.');
  assert.equal(where('Reading'), 'In Reading.');
});
