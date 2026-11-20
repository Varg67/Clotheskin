/**
 * Extracts a JSON object from plain JSON, a fenced block, or text containing one object.
 * Only when strict parsing fails, two common slips are repaired: trailing commas and curly double quotes.
 */
export function parseJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'The answer is empty.' };
  const candidates = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const c of candidates) {
    try { return { ok: true, value: JSON.parse(c) }; } catch { /* try the next candidate */ }
  }
  for (const c of candidates) {
    const noTrailing = c.replace(/,(\s*[}\]])/g, '$1');
    for (const attempt of [noTrailing, noTrailing.replace(/[“”]/g, '"')]) {
      try { return { ok: true, value: JSON.parse(attempt), repaired: true }; } catch { /* try the next repair */ }
    }
  }
  // Not the parser's message: it quotes the answer, and the answer is the scene (it would reach logs and status.json).
  return { ok: false, error: 'The answer is not valid JSON.' };
}
