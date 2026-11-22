// Invisible characters a model may leak (zero-width space, word joiner, byte-order mark, soft hyphen). The zero-width
// joiner is kept: emoji sequences need it.
const INVISIBLE = /[\u200B\u2060\uFEFF\u00AD]/g;
/** Never ends in half of an emoji (a lone surrogate) after a cut. */
const dropHalfChar = (s) => s.replace(/[\uD800-\uDBFF]$/, '');

export function capitalizeFirst(s) {
  const str = String(s ?? '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

/** Drops invisible characters, collapses whitespace, trims and caps the length (never half an emoji). */
export function cleanString(s, max = 200) {
  return dropHalfChar(String(s ?? '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, max));
}

/** One line, at most `max` characters, marked with "…" when cut. */
export function oneLine(text, max = 500) {
  const s = String(text ?? '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${dropHalfChar(s.slice(0, max - 1))}…`;
}

/** "in the kitchen" -> "In the kitchen." No period after one already there, or after the "…" of a cut. */
export function toSentence(s) {
  const str = String(s ?? '');
  return capitalizeFirst(/[.!?…]$/.test(str) ? str : `${str}.`);
}

/** Cuts at a word boundary and marks the cut with "…". */
export function clipWords(s, max) {
  return s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s;
}

/** Drops the punctuation and spaces at the end ("in the kitchen." -> "in the kitchen"). */
export const trimEndPunctuation = (s) => s.replace(/[.;,!?\s]+$/, '');

/** Drops what a model wraps a value in: markdown emphasis, quotes and brackets ("**'in the kitchen'**"). */
export const stripWrapping = (s) => s.replace(/^[\s*_"'“”‘’()[\]]+/, '').replace(/[\s*_"'“”‘’()[\]]+$/, '');

/** "a" / "a and b" / "a, b and c". */
export function joinNatural(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
