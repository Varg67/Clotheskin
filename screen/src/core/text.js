export function capitalizeFirst(s) {
  const str = String(s ?? '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

/** Collapses whitespace, trims and caps the length. */
export function cleanString(s, max = 200) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
