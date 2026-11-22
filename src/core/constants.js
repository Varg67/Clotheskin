// Canonical slot identifiers. Keys are English by design.

export const CLOTHING_SLOTS = [
  'headwear', 'topwear', 'topunderwear', 'bottomwear',
  'bottomunderwear', 'footwear', 'footunderwear',
];

export const ACCESSORY_SLOTS = [
  'head-accessory', 'ears-accessory', 'eyes-accessory', 'mouth-accessory',
  'neck-accessory', 'body-accessory', 'arms-accessory', 'hands-accessory',
  'waist-accessory', 'bottom-accessory', 'legs-accessory', 'foot-accessory',
];

export const BAG_SLOT = 'bags';
export const WEAR_SLOTS = [...CLOTHING_SLOTS, ...ACCESSORY_SLOTS, BAG_SLOT];

/**
 * What a reading's sentence says when the Kin's answer said nothing about it. Such a sentence is never carried over
 * from one reading to the next (state.js). Here, not in outfit.js, so the screen does not pull in the answer reader.
 */
export const NOT_DESCRIBED = Object.freeze({
  location: 'No location described in the recent chat.',
  doing: 'No pose or action described in the recent chat.',
  outfit: 'No outfit described in the recent chat.',
});
