/** Maps storage keys to file paths in the app's own folder. Shared by the screen and the run. */
export const DATA_DIR = 'cs';

export function keyToPath(key) {
  const safe = String(key).replace(/[^A-Za-z0-9._-]/g, (c) => `~${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `${DATA_DIR}/${safe}.json`;
}
