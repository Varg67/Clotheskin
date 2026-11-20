/** Storage adapters share one async interface: get / set. Only small settings are stored. */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async set(key, value) { this.map.set(key, value); }
}

export class LocalStorageAdapter {
  constructor(ls = globalThis.localStorage) { this.ls = ls; }
  async get(key) { return this.ls.getItem(key); }
  async set(key, value) { this.ls.setItem(key, value); }
}

export const SETTINGS_KEY = 'clotheskin:v2:settings';
export const DEFAULT_SETTINGS = {
  theme: 'warm', // 'warm' (stock Kindroid) | 'sage' (green, sampled from a customised desktop window)
  selectedKinId: null,
  localName: 'Isa',
  autoIntervalS: 600, // automatic readings in the Workshop, in seconds; shown as minutes and hours on the ruler
  autoState: 'stopped', // 'running' | 'paused' | 'stopped' (Start, Pause, Stop)
  sleep: {}, // kin id -> { wakeAt, until, sleptOn }: the hibernation of a sleeping Kin (times only, nothing about the scene)
};

/** Preferences only (theme, selected Kin, local-mode name, automatic interval, wake-up times). No outfit, no place and no chat is ever stored. */
export class Settings {
  constructor(storage) { this.storage = storage; this.value = { ...DEFAULT_SETTINGS }; this.queue = Promise.resolve(); }
  async load() {
    try { this.value = { ...DEFAULT_SETTINGS, ...(JSON.parse(await this.storage.get(SETTINGS_KEY)) || {}) }; } catch { /* first run or unreadable: defaults */ }
    return this.value;
  }
  /** Updates and saves; writes are serialised so two quick changes cannot overwrite each other. */
  save(patch) {
    this.value = { ...this.value, ...patch };
    const snapshot = JSON.stringify(this.value);
    this.queue = this.queue.then(() => this.storage.set(SETTINGS_KEY, snapshot)).catch(() => {});
    return this.queue;
  }
}
