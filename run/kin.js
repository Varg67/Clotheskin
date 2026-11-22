// The `kin` command inside a run (Kindroid guide: "Inside a run the kin command is already there"). This is the only
// file that knows how it is called; run/program.js gets these functions and never spawns anything itself, so the
// same program logic also runs in the dev harness with a fake Kin.
//
// Lessons from the guide and from published programs (Aurora Alert, Bunny & Fox BBS):
//  - output is read as UTF-8 text in one piece (execFile with encoding), so a character is never split between chunks;
//  - stdin is closed at once, so a subcommand never waits for input;
//  - a failure says which subcommand failed and the last line kin printed, not the whole command line;
//  - `kin files get` of a missing file is "not found" (null), any other failure is an error: the caller must then
//    not write over the file it could not read.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oneLine } from '../src/core/text.js';

export const END_LIMIT = 500; // kin end keeps at most 500 characters

export class KinError extends Error {
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

  function call(args, { timeoutMs = defaultTimeoutMs } = {}) {
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
      child.stdin?.end();
    });
  }

  return {
    /** Asks the Kin (grant kin:read; with chat:read:<days> it sees its recent chat). Returns the answer text. */
    ask(prompt, { kin, timeoutMs = 90000 } = {}) {
      return call(['ask', ...(kin ? ['--kin', kin] : []), prompt], { timeoutMs });
    },
    /** Tells the Kin a plain fact (rarely). `ttl` in hours; `reachOut` lets the Kin bring it up by itself. */
    async tell(fact, { kin, key, ttl, reachOut = false } = {}) {
      await call(['tell', ...(kin ? ['--kin', kin] : []), ...(key ? ['--key', key] : []), ...(ttl ? ['--ttl', String(ttl)] : []), ...(reachOut ? ['--reach-out', 'soon'] : []), fact]);
    },
    /** A file of the program's folder as text, or null when it does not exist yet. Any other failure throws. */
    async get(path) {
      try {
        const body = await call(['files', 'get', path]);
        return body === '' ? null : body;
      } catch (e) {
        if (typeof e.code === 'number' && NOT_FOUND.test(e.stderr)) return null; // kin ran and said 404
        throw e;
      }
    },
    /** Saves text as a file of the program's folder (through /tmp: a shared program's folder is read-only). */
    async put(path, text) {
      const dir = await mkdtemp(join(tmpdir(), 'clotheskin-'));
      try {
        const file = join(dir, 'body');
        await writeFile(file, text);
        await call(['files', 'put', path, file]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
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
