// Adapter over the `kin` command available inside a run. Everything that depends on the exact behaviour of
// that CLI is in this file, so a correction is local. See README "Pending verification".
import { spawn } from 'node:child_process';

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
    child.stdin.on('error', () => {}); // the CLI may exit without reading stdin (EPIPE); its exit code tells what happened
    child.stdin.end(input ?? '');
  });
}

/** The Kin as the extraction model. ASSUMES: the answer is printed on stdout. */
export class KinAskProvider {
  constructor(run = runKin) { this.run = run; }
  async extract({ prompt, kinId }) {
    const r = await this.run(['ask', '--kin', kinId, prompt]);
    if (r.code !== 0) throw new Error(`The Kin could not be asked: ${(r.stderr || r.stdout).trim().slice(0, 200) || `exit code ${r.code}`}`);
    return r.stdout;
  }
}

export async function kinEnd(message, { failed = false, run = runKin } = {}) {
  const line = String(message).replace(/\s+/g, ' ').trim().slice(0, 500);
  await run(['end', ...(failed ? ['--failed'] : []), line]);
}
