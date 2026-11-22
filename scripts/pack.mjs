// Packs only what Kindroid runs, in the same layout as published apps (Kin Bank, Planner):
// kin.json, package.json, main.js, run/, src/core/, screen/, sample/ -> dist/clotheskin.tar.gz
// Run: npm run pack   (after npm run build)
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = 'dist/clotheskin';
rmSync('dist', { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of ['kin.json', 'main.js', 'run', 'src/core', 'screen', 'sample']) cpSync(p, `${out}/${p}`, { recursive: true });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(`${out}/package.json`, JSON.stringify({ name: 'clotheskin', version, private: true, type: 'module' }));
execFileSync('tar', ['-czf', 'dist/clotheskin.tar.gz', '-C', out, '.']);
console.log(execFileSync('tar', ['-tzf', 'dist/clotheskin.tar.gz'], { encoding: 'utf8' }));
