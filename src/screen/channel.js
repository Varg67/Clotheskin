// The screen's side of the page around it (Kindroid guide, "A screen"): a locked frame that talks to its parent with
// postMessage. The guide's messages:
//   { kin: "kins" }                       -> { kin: "kins", ok, kins: [{ id, name }] }   (also pushed on change)
//   { kin: "files.read", path }           -> { kin: "files.read", path, body }           (body null: no file yet)
//   { kin: "files.write", path, body }    -> { kin: "files.write", path, ok }
//   { kin: "action", name, input }        -> { kin: "action", name, ok, summary }        (a few seconds later)
// What published programs taught (Aurora Alert): the page around the frame may not be listening yet when the frame
// starts, so the handshake and file reads are sent again until they are answered. A reply names only the path or
// the action, so: one read per path at a time (repeats share it), and one action run at a time.
// Plain classes, no private fields: the screen also runs on older Safari.

export class Channel {
  constructor({ post, subscribe, timeouts = {} }) {
    this.post = post;
    this.t = { connect: 4000, resend: 500, read: 12000, readResend: 1500, write: 10000, action: 150000 };
    Object.assign(this.t, timeouts);
    this.waiting = {}; // "kind:key" -> [{ resolve, reject, timer }]
    this.reads = {}; // path -> the read in progress
    this.writes = {}; // path -> the last write (writes of one path go in order)
    this.actions = Promise.resolve();
    this.kinsListeners = [];
    this.heard = false; // anything at all came from the page around the frame
    subscribe((data) => this.onMessage(data));
  }

  onMessage(data) {
    if (!data || typeof data !== 'object' || typeof data.kin !== 'string') return;
    this.heard = true;
    if (data.kin === 'kins') {
      const kins = data.ok === false || !Array.isArray(data.kins) ? [] : data.kins.filter((k) => k && typeof k.id === 'string').map((k) => ({ id: k.id, name: typeof k.name === 'string' && k.name.trim() ? k.name.trim() : k.id }));
      this.kinsListeners.slice().forEach((fn) => fn(kins));
      return;
    }
    const key = `${data.kin}:${data.kin === 'action' ? data.name : data.path}`;
    const queue = this.waiting[key];
    const entry = queue && queue.shift();
    if (entry) { clearTimeout(entry.timer); clearInterval(entry.resend); entry.resolve(data); }
  }

  /**
   * Posts `message` and waits for the reply with this key; `resend` (ms, optional) posts it again until answered.
   * @param {string} key
   * @param {{ timeout: number, resend?: number, message: object }} options
   */
  wait(key, { timeout, resend = 0, message }) {
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      const queue = this.waiting[key] || (this.waiting[key] = []);
      queue.push(entry);
      entry.timer = setTimeout(() => {
        clearInterval(entry.resend);
        const i = queue.indexOf(entry);
        if (i >= 0) queue.splice(i, 1);
        reject(new Error('Kindroid did not answer.'));
      }, timeout);
      this.post(message);
      if (resend) entry.resend = setInterval(() => this.post(message), resend);
    });
  }

  /** The Kins attached to the program; asked again every half second until the page answers (or `connect` ms). */
  kins(timeout = this.t.connect) {
    return new Promise((resolve, reject) => {
      const off = this.onKins((kins) => { cleanup(); resolve(kins); });
      const resend = setInterval(() => this.post({ kin: 'kins' }), this.t.resend);
      const timer = setTimeout(() => { cleanup(); reject(new Error('Kindroid did not answer.')); }, timeout);
      function cleanup() { off(); clearInterval(resend); clearTimeout(timer); }
      this.post({ kin: 'kins' });
    });
  }

  /** Calls fn(kins) whenever the page sends the list (the person attached or detached a Kin). Returns an unsubscribe. */
  onKins(fn) {
    this.kinsListeners.push(fn);
    return () => { this.kinsListeners = this.kinsListeners.filter((f) => f !== fn); };
  }

  /** A file of the program's folder as text, or null when it does not exist yet. */
  read(path) {
    if (!this.reads[path]) {
      this.reads[path] = this.wait(`files.read:${path}`, { timeout: this.t.read, resend: this.t.readResend, message: { kin: 'files.read', path } })
        .then((r) => (typeof r.body === 'string' ? r.body : r.body == null ? null : JSON.stringify(r.body)))
        .finally(() => { delete this.reads[path]; });
    }
    return this.reads[path];
  }

  /** Saves a text file. Writes of one path are sent one after the other, so the last one written is the last one sent. */
  write(path, body) {
    const prev = this.writes[path] || Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.wait(`files.write:${path}`, { timeout: this.t.write, message: { kin: 'files.write', path, body } }))
      // `=== false`, not `!r.ok`: in the page's replies a missing ok means it worked.
      .then((r) => { if (r.ok === false) throw new Error(`Kindroid did not save ${path}.`); return true; });
    this.writes[path] = next;
    return next;
  }

  /** Runs the program's action; resolves { ok, summary }. One at a time: a reply names only the action. */
  action(name, input) {
    const run = this.actions.catch(() => {}).then(() => this.wait(`action:${name}`, { timeout: this.t.action, message: { kin: 'action', name, input } }));
    this.actions = run;
    return run.then((r) => ({ ok: r.ok !== false, summary: typeof r.summary === 'string' ? r.summary : '' }));
  }
}

/** The channel of a screen inside a frame (null when the screen is opened as a plain page). */
export function frameChannel(win = window) {
  if (!win.parent || win.parent === win) return null;
  return new Channel({
    post: (m) => win.parent.postMessage(m, '*'),
    subscribe: (fn) => win.addEventListener('message', (e) => { if (e.source === win.parent) fn(e.data); }),
  });
}
