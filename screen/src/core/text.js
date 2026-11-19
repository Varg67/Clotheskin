const LEADING = new Set(['the', 'a', 'an', 'her', 'his', 'their', 'my', 'your', 'its', 'our', 'some']);

/** Lowercased, accent-free, punctuation-free form used only for matching. */
export function normalizeText(s) {
  const raw = String(s ?? '');
  const n = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return n;
}

export function nameTokens(s) {
  const t = normalizeText(s).split(' ').filter(Boolean);
  while (t.length > 1 && LEADING.has(t[0])) t.shift();
  return t;
}

/** Matching key for item names: "The Green Cardigan" -> "green cardigan". */
export function canonicalName(s) {
  return nameTokens(s).join(' ');
}

export function slugify(s) {
  const slug = canonicalName(s).replace(/ /g, '-').slice(0, 32);
  return slug || 'item';
}

export function capitalizeFirst(s) {
  const str = String(s ?? '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

export function cleanString(s, max = 200) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function randomSuffix() {
  return Math.random().toString(36).slice(2, 6);
}
