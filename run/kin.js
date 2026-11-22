// The `kin` command inside a run (Kindroid guide: "Inside a run the kin command is already there"). This is the only
// file that knows how it is called; run/program.js gets these functions and never spawns anything itself, so the
// same program logic also runs in the dev harness with a fake Kin.
//
// Lessons from the guide and from published programs (Aurora Alert, Bunny & Fox BBS):
//  - output is read as UTF-8 text in one piece (execFile with encoding), so a character is never split between chunks;
//  - stdin is closed at once, so a subcommand never waits for input; `files put` gets the body there (Kin Bank, Planner);
//  - a missing file is "kin: 404 ..." on stderr (Kin Bank and Planner check /^kin: 404\b/);
//  - a failure says which subcommand failed and the last line kin printed, not the whole command line;
//  - `kin files get` of a missing file is "not found" (null), any other failure is an error: the caller must then
//    not write over the file it could not read.
import { execFile } from 'node:child_process';
import { oneLine } from '../src/core/text.js';

// kin end takes up to 4,000 characters, shown in the chat and given back to the Kin when an action started the run.
// Clotheskin's line is a status, so it is kept short on purpose.
const END_LIMIT = 500;

class KinError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string|number|null, stderr?: string, timedOut?: boolean }} [details] code: kin's exit code (a number:
   *   it ran) or Node's error code ('ENOENT': it did not)
   */
  constructor(message, { code = null, stderr = '', timedOut = false } = {}) {
    super(message);
    this.code = code;
    this.stderr = stderr;
    this.timedOut = timedOut;
  }
}

// Only kin's own "404" means "no such file" (as Bunny & Fox BBS checks): "storage node not found" is a failure,
// and reading it as "empty" would write over the real file.
const NOT_FOUND = /\b404\b/;

/**
 * The kin command as functions. `bin` is `kin` inside a run; KIN_BIN=/path/kin.mjs runs the downloadable kin.mjs
 * with node (with KIN_MOCK set, as the guide describes, every call is recorded and answered without touching anything).
 */
export function createKin({ bin = process.env.KIN_BIN || 'kin', defaultTimeoutMs = 30000 } = {}) {
  const viaNode = bin.endsWith('.mjs') || bin.endsWith('.js');

  /**
   * @param {string[]} args
   * @param {{ timeoutMs?: number, input?: string|null }} [options] input: what kin reads on stdin (`files put` takes the body there)
   * @returns {Promise<string>}
   */
  function call(args, { timeoutMs = defaultTimeoutMs, input = null } = {}) {
    const cmd = viaNode ? process.execPath : bin;
    const argv = viaNode ? [bin, ...args] : args;
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, argv, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (!err) { resolve(stdout); return; }
        const last = String(stderr || '').trim().split('\n').pop() || (err.code === 'ENOENT' ? `the kin command was not found (${bin})` : `exit ${err.code ?? err.signal}`);
        const what = args[0] === 'files' ? `files ${args[1]} ${args[2] ?? ''}`.trim() : args[0];
        const timedOut = Boolean(err.killed && err.signal);
        reject(new KinError(timedOut ? `kin ${what} timed out after ${Math.round(timeoutMs / 1000)} s` : `kin ${what} failed: ${last}`, { code: err.code, stderr: String(stderr || ''), timedOut }));
      });
      child.stdin?.on('error', () => {}); // kin may exit before reading stdin
      child.stdin?.end(input == null ? undefined : input); // `kin files put <path>` reads the body here
    });
  }

  return {
    /**
     * Asks the Kin (grant kin:read; with chat:read:<days> it sees its recent chat). Returns the answer text.
     * @param {string} prompt
     * @param {{ kin?: string, timeoutMs?: number }} [options]
     */
    ask(prompt, { kin, timeoutMs = 90000 } = {}) {
      return call(['ask', ...(kin ? ['--kin', kin] : []), prompt], { timeoutMs });
    },
    /**
     * Tells the Kin a plain fact (rarely). `ttl` in hours; `reachOut` lets the Kin bring it up by itself.
     * @param {string} fact
     * @param {{ kin?: string, key?: string, ttl?: number, reachOut?: boolean, timeoutMs?: number }} [options]
     */
    async tell(fact, { kin, key, ttl, reachOut = false, timeoutMs } = {}) {
      const args = ['tell', ...(kin ? ['--kin', kin] : []), ...(key ? ['--key', key] : []), ...(ttl ? ['--ttl', String(ttl)] : []), ...(reachOut ? ['--reach-out', 'soon'] : []), fact];
      await call(args, timeoutMs ? { timeoutMs } : {});
    },
    /** A file of the program's folder as text, or null when it does not exist yet. Any other failure throws. */
    async get(path) {
      try {
        const body = await call(['files', 'get', path]);
        return body === '' ? null : body;
      } catch (e) {
        if (e instanceof KinError && typeof e.code === 'number' && NOT_FOUND.test(e.stderr)) return null; // kin ran and said 404
        throw e;
      }
    },
    /** Saves text as a file of the program's folder: `kin files put <path>` with the body on stdin (as Kin Bank and Planner do). */
    async put(path, text) {
      await call(['files', 'put', path], { input: String(text) });
    },
    /** The Kins attached to the program: [{ id, name }] (kin kins prints one per line: id, a tab, the name). */
    async kins() {
      const out = await call(['kins']);
      return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [id, ...name] = l.split(/\t|\s+/);
        return { id, name: name.join(' ').trim() || id };
      });
    },
    /** Ends the run: the one line the screen (or a Kin that used an action) gets back. */
    async end(message, { failed = false } = {}) {
      let line = oneLine(message, END_LIMIT);
      if (line.startsWith('-')) line = oneLine(`Clotheskin: ${line}`, END_LIMIT); // never read as an option
      await call(['end', ...(failed ? ['--failed'] : []), line], { timeoutMs: 15000 });
    },
  };
}
