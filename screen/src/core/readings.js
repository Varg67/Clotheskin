import { normalizeText } from './text.js';

// What is kept about a Kin, in two files:
//   reading  — the latest reading (five short sentences and when). Small, polled by the screen every 20 s, so a
//              reading made while nobody is looking can be shown later.
//   journal  — the last readings (history) and a technical log of the last attempts (diagnostics). Read only when
//              the person opens History or Diagnostics. No chat text is ever stored, and no answer of the Kin.
export const readingKey = (kinId) => `clotheskin:v2:reading:${kinId}`;
export const journalKey = (kinId) => `clotheskin:v2:journal:${kinId}`;
export const HISTORY_MAX = 20;
export const LOG_MAX = 15;
export const SENTENCE_KEYS = ['location', 'doing', 'outfit', 'hair', 'makeup'];
const S = (v, n = 600) => (typeof v === 'string' ? v.slice(0, n) : null);
const count = (v, max = 99) => (Number.isInteger(v) && v > 0 ? Math.min(v, max) : 0);

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
      location: S(raw.location), doing: S(raw.doing), outfit: S(raw.outfit), hair: S(raw.hair), makeup: S(raw.makeup), error: S(raw.error),
      failures: count(raw.failures),
      errorKind: typeof raw.errorKind === 'string' ? raw.errorKind.slice(0, 30) : null,
      stableCount: count(raw.stableCount),
    };
  }

  async put(kinId, reading) {
    await this.storage.set(readingKey(kinId), JSON.stringify(reading));
  }
}

/**
 * Did anything change? Compared after normalising (case, punctuation, accents), so "In the kitchen." and
 * "in the kitchen" are the same. Different wording counts as a change: when unsure, the app asks sooner, not later.
 */
export function sameSentences(a, b) {
  if (!a || !b || !a.location) return false;
  return SENTENCE_KEYS.every((k) => normalizeText(a[k] ?? '') === normalizeText(b[k] ?? ''));
}

/**
 * The next stored value after an attempt. A failure keeps the last good sentences and only records the attempt.
 * `stableCount` is how many automatic checks in a row found nothing new; it lets the schedule wait longer. A manual
 * reading starts it over.
 */
export function afterAttempt(prev, { now, source, sentences, error, kind = null, claim = false }) {
  const stamp = now.toISOString();
  if (sentences) {
    const stableCount = source === 'auto' && sameSentences(prev, sentences) ? Math.min((prev?.stableCount ?? 0) + 1, 99) : 0;
    return { at: stamp, attemptedAt: stamp, source, location: sentences.location, doing: sentences.doing, outfit: sentences.outfit, hair: sentences.hair ?? null, makeup: sentences.makeup ?? null, error: null, failures: 0, errorKind: null, stableCount };
  }
  // A claim only marks the attempt; it keeps whatever error was there. A real failure records its message.
  return { at: prev?.at ?? null, attemptedAt: stamp, source: prev?.source ?? source, location: prev?.location ?? null, doing: prev?.doing ?? null, outfit: prev?.outfit ?? null, hair: prev?.hair ?? null, makeup: prev?.makeup ?? null, error: claim ? (error ?? null) : String(error || 'The reading failed.').slice(0, 300),
    // consecutive failures drive the retry backoff; a claim (an attempt marker) changes neither the count nor the kind
    failures: claim ? (prev?.failures ?? 0) : (prev?.failures ?? 0) + 1, errorKind: claim ? (prev?.errorKind ?? null) : kind,
    stableCount: prev?.stableCount ?? 0 };
}

// ---------------------------------------------------------------- journal: history and diagnostics
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null);

function cleanHistoryEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.at !== 'string' || typeof e.location !== 'string') return null;
  const out = { at: S(e.at, 40), source: e.source === 'auto' ? 'auto' : 'manual' };
  for (const k of SENTENCE_KEYS) out[k] = S(e[k]);
  return out;
}

function cleanLogEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.at !== 'string') return null;
  return {
    at: S(e.at, 40), source: e.source === 'auto' ? 'auto' : 'manual', ok: e.ok === true,
    kind: typeof e.kind === 'string' ? e.kind.slice(0, 30) : null,
    ms: num(e.ms, 3_600_000), tries: num(e.tries, 9), chars: num(e.chars, 1_000_000),
    cut: e.cut === true, unchanged: e.unchanged === true, error: S(e.error, 200),
  };
}

export const emptyJournal = () => ({ history: [], log: [] });

/** Newest first, at most HISTORY_MAX. */
export function withHistory(journal, entry) {
  const e = cleanHistoryEntry(entry);
  return e ? { ...journal, history: [e, ...journal.history].slice(0, HISTORY_MAX) } : journal;
}

/** Newest first, at most LOG_MAX. */
export function withLog(journal, entry) {
  const e = cleanLogEntry(entry);
  return e ? { ...journal, log: [e, ...journal.log].slice(0, LOG_MAX) } : journal;
}

export class JournalStore {
  constructor(storage) { this.storage = storage; }

  /** The journal. Missing or corrupt gives an empty one; a storage failure throws only with `strict`. */
  async get(kinId, { strict = false } = {}) {
    let text;
    try { text = await this.storage.get(journalKey(kinId)); } catch (e) { if (strict) throw e; return emptyJournal(); }
    let raw;
    try { raw = JSON.parse(text); } catch { return emptyJournal(); }
    if (!raw || typeof raw !== 'object') return emptyJournal();
    const list = (v, clean, max) => (Array.isArray(v) ? v.map(clean).filter(Boolean).slice(0, max) : []);
    return { history: list(raw.history, cleanHistoryEntry, HISTORY_MAX), log: list(raw.log, cleanLogEntry, LOG_MAX) };
  }

  async put(kinId, journal) {
    await this.storage.set(journalKey(kinId), JSON.stringify(journal));
  }

  /**
   * Adds a log entry and, for a success, a history entry. Read first (strictly): if the journal cannot be read, nothing
   * is written, so a passing storage problem never wipes the history. Never throws: the journal is a convenience.
   */
  async record(kinId, { log, reading = null }) {
    try {
      let j = await this.get(kinId, { strict: true });
      if (reading) j = withHistory(j, reading);
      j = withLog(j, log);
      await this.put(kinId, j);
      return true;
    } catch { return false; }
  }
}
