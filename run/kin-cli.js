// Adapter over the `kin` command available inside a run. Everything that depends on the exact behaviour of
// that CLI is in this file, so a correction is local. See README "Pending verification".
import { spawn } from 'node:child_process';
import { keyToPath } from '../screen/src/host/paths.js';
import { classifyFailure, KinFailure } from '../screen/src/core/errors.js';

/**
 * Runs the kin command. A command that does not finish in `timeoutMs` is stopped (SIGTERM, then SIGKILL two seconds
 * later if it ignores it) and the promise rejects with `timedOut: true`. A command that cannot be started rejects with
 * `spawnFailed: true`. Neither ever leaves a process running or a promise pending.
 */
export function runKin(args, { input, bin = process.env.KIN_BIN || 'kin', timeoutMs = 70000, killAfterMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const cmd = bin.endsWith('.mjs') ? 'node' : bin;
    const full = bin.endsWith('.mjs') ? [bin, ...args] : args;
    let settled = false;
    // The killer must outlive finish(): after a timeout the promise settles at once, but the process may still need SIGKILL.
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    let killer;
    const child = spawn(cmd, full, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
      finish(reject, Object.assign(new Error(`kin ${args[0]} timed out after ${Math.round(timeoutMs / 1000)} s`), { timedOut: true }));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.on('error', () => { /* the command may exit before reading its input */ });
    child.on('error', (e) => finish(reject, Object.assign(e, { spawnFailed: true })));
    child.on('close', (code) => { clearTimeout(killer); finish(resolve, { code, stdout, stderr }); });
    child.stdin.end(input ?? '');
  });
}

/**
 * Storage over `kin files`, for the settings the screen wrote and the latest readings.
 * ASSUMES: `get` prints the file to stdout, `put` reads it from stdin, `ls` lists paths, and the screen's
 * files.read / files.write use this same folder.
 */
export class KinFilesStorage {
  constructor(run = runKin) { this.run = run; }

  async get(key) {
    const path = keyToPath(key);
    const r = await this.run(['files', 'get', path]);
    if (r.code === 0) return r.stdout === '' ? null : r.stdout;
    // A failed read must not be mistaken for "no file yet": a later save would then overwrite real data.
    const ls = await this.run(['files', 'ls']);
    if (ls.code === 0 && !ls.stdout.split(/\r?\n/).some((l) => l.includes(path))) return null;
    throw new Error(`Could not read ${path}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }

  async set(key, value) {
    const r = await this.run(['files', 'put', keyToPath(key)], { input: value });
    if (r.code !== 0) throw new Error(`Could not save ${keyToPath(key)}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }

  async remove(key) { await this.run(['files', 'rm', keyToPath(key)]); }
}

/**
 * The Kin as the extraction model. ASSUMES: the answer is printed on stdout.
 * Every failure is thrown as a KinFailure that says what kind it is (timeout, network, unavailable, rate limit,
 * permission…), so the caller can decide whether to retry soon, wait, or ask the person to act.
 */
export class KinAskProvider {
  constructor(run = runKin) { this.run = run; }
  async extract({ prompt, kinId }) {
    let r;
    try {
      r = await this.run(['ask', '--kin', kinId, prompt]);
    } catch (e) {
      throw new KinFailure(classifyFailure({ message: e.message, timedOut: !!e.timedOut, spawnFailed: !!e.spawnFailed }));
    }
    if (r.code !== 0) throw new KinFailure(classifyFailure({ message: (r.stderr || r.stdout || `exit code ${r.code}`).trim() }));
    return r.stdout;
  }
}

export async function kinEnd(message, { failed = false, run = runKin } = {}) {
  const line = String(message).replace(/\s+/g, ' ').trim().slice(0, 500);
  await run(['end', ...(failed ? ['--failed'] : []), line]);
}
