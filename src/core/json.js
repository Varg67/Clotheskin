/**
 * @typedef {{ ok: false, error: string }} Failure  what every reading of an answer returns when it cannot be used
 * @typedef {{ ok: true, value: any, repaired?: boolean }} Parsed
 */

/** The longest answer that is searched and repaired; a longer one is read only if it is strict JSON. */
export const MAX_ANSWER_CHARS = 20000;

/**
 * Extracts a JSON object from what a Kin answered. A roleplay model often wraps it: narration before or after, a code
 * fence, a remark with braces after it ("Hope that helps {wink}"), the format example echoed before the real answer.
 * Strict JSON is tried first; only then are the usual slips repaired (trailing commas, curly quotes, comments,
 * 'single quotes', bare keys, Python's True/False/None, an object sent as a JSON string). A cut-off answer is an
 * error, never completed by guessing.
 */
/** @returns {Parsed | Failure} */
export function parseJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'The answer is empty.' };
  // The questions ask for one line of JSON (a few hundred characters). A longer answer is still read if it is strict
  // JSON (one linear parse), but it is not searched and repaired: every {...} in it would be one more parse. It is
  // refused without quoting it.
  if (raw.length > MAX_ANSWER_CHARS) return strictOnly(raw);
  const candidates = candidatesIn(raw);
  const parsed = firstParsed(candidates, (c) => [c], false) || firstParsed(candidates, repairs, true);
  if (parsed) return parsed;
  const first = raw.indexOf('{');
  if (first !== -1 && !balancedObjects(raw.slice(first)).length) return { ok: false, error: 'The answer was cut off before the end, so it is not valid JSON.' };
  // Not the parser's message: it quotes the answer, and the answer is the scene (it would reach logs and status.json).
  return { ok: false, error: 'The answer is not valid JSON.' };
}

/** @returns {Parsed | Failure} */
function strictOnly(raw) {
  try { return unwrap(JSON.parse(raw), false); } catch { return { ok: false, error: `The answer is too long to be read (${raw.length} characters).` }; }
}

/** Where the object may be: the whole text, a code fence, every balanced {...} (the last first: when the example is
 * echoed, the real answer comes after it), and the span from the first { to the last }. */
function candidatesIn(raw) {
  const candidates = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  candidates.push(...balancedObjects(raw).reverse());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  return candidates;
}

/** The repaired versions of a candidate, in the order they are tried. */
function repairs(candidate) {
  const loose = normalizeLoose(candidate);
  return [loose, loose.replace(/[“”]/g, '"')];
}

/** The first candidate (or version of it) that parses, or null. */
function firstParsed(candidates, versionsOf, repaired) {
  for (const c of candidates) {
    for (const v of versionsOf(c)) {
      try { return unwrap(JSON.parse(v), repaired); } catch { /* try the next one */ }
    }
  }
  return null;
}

/**
 * An object sent as a JSON string ("{\"location\":…}") is read as the object.
 * @returns {Parsed}
 */
function unwrap(value, repaired) {
  if (typeof value === 'string' && /^\s*\{/.test(value)) {
    try { return { ok: true, value: JSON.parse(value), repaired: true }; } catch { /* keep the string */ }
  }
  return repaired ? { ok: true, value, repaired: true } : { ok: true, value };
}

// An apostrophe inside narration ("it's") is not a quote: quotes only count inside an object, and a single quote only
// where a value or key can start.
const opensQuote = (text, i, depth) => depth > 0 && (text[i] === '"' || (text[i] === "'" && /[\s{[,:]/.test(text[i - 1] || ' ')));

/** The top-level {...} spans of a text, aware of quoted strings (both quote styles). */
function balancedObjects(text) {
  const out = [];
  let depth = 0; let start = -1; let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (opensQuote(text, i, depth)) { quote = c; continue; }
    if (c === '{') { if (depth === 0) start = i; depth += 1; }
    else if (c === '}' && depth > 0) { depth -= 1; if (depth === 0) out.push(text.slice(start, i + 1)); }
  }
  return out;
}

// ---- loose JSON to strict JSON. Each reader looks at position i of the text: it returns null when what is there is
// not its kind, or { out, end }: what goes into the strict JSON and the index of the last character it read.
const DOUBLE_QUOTES = new Set(['"', '“', '”']);
const BARE_KEY = /([A-Za-z_\u00C0-\u024F][\wÀ-ɏ -]*?)\s*:/y; // letters up to a colon, read where the key starts
const BARE_WORD = /[A-Za-z]+/y;
const PYTHON = { True: 'true', False: 'false', None: 'null' };

/** "a string" (straight or curly quotes) is copied as it is, with straight quotes. */
function doubleQuoted(text, i) {
  if (!DOUBLE_QUOTES.has(text[i])) return null;
  let j = i + 1;
  while (j < text.length && !DOUBLE_QUOTES.has(text[j])) j += text[j] === '\\' ? 2 : 1;
  return { out: `"${text.slice(i + 1, j)}"`, end: j };
}

/** 'a string' -> "a string" (an escaped \' becomes ', a " inside is escaped). */
function singleQuoted(text, i) {
  if (text[i] !== "'") return null;
  let j = i + 1; let s = '';
  while (j < text.length && text[j] !== "'") {
    if (text[j] === '\\' && text[j + 1] === "'") { s += "'"; j += 2; continue; }
    s += text[j] === '"' ? '\\"' : text[j];
    j += 1;
  }
  return { out: `"${s}"`, end: j };
}

/** A // comment is dropped up to the end of its line (the line break stays). */
function lineComment(text, i) {
  if (text[i] !== '/' || text[i + 1] !== '/') return null;
  const end = text.indexOf('\n', i);
  return { out: '\n', end: end === -1 ? text.length : end };
}

/** A block comment is dropped. */
function blockComment(text, i) {
  if (text[i] !== '/' || text[i + 1] !== '*') return null;
  const end = text.indexOf('*/', i + 2);
  return { out: '', end: end === -1 ? text.length : end + 1 };
}

/** A bare key after { or , gets its quotes ({location: …} -> {"location": …}). */
function bareKey(text, i, out) {
  if (!/[A-Za-z_\u00C0-\u024F]/.test(text[i]) || !/[{,]$/.test(out.trimEnd())) return null;
  BARE_KEY.lastIndex = i;
  const m = BARE_KEY.exec(text);
  return m ? { out: `"${m[1]}":`, end: i + m[0].length - 1 } : { out: text[i], end: i };
}

/** A bare word in a value: Python's True, False and None become JSON; any other word is copied. */
function bareWord(text, i) {
  if (!/[A-Za-z]/.test(text[i])) return null;
  BARE_WORD.lastIndex = i;
  const w = BARE_WORD.exec(text)[0];
  return { out: PYTHON[w] ?? w, end: i + w.length - 1 };
}

const READERS = [doubleQuoted, singleQuoted, lineComment, blockComment, bareKey, bareWord];

/**
 * Loose JSON to strict JSON, outside strings only: drops // and /* *\/ comments and trailing commas, turns
 * 'single-quoted' strings into "double-quoted" ones, quotes bare keys, and maps True/False/None.
 */
function normalizeLoose(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    let read = null;
    for (const reader of READERS) if ((read = reader(text, i, out))) break;
    if (read) { out += read.out; i = read.end; } else out += text[i];
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
