// Runs a development tool installed in tools/ (npm run tools): node tools/run.mjs eslint . | tsc -p jsconfig.json
// The tools stay out of the root package.json on purpose: Kindroid installs the root lockfile at every start of a
// run, so anything there would be installed (and paid for) every 15 minutes. Works the same on every OS.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BINS = { eslint: 'eslint/bin/eslint.js', tsc: 'typescript/bin/tsc' };
const [name, ...args] = process.argv.slice(2);
if (!BINS[name]) {
  console.error(`Unknown tool "${name}". Known: ${Object.keys(BINS).join(', ')}.`);
  process.exit(2);
}
const bin = fileURLToPath(new URL(`./node_modules/${BINS[name]}`, import.meta.url));
if (!existsSync(bin)) {
  console.error(`${name} is not installed. Run: npm run tools`);
  process.exit(2);
}
const r = spawnSync(process.execPath, [bin, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
