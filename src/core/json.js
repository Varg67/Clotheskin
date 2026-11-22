/** The longest answer that is searched and repaired; a longer one is read only if it is strict JSON. */
export const MAX_ANSWER_CHARS = 20000;

/**
 * Extracts a JSON object from what a Kin answered. A roleplay model often wraps it: narration before or after, a code
 * fence, a remark with braces after it ("Hope that helps {wink}"), the format example echoed before the real answer.
 * Strict JSON is tried first; only then are the usual slips repaired (trailing commas, curly quotes, comments,
 * 'single quotes', bare keys, Python's True/False/None, an object sent as a JSON string). A cut-off answer is an
 * error, never completed by guessing.
 */
export function parseJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'The answer is empty.' };
  // The questions ask for one line of JSON (a few hundred characters). A longer answer is still read if it is strict
  // JSON (one linear parse), but it is not searched and repaired: every {...} in it would be one more parse. It is
  // refused without quoting it.
  if (raw.length > MAX_ANSWER_CHARS) {
    try { return unwrap(JSON.parse(raw), false); } catch { return { ok: false, error: `The answer is too long to be read (${raw.length} characters).` }; }
  }
  const candidates = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  // Every balanced {...} in the text, the last first: when the example is echoed, the real answer comes after it.
  candidates.push(...balancedObjects(raw).reverse());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const c of candidates) {
    try { return unwrap(JSON.parse(c), false); } catch { /* try the next candidate */ }
  }
  for (const c of candidates) {
    const loose = normalizeLoose(c);
    for (const attempt of [loose, loose.replace(/[“”]/g, '"')]) {
      try { return unwrap(JSON.parse(attempt), true); } catch { /* try the next repair */ }
    }
  }
  if (first !== -1 && !balancedObjects(raw.slice(first)).length) return { ok: false, error: 'The answer was cut off before the end, so it is not valid JSON.' };
  // Not the parser's message: it quotes the answer, and the answer is the scene (it would reach logs and status.json).
  return { ok: false, error: 'The answer is not valid JSON.' };
}

/** An object sent as a JSON string ("{\"location\":…}") is read as the object. */
function unwrap(value, repaired) {
  if (typeof value === 'string' && /^\s*\{/.test(value)) {
    try { return { ok: true, value: JSON.parse(value), repaired: true }; } catch { /* keep the string */ }
  }
  return repaired ? { ok: true, value, repaired: true } : { ok: true, value };
}

/** The top-level {...} spans of a text, aware of quoted strings (both quote styles). */
export function balancedObjects(text) {
  const out = [];
  let depth = 0; let start = -1; let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    // An apostrophe inside narration ("it's") is not a quote: only count quotes once inside an object.
    if ((c === '"' || (c === "'" && depth > 0 && /[\s{[,:]/.test(text[i - 1] || ' '))) && depth > 0) { quote = c; continue; }
    if (c === '{') { if (depth === 0) start = i; depth += 1; }
    else if (c === '}' && depth > 0) { depth -= 1; if (depth === 0) out.push(text.slice(start, i + 1)); }
  }
  return out;
}

/**
 * Loose JSON to strict JSON, outside strings only: drops // and /* *\/ comments and trailing commas, turns
 * 'single-quoted' strings into "double-quoted" ones, quotes bare keys, and maps True/False/None.
 */
export function normalizeLoose(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === '“' || c === '”') { // copy a double-quoted string as it is
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '”' && text[j] !== '“') j += text[j] === '\\' ? 2 : 1;
      out += `"${text.slice(i + 1, j)}"`;
      i = j;
    } else if (c === "'") { // 'single' -> "double"
      let j = i + 1; let s = '';
      while (j < text.length && text[j] !== "'") {
        if (text[j] === '\\' && text[j + 1] === "'") { s += "'"; j += 2; continue; }
        if (text[j] === '"') s += '\\"'; else s += text[j];
        j += 1;
      }
      out += `"${s}"`;
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (/[A-Za-z_\u00C0-\u024F]/.test(c) && /[{,]$/.test(out.trimEnd())) {
      // a bare key: letters up to a colon
      const m = text.slice(i).match(/^([A-Za-z_\u00C0-\u024F][\wÀ-ɏ -]*?)\s*:/);
      if (m) { out += `"${m[1]}":`; i += m[0].length - 1; } else out += c;
    } else if (/[A-Za-z]/.test(c)) { // a bare word in value position
      const w = text.slice(i).match(/^[A-Za-z]+/)[0];
      out += { True: 'true', False: 'false', None: 'null' }[w] ?? w;
      i += w.length - 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
