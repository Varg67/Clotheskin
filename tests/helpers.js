import { MemoryStorage, Repository } from '../src/core/store.js';
import { createRecord } from '../src/core/model.js';
import { applyDocument } from '../src/core/apply.js';
import { validateDocument } from '../src/core/validate.js';

export const NOW = '2026-11-19T12:00:00.000Z';

export function repo() { return new Repository(new MemoryStorage()); }

export function profile(id, name, extra = {}) {
  return { id, name, createdAt: NOW, places: [], ...extra };
}

/** Validates then applies a raw document. */
export function run(record, raw, opts = {}) {
  const v = validateDocument(raw);
  if (!v.ok) throw new Error(`invalid test doc: ${v.errors.join('; ')}`);
  return applyDocument(record, v.doc, { baseRev: record.rev, now: NOW, ...opts });
}

export function fresh(id = 'p1') { return createRecord(id, null); }

export const names = (record, slot) =>
  (slot === 'bags' ? record.bags : record.clothing[slot] ?? record.accessories[slot])?.map((i) => record.items[i].name);

export const byName = (record, name) => Object.values(record.items).find((i) => i.name === name);
