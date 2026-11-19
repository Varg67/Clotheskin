import { createRecord } from '../core/model.js';
import { applyDocument } from '../core/apply.js';

export const DEMO_PROFILE_ID = 'demo-isa';
export const DEMO_LOCATION = 'living room at the shared house';

export function demoProfile() {
  return {
    id: DEMO_PROFILE_ID,
    name: 'Isa',
    pronouns: 'she/her',
    avatarUrl: 'assets/demo/isa-avatar.svg',
    demo: true,
    createdAt: '2000-01-01T00:00:00.000Z',
    places: [{ id: 'place-demo-living-room', name: DEMO_LOCATION, imageUrl: 'assets/demo/living-room.svg' }],
  };
}

const meta = (scene) => ({ demo: true, scene, target_id: DEMO_PROFILE_ID });

const SEED = {
  meta: meta('seed'),
  state_updates: { location: DEMO_LOCATION, position: 'sitting on the sofa', hair: 'loose' },
  item_changes: [
    { op: 'wear', item_name: 'T-shirt', slot: 'topwear' },
    { op: 'wear', item_name: 'lab coat', slot: 'topwear', over_item_name: 'T-shirt', condition: 'wet' },
    { op: 'wear', item_name: 'jeans', slot: 'bottomwear', pockets: [{ label: 'left pocket', side: 'left' }, { label: 'right pocket', side: 'right' }] },
    { op: 'wear', item_name: 'sneakers', slot: 'footwear' },
    { op: 'wear', item_name: 'glasses', slot: 'eyes-accessory' },
  ],
  unresolved: [],
};

/** Builds the demo record through the same pipeline as a real reading. */
export function buildDemoRecord(now = new Date().toISOString()) {
  const base = createRecord(DEMO_PROFILE_ID, null);
  const { record } = applyDocument(base, { ...SEED, meta: SEED.meta }, { baseRev: 0, now, source: 'demo' });
  record.lastRead = { at: now, ticketId: 'demo-seed', applied: 0, skipped: 0 };
  record.history = [{ at: now, source: 'demo', summary: ['Demo profile loaded'], skipped: [] }];
  record.processedMessageIds = [];
  return record;
}

export async function seedDemo(repo, { reset = false, now } = {}) {
  const existing = await repo.getProfile(DEMO_PROFILE_ID);
  if (!existing || reset) {
    const prior = existing || null;
    const profile = demoProfile();
    if (prior && !reset) return;
    await repo.saveProfile(profile);
    await repo.putRecord(buildDemoRecord(now));
  }
}

const resp = (scene, state_updates, item_changes, unresolved = []) =>
  JSON.stringify({ meta: meta(scene), state_updates, item_changes, unresolved }, null, 2);

/** Demo scenes. Conversation text is what a user would paste; responses are labelled demo responses. */
export const DEMO_SCENES = [
  {
    id: 'lab-coat',
    title: 'Wet lab coat on the chair',
    conversation: 'Isa: *peels off the wet lab coat and drapes it over the chair* Finally dry. My T-shirt survived, at least.',
    response: resp('lab-coat', {}, [
      { op: 'remove', item_name: 'lab coat', to: { type: 'scene', place: 'chair' } },
    ]),
  },
  {
    id: 'cardigan-bun',
    title: 'Cardigan, bun, standing up',
    conversation: 'Isa: *sits on the sofa* I put on a green cardigan over my T-shirt, tie my hair into a bun and stand up. I\'ll head to college soon.',
    response: resp('cardigan-bun', { hair: 'bun', position: 'standing' }, [
      { op: 'wear', item_name: 'green cardigan', slot: 'topwear', over_item_name: 'T-shirt' },
    ]),
  },
  {
    id: 'cardigan-bun-pt',
    title: 'Same scene in Portuguese (no duplicates)',
    conversation: 'Isa: Visto um cardigan verde por cima da camiseta, prendo o cabelo num coque e levanto. Daqui a pouco vou pra faculdade.',
    response: resp('cardigan-bun-pt', { hair: 'bun', position: 'standing' }, [
      { op: 'wear', item_name: 'green cardigan', slot: 'topwear', over_item_name: 'T-shirt' },
    ]),
  },
  {
    id: 'glasses-pocket',
    title: 'Glasses in the cardigan pocket',
    conversation: 'Isa: I tuck my glasses into the left pocket of the cardigan, then slip the cardigan off.',
    response: resp('glasses-pocket', {}, [
      { op: 'move', item_name: 'glasses', to: { type: 'pocket', container_item_name: 'green cardigan', pocket: 'left pocket', side: 'left' } },
      { op: 'remove', item_name: 'green cardigan', to: { type: 'scene', place: 'sofa' } },
    ]),
  },
  {
    id: 'phone-bag',
    title: 'Phone in the brown bag',
    conversation: 'Isa: I drop my phone into the brown bag and leave the bag here in the living room.',
    response: resp('phone-bag', {}, [
      { op: 'move', item_name: 'phone', kind: 'object', to: { type: 'bag', container_item_name: 'brown bag' } },
      { op: 'move', item_name: 'brown bag', kind: 'bag', to: { type: 'scene', place: 'living room' } },
    ]),
  },
  {
    id: 'no-makeup',
    title: 'Makeup removed',
    conversation: 'Isa: I wiped off all my makeup. Bare face tonight.',
    response: resp('no-makeup', { makeup: 'none' }, []),
  },
  {
    id: 'leaving',
    title: 'Getting up to leave (location stays)',
    conversation: 'Isa: I\'m getting up, I have to leave for the hospital shift.\nUser: Take care!',
    response: resp('leaving', { position: 'standing' }, []),
  },
  {
    id: 'arrived',
    title: 'Arrived at the hospital',
    conversation: 'Isa: I\'ve arrived at the hospital. Badge on, locker open.',
    response: resp('arrived', { location: 'hospital' }, []),
  },
  {
    id: 'dress-clip',
    title: 'Dress and hair clip',
    conversation: 'Isa: I change into a black dress and pin a clip into my hair.',
    response: resp('dress-clip', {}, [
      { op: 'wear', item_name: 'black dress', slot: 'topwear', covers: ['bottomwear'] },
      { op: 'wear', item_name: 'hair clip', slot: 'head-accessory' },
    ]),
  },
];
