// The only thing kept about a Kin: its latest reading (three short sentences and when). It exists so an automatic
// reading made while nobody is looking can be shown later. No chat text, no history, no wardrobe.
export const readingKey = (kinId) => `clotheskin:v2:reading:${kinId}`;
const S = (v) => (typeof v === 'string' ? v.slice(0, 600) : null);

export class ReadingStore {
  constructor(storage) { this.storage = storage; }

  /**
   * The stored reading, or null if there is none or it is corrupt. A corrupt file never throws. A storage FAILURE
   * (the file may well exist but could not be read) is swallowed unless `strict`: the scheduled run uses strict, so it
   * never mistakes "could not read" for "never asked" and overwrites good sentences.
   */
  async get(kinId, { strict = false } = {}) {
    let text;
    try { text = await this.storage.get(readingKey(kinId)); } catch (e) { if (strict) throw e; return null; }
    let raw;
    try { raw = JSON.parse(text); } catch { return null; }
    if (!raw || typeof raw !== 'object') return null;
    return {
      at: S(raw.at), attemptedAt: S(raw.attemptedAt), source: raw.source === 'auto' ? 'auto' : 'manual',
      location: S(raw.location), doing: S(raw.doing), outfit: S(raw.outfit), error: S(raw.error),
      failures: Number.isInteger(raw.failures) && raw.failures > 0 ? Math.min(raw.failures, 99) : 0,
      errorKind: typeof raw.errorKind === 'string' ? raw.errorKind.slice(0, 30) : null,
    };
  }

  async put(kinId, reading) {
    await this.storage.set(readingKey(kinId), JSON.stringify(reading));
  }
}

/** The next stored value after an attempt. A failure keeps the last good sentences and only records the attempt. */
export function afterAttempt(prev, { now, source, sentences, error, kind = null, claim = false }) {
  const stamp = now.toISOString();
  if (sentences) return { at: stamp, attemptedAt: stamp, source, location: sentences.location, doing: sentences.doing, outfit: sentences.outfit, error: null, failures: 0, errorKind: null };
  // A claim only marks the attempt; it keeps whatever error was there. A real failure records its message.
  return { at: prev?.at ?? null, attemptedAt: stamp, source: prev?.source ?? source, location: prev?.location ?? null, doing: prev?.doing ?? null, outfit: prev?.outfit ?? null, error: claim ? (error ?? null) : String(error || 'The reading failed.').slice(0, 300),
    // consecutive failures drive the retry backoff; a claim (an attempt marker) changes neither the count nor the kind
    failures: claim ? (prev?.failures ?? 0) : (prev?.failures ?? 0) + 1, errorKind: claim ? (prev?.errorKind ?? null) : kind };
}
