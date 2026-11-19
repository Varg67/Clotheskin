// Canonical identifiers. Keys and canonical values are English by design.

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

export const FIELDS = ['clothing', 'accessories', 'hair', 'makeup', 'position', 'location'];
export const STATE_FIELDS = ['hair', 'makeup', 'position', 'location'];

export const SIDES = ['left', 'right', 'both', 'center'];
export const HANDS = ['left', 'right', 'both'];
export const ITEM_KINDS = ['clothing', 'accessory', 'bag', 'object'];
export const DESTINATION_TYPES = ['held', 'pocket', 'bag', 'scene'];
export const OPERATIONS = ['wear', 'remove', 'change_wear_mode', 'change_condition', 'move'];

export const SLOT_LABELS = {
  headwear: 'Headwear',
  topwear: 'Top',
  topunderwear: 'Top underwear',
  bottomwear: 'Bottom',
  bottomunderwear: 'Bottom underwear',
  footwear: 'Footwear',
  footunderwear: 'Socks and hosiery',
  'head-accessory': 'Head',
  'ears-accessory': 'Ears',
  'eyes-accessory': 'Eyes',
  'mouth-accessory': 'Mouth',
  'neck-accessory': 'Neck',
  'body-accessory': 'Body',
  'arms-accessory': 'Arms',
  'hands-accessory': 'Hands',
  'waist-accessory': 'Waist',
  'bottom-accessory': 'Hips',
  'legs-accessory': 'Legs',
  'foot-accessory': 'Feet',
  bags: 'Bags',
};

export const FIELD_LABELS = {
  clothing: 'Clothing',
  accessories: 'Accessories',
  hair: 'Hair',
  makeup: 'Makeup',
  position: 'Posture',
  location: 'Location',
};

export function slotCategory(slot) {
  if (CLOTHING_SLOTS.includes(slot)) return 'clothing';
  if (ACCESSORY_SLOTS.includes(slot)) return 'accessory';
  if (slot === BAG_SLOT) return 'bag';
  return null;
}
