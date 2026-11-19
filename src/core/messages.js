import { cleanString } from './text.js';

const LABEL = /^\s*(\p{L}[\p{L}\p{N}'’._-]*(?: [\p{L}\p{N}'’._-]+){0,2})\s*:(?:\s+(.*))?$/u;

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Stable ids for messages that arrive without one: content hash + occurrence count. */
export function assignIds(messages) {
  const seen = new Map();
  return messages.map((m) => {
    if (m.id) return m;
    const base = hash(`${m.speaker}\n${m.text}`);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...m, id: `${base}.${n}` };
  });
}

/**
 * Parses a pasted conversation. "Name: text" starts a message; other lines
 * continue the previous one. Text without any label becomes one message from
 * an unidentified speaker, so the model leaves actor-dependent updates unresolved.
 * The pasted text itself is never altered.
 */
export function parseConversation(text) {
  const raw = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(LABEL);
    if (m) raw.push({ speaker: cleanString(m[1], 60), lines: [m[2] ?? ''] });
    else if (raw.length) raw[raw.length - 1].lines.push(line);
    else if (line.trim()) raw.push({ speaker: 'Unidentified speaker', lines: [line] });
  }
  return assignIds(
    raw.map((m) => ({ speaker: m.speaker, text: m.lines.join('\n').trim() })).filter((m) => m.text),
  );
}
