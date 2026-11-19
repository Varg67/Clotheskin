// Adapters over the `kin` command available inside a run. Everything that depends on the exact
// behaviour of that CLI is in this file, so a correction is local. See README "Pending verification".
import { spawn } from 'node:child_process';
import { keyToPath } from '../screen/src/host/paths.js';

export function runKin(args, { input, bin = process.env.KIN_BIN || 'kin', timeoutMs = 110000 } = {}) {
  return new Promise((resolve, reject) => {
    const cmd = bin.endsWith('.mjs') ? 'node' : bin;
    const full = bin.endsWith('.mjs') ? [bin, ...args] : args;
    const child = spawn(cmd, full, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`kin ${args[0]} timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input ?? '');
  });
}

/** Storage over `kin files`. ASSUMES: `get` prints the file to stdout and `put` reads it from stdin. */
export class KinFilesStorage {
  constructor(run = runKin) { this.run = run; }

  async get(key) {
    const path = keyToPath(key);
    const r = await this.run(['files', 'get', path]);
    if (r.code === 0) return r.stdout === '' ? null : r.stdout;
    // A failed read must not be mistaken for "no file yet": that would let the next save wipe real data.
    const ls = await this.run(['files', 'ls']);
    if (ls.code === 0 && !ls.stdout.split(/\r?\n/).some((l) => l.includes(path))) return null;
    throw new Error(`Could not read ${path}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }

  async set(key, value) {
    const r = await this.run(['files', 'put', keyToPath(key)], { input: value });
    if (r.code !== 0) throw new Error(`Could not save ${keyToPath(key)}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }

  async remove(key) {
    await this.run(['files', 'rm', keyToPath(key)]);
  }

  async keys() { return []; }
}

/** The Kin as the extraction model. ASSUMES: the answer is printed on stdout. */
export class KinAskProvider {
  constructor(run = runKin) { this.run = run; }
  async extract({ prompt, profile }) {
    const r = await this.run(['ask', '--kin', profile.id, prompt]);
    if (r.code !== 0) throw new Error(`The Kin could not be asked: ${(r.stderr || r.stdout).trim().slice(0, 200) || `exit code ${r.code}`}`);
    return r.stdout;
  }
}

export async function kinEnd(message, { failed = false, run = runKin } = {}) {
  const line = String(message).replace(/\s+/g, ' ').trim().slice(0, 500);
  await run(['end', ...(failed ? ['--failed'] : []), line]);
}
