import { WorkshopChannel } from './channel.js';
import { keyToPath } from './paths.js';

/** Storage over the program's own folder. Per-key files; there is no directory listing from a screen. */
export class WorkshopStorage {
  constructor(channel) { this.channel = channel; }
  async get(key) {
    const body = await this.channel.readFile(keyToPath(key));
    return typeof body === 'string' && body !== '' ? body : (body && typeof body === 'object' ? JSON.stringify(body) : null);
  }
  async set(key, value) { await this.channel.writeFile(keyToPath(key), value); }
  async remove(key) { await this.channel.writeFile(keyToPath(key), ''); } // a screen cannot delete; empty = absent
  async keys() { return []; } // not needed: profiles come from the attached Kins
}

/**
 * Detects the Workshop: inside a frame, the page around it answers { kin: "kins" }.
 * Returns a host object, or null when running as a plain page (local mode).
 */
export async function detectWorkshopHost({ win = globalThis.window, timeouts } = {}) {
  if (!win || win.parent === win) return null;
  const channel = new WorkshopChannel({
    post: (m) => win.parent.postMessage(m, '*'),
    subscribe: (fn) => win.addEventListener('message', (e) => { if (e.source === win.parent) fn(e.data); }),
    timeouts,
  });
  let kins;
  try { kins = await channel.kins(); } catch { return null; }
  return {
    id: 'workshop',
    label: 'Kindroid Workshop',
    capabilities: { autoUpdate: false, kinReports: true, conversationIdentity: false, companionIdentity: true },
    storage: new WorkshopStorage(channel),
    channel,
    kins,
  };
}
