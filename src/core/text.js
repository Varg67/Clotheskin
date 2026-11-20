export function capitalizeFirst(s) {
  const str = String(s ?? '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

/** Collapses whitespace, trims and caps the length. */
export function cleanString(s, max = 200) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** One line, at most `max` characters, marked with "…" when cut (kin end keeps 500). */
export function oneLine(text, max = 500) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
