import { createRecord, scopeKey, SCHEMA_VERSION } from './model.js';
import { canonicalName } from './text.js';

const NS = 'clotheskin:v1';

/** Storage adapters share one async interface: get / set / remove / keys. */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async set(key, value) { this.map.set(key, value); }
  async remove(key) { this.map.delete(key); }
  async keys(prefix) { return [...this.map.keys()].filter((k) => k.startsWith(prefix)); }
}

export class LocalStorageAdapter {
  constructor(ls = globalThis.localStorage) { this.ls = ls; }
  async get(key) { return this.ls.getItem(key); }
  async set(key, value) { this.ls.setItem(key, value); }
  async remove(key) { this.ls.removeItem(key); }
  async keys(prefix) {
    const out = [];
    for (let i = 0; i < this.ls.length; i++) { const k = this.ls.key(i); if (k.startsWith(prefix)) out.push(k); }
    return out;
  }
}

export const DEFAULT_SETTINGS = {
  selectedProfileId: null,
  autoUpdate: false,
  promptOverride: null,
  conversationId: '',
  drafts: {},
  expanded: true,
};

export class Repository {
  constructor(storage) {
    this.storage = storage;
    this.locks = new Map();
  }

  async #read(key) {
    const raw = await this.storage.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async #write(key, value) { await this.storage.set(key, JSON.stringify(value)); }

  /** Serialises read-modify-write cycles per key. */
  async #locked(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(key, run.catch(() => {}));
    return run;
  }

  // ---- profiles
  async listProfiles() {
    const keys = await this.storage.keys(`${NS}:profile:`);
    const out = [];
    for (const k of keys) { const p = await this.#read(k); if (p) out.push(p); }
    return out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.name.localeCompare(b.name));
  }

  getProfile(id) { return this.#read(`${NS}:profile:${id}`); }

  async saveProfile(profile) {
    return this.#locked(`${NS}:profile:${profile.id}`, () => this.#write(`${NS}:profile:${profile.id}`, profile));
  }

  async updateProfile(id, fn) {
    return this.#locked(`${NS}:profile:${id}`, async () => {
      const cur = await this.getProfile(id);
      if (!cur) return null;
      const next = fn(structuredClone(cur));
      await this.#write(`${NS}:profile:${id}`, next);
      return next;
    });
  }

  async deleteProfile(id) {
    await this.storage.remove(`${NS}:profile:${id}`);
    for (const k of await this.storage.keys(`${NS}:record:${id}::`)) await this.storage.remove(k);
  }

  /** Registers a place for a profile when its name is new. Images are never generated. */
  async ensurePlace(profileId, name) {
    if (!name) return;
    await this.updateProfile(profileId, (p) => {
      p.places = p.places || [];
      const key = canonicalName(name);
      if (!p.places.some((pl) => canonicalName(pl.name) === key)) {
        p.places.push({ id: `place-${p.places.length + 1}-${Math.random().toString(36).slice(2, 6)}`, name, imageUrl: null });
      }
      return p;
    });
  }

  // ---- records
  recordKey(profileId, conversationId) { return `${NS}:record:${scopeKey(profileId, conversationId)}`; }

  async getRecord(profileId, conversationId = null) {
    const rec = await this.#read(this.recordKey(profileId, conversationId));
    if (rec && rec.schema === SCHEMA_VERSION) return rec;
    return createRecord(profileId, conversationId);
  }

  /** Atomically loads, transforms and saves a record. `fn` may return the same record to skip saving. */
  async updateRecord(profileId, conversationId, fn) {
    const key = this.recordKey(profileId, conversationId);
    return this.#locked(key, async () => {
      const cur = await this.getRecord(profileId, conversationId);
      const result = await fn(cur);
      if (result?.record && result.record !== cur) await this.#write(key, result.record);
      return result;
    });
  }

  async putRecord(record) {
    await this.#write(this.recordKey(record.profileId, record.conversationId), record);
  }

  // ---- settings
  async getSettings() {
    return { ...DEFAULT_SETTINGS, ...(await this.#read(`${NS}:settings`) || {}) };
  }

  async saveSettings(patch) {
    return this.#locked(`${NS}:settings`, async () => {
      const next = { ...(await this.getSettings()), ...patch };
      await this.#write(`${NS}:settings`, next);
      return next;
    });
  }
}
