/**
 * Client for the screen <-> Workshop page protocol described in the Workshop guide:
 *   { kin: "files.read",  path }            -> { kin: "files.read", path, body }   (body null: no file yet)
 *   { kin: "files.write", path, body }      -> { kin: "files.write", path, ok }
 *   { kin: "action", name, input }          -> { kin: "action", name, ok, summary }
 *   { kin: "kins" }                         -> { kin: "kins", ok, kins: [{ id, name }] }  (also pushed on change)
 * Transport is injected so the same code runs in a browser frame and in tests.
 */
export class WorkshopChannel {
  constructor({ post, subscribe, timeouts = {} }) {
    this.post = post;
    this.timeouts = { kins: 1500, file: 10000, action: 150000, ...timeouts };
    this.waiting = new Map(); // "kind:id" -> [{ resolve, timer }]
    this.kinsListeners = new Set();
    this.actions = Promise.resolve(); // runs are posted one at a time (see runAction)
    subscribe((data) => this.#onMessage(data));
  }

  #onMessage(data) {
    if (!data || typeof data !== 'object' || typeof data.kin !== 'string') return;
    if (data.kin === 'kins') {
      for (const fn of this.kinsListeners) fn(data);
      return;
    }
    const id = data.kin === 'action' ? data.name : data.path;
    const queue = this.waiting.get(`${data.kin}:${id}`);
    const entry = queue?.shift();
    if (entry) { clearTimeout(entry.timer); entry.resolve(data); }
  }

  #request(kind, id, message, ms) {
    return new Promise((resolve, reject) => {
      const key = `${kind}:${id}`;
      const entry = { resolve };
      entry.timer = setTimeout(() => {
        const q = this.waiting.get(key) || [];
        this.waiting.set(key, q.filter((e) => e !== entry));
        reject(new Error(`The Kindroid Workshop did not answer (${kind}${id ? ` ${id}` : ''}).`));
      }, ms);
      this.waiting.set(key, [...(this.waiting.get(key) || []), entry]);
      this.post(message);
    });
  }

  /** The Kins attached to this app. Rejects when no Workshop page answers (not running in the Workshop). */
  kins() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.kinsListeners.delete(on); reject(new Error('No Workshop host answered.')); }, this.timeouts.kins);
      const on = (data) => { clearTimeout(timer); this.kinsListeners.delete(on); resolve(data.ok === false ? [] : (data.kins || [])); };
      this.kinsListeners.add(on);
      this.post({ kin: 'kins' });
    });
  }

  onKinsChange(fn) {
    const on = (data) => fn(data.ok === false ? [] : (data.kins || []));
    this.kinsListeners.add(on);
    return () => this.kinsListeners.delete(on);
  }

  async readFile(path) {
    const r = await this.#request('files.read', path, { kin: 'files.read', path }, this.timeouts.file);
    return r.body ?? null;
  }

  async writeFile(path, body) {
    const r = await this.#request('files.write', path, { kin: 'files.write', path, body }, this.timeouts.file);
    if (r.ok === false) throw new Error(`The Workshop refused to save ${path}.`);
    return true;
  }

  /**
   * Runs one of the program's actions. Resolves { ok, summary } (summary is the line the run ended with).
   * The reply names the action but not its input, so two runs in flight could get each other's answer
   * (a reading for one Kin shown on another). Runs are therefore posted one after the other.
   */
  runAction(name, input) {
    const run = this.actions.then(() => this.#request('action', name, { kin: 'action', name, input }, this.timeouts.action));
    this.actions = run.catch(() => {});
    return run.then((r) => ({ ok: r.ok !== false, summary: r.summary ?? '' }));
  }
}
