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
