// Every key a Kin may use in its answer, by what it means, in English and in Portuguese. The Kin is asked for English
// keys, but a Kin chatting in Portuguese may translate them; both are read, and the Portuguese ones are reported
// (see notEnglishKeys in outfit.js). Each word is written once here: the lookups and the Portuguese list derive from it.
import { WEAR_SLOTS } from './constants.js';

/** "Top Wear", "top_wear", "topwear" and "Localização" -> one key name: no case, spaces, underscores, hyphens or accents. */
const keyName = (k) => String(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s_-]+/g, '');

/** The reading's own fields. "position" counts as pose: it was the original name of that field. */
const READING_WORDS = {
  location: { en: ['location', 'place', 'where', 'currentlocation', 'currentplace'], pt: ['localizacao', 'local', 'lugar', 'onde'] },
  pose: { en: ['pose', 'posture', 'position', 'stance', 'bodyposition'], pt: ['postura', 'posicao'] },
  action: { en: ['action', 'activity', 'doing', 'doingnow', 'currentaction', 'currentactivity', 'currentlydoing'], pt: ['acao', 'atividade', 'fazendo'] },
  hair: { en: ['hair', 'hairstyle', 'hairdo', 'haircut'], pt: ['cabelo', 'penteado'] },
  makeup: { en: ['makeup', 'cosmetics', 'facemakeup'], pt: ['maquiagem', 'maquilhagem'] },
};

/** Other words for the slots (the slot identifiers are obscure, "topunderwear", so common slips are understood). */
const SLOT_WORDS = {
  headwear: { en: ['hat', 'cap'], pt: ['chapeu', 'bone'] },
  topwear: { en: ['top', 'tops'], pt: [] },
  bottomwear: { en: ['bottom', 'bottoms'], pt: [] },
  footwear: { en: ['shoes', 'shoe', 'boots'], pt: ['sapatos', 'calcados', 'tenis'] },
  footunderwear: { en: ['socks', 'stockings', 'tights'], pt: ['meias'] },
  topunderwear: { en: ['bra', 'undershirt'], pt: [] },
  bottomunderwear: { en: ['underwear', 'underpants', 'panties'], pt: [] },
  'eyes-accessory': { en: ['glasses'], pt: ['oculos'] },
  'neck-accessory': { en: ['necklace'], pt: ['colar'] },
  'ears-accessory': { en: ['earrings'], pt: ['brincos'] },
  'arms-accessory': { en: ['bracelet', 'watch'], pt: ['pulseira', 'relogio'] },
  'hands-accessory': { en: ['ring', 'gloves'], pt: ['anel'] },
  'waist-accessory': { en: ['belt'], pt: ['cinto'] },
  bags: { en: ['bag', 'backpack', 'handbag'], pt: ['bolsa', 'mochila', 'bolsas'] },
};

/** A Kin that ignores the slot names and answers {"clothing":[...],"accessories":[...]} is still understood. */
const LOOSE_WORDS = {
  clothing: { en: ['clothing', 'clothes', 'outfit', 'wearing', 'garments'], pt: ['roupa', 'roupas', 'vestindo', 'traje', 'vestuario'] },
  accessories: { en: ['accessories', 'accessory', 'extras', 'jewelry', 'jewellery'], pt: ['acessorios', 'acessorio', 'joias'] },
};

/**
 * word -> meaning, for every word of a table. A Map: "constructor" or "toString" from a Kin finds nothing.
 * @param {Object<string, { en: string[], pt: string[] }>} table
 * @returns {Array<[string, string]>}
 */
const entries = (table) => Object.entries(table).flatMap(([meaning, { en, pt }]) => [...en, ...pt].map((w) => pair(w, meaning)));
/** @returns {[string, string]} */
const pair = (word, meaning) => [word, meaning];
const READING_BY_WORD = new Map(entries(READING_WORDS));
const SLOT_BY_WORD = new Map([...WEAR_SLOTS.map((s) => pair(keyName(s), s)), ...entries(SLOT_WORDS)]);
const LOOSE_BY_WORD = new Map(entries(LOOSE_WORDS));
const PORTUGUESE = new Set([READING_WORDS, SLOT_WORDS, LOOSE_WORDS].flatMap((table) => Object.values(table).flatMap(({ pt }) => pt)));

/** The reading field a key means ('location', 'pose', 'action', 'hair', 'makeup'), or undefined. */
export const readingFieldOf = (k) => READING_BY_WORD.get(keyName(k));

/** The slot a key means ("Shoes" -> 'footwear'), or undefined. */
export const normalizeSlot = (v) => (typeof v === 'string' ? SLOT_BY_WORD.get(keyName(v)) : undefined);

/** 'clothing' or 'accessories' for a key that groups pieces without naming a slot, or undefined. */
export const looseGroupOf = (k) => LOOSE_BY_WORD.get(keyName(k));

/** Whether a key is one of the Portuguese words above (written in Portuguese instead of English). */
export const isPortugueseKey = (k) => PORTUGUESE.has(keyName(k));
