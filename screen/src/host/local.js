/**
 * Host adapter contract (everything the app needs from its environment):
 *   id, label
 *   capabilities: { autoUpdate, conversationIdentity, companionIdentity, structuredResponse }
 *   storage: async get/set/remove/keys
 *
 * Only the local adapter exists. No Kindroid Workshop mechanism has been
 * verified yet (see README, "Pending verification"), so none is guessed here.
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
  return {
    id: 'local',
    label: 'local',
    capabilities: { autoUpdate: false, conversationIdentity: false, companionIdentity: false, structuredResponse: false },
    storage,
  };
}
