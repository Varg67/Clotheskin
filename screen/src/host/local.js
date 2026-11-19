/**
 * Host adapter contract (everything the app needs from its environment):
 *   id, label, storage (async get/set), and in the Workshop also channel and kins (see workshop.js).
 * Local mode is a plain page: preferences go to localStorage, or to memory when storage is blocked.
 */
import { LocalStorageAdapter, MemoryStorage } from '../core/store.js';

export function createLocalHost() {
  let storage;
  try {
    storage = new LocalStorageAdapter();
    storage.ls.getItem('clotheskin:probe');
  } catch {
    storage = new MemoryStorage(); // storage blocked: still usable for the session
  }
  return { id: 'local', label: 'local', storage };
}
