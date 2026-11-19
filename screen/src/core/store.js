/** Storage adapters share one async interface: get / set / remove. Only small settings are stored. */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async set(key, value) { this.map.set(key, value); }
  async remove(key) { this.map.delete(key); }
}

export class LocalStorageAdapter {
  constructor(ls = globalThis.localStorage) { this.ls = ls; }
  async get(key) { return this.ls.getItem(key); }
  async set(key, value) { this.ls.setItem(key, value); }
  async remove(key) { this.ls.removeItem(key); }
}

export const SETTINGS_KEY = 'clotheskin:v2:settings';
export const DEFAULT_SETTINGS = {
  theme: 'warm', // 'warm' (stock Kindroid) | 'sage' (green, sampled from a customised desktop window)
  selectedKinId: null,
  localName: 'Isa',
  // automatic updates (Workshop only): the screen writes these, the scheduled run reads them
  autoUpdate: false,
  autoIntervalMinutes: 15,
  autoKins: [], // [{ id, name }]
};

/** Preferences only (theme, which Kin is selected, the local-mode name, the automatic-update schedule). */
export class Settings {
  constructor(storage) { this.storage = storage; this.value = { ...DEFAULT_SETTINGS }; this.queue = Promise.resolve(); }

  /** Loads the saved preferences. Unreadable content gives the defaults; with `strict`, a storage failure is thrown. */
  async load({ strict = false } = {}) {
    let text;
    try { text = await this.storage.get(SETTINGS_KEY); } catch (e) { if (strict) throw e; return this.value; }
    try { this.value = { ...DEFAULT_SETTINGS, ...(JSON.parse(text) || {}) }; } catch { /* first run or corrupt: defaults */ }
    return this.value;
  }

  /**
   * Updates and saves; writes are serialised so two quick changes cannot overwrite each other.
   * Resolves true when the change was stored. If storing fails, the change is taken back and false is returned,
   * so the screen never claims a setting the scheduled run cannot see.
   */
  save(patch) {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, this.value[k]]));
    this.value = { ...this.value, ...patch };
    const snapshot = JSON.stringify(this.value);
    const done = this.queue
      .then(() => this.storage.set(SETTINGS_KEY, snapshot))
      .then(() => true, () => { this.value = { ...this.value, ...before }; return false; });
    this.queue = done;
    return done;
  }
}
