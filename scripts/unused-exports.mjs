// Lists the exports no other file imports (npm run unused-exports; part of npm run check). An export only its own
// file uses should not be exported, and one nothing uses is dead code. Imports are followed by their resolved path,
// so two modules exporting the same name are told apart. Tests count as users: a tested building block stays public.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCANNED = ['main.js', 'server.mjs', 'run', 'src', 'dev', 'scripts', 'tests'];
const SKIP = new Set(['node_modules', 'shots']);
// Used by name outside any import: the screen's bundler calls boot() of its entry (scripts/build-screen.mjs).
const USED_BY_TOOLING = new Set(['src/screen/main.js#boot']);
const posix = (p) => p.split(sep).join('/');

function files(path) {
  const abs = join(ROOT, path);
  if (statSync(abs).isFile()) return /\.(m?js|cjs)$/.test(path) ? [posix(path)] : [];
  return readdirSync(abs).filter((n) => !SKIP.has(n)).flatMap((n) => files(join(path, n)));
}

/** The names a module exports: export function|const|let|class Name, and export { a, b as c }. */
function exportsOf(code) {
  const names = [...code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    names.push(...m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  }
  return names;
}

// import { a, b as c } from '...'   and   const { a, b: c } = await import('...')
const STATIC = /^import\s*\{([^{}]*)\}\s*from\s*'([^']+)'/gm;
const DYNAMIC = /\{([^{}]*)\}\s*=\s*(?:await\s+)?import\(\s*'([^']+)'\s*\)/g;

/** [file it comes from, name] for every named import of a module (relative, or from the dev server's root). */
function importsOf(file, code) {
  const out = [];
  for (const m of [...code.matchAll(STATIC), ...code.matchAll(DYNAMIC)]) {
    const spec = m[2];
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // node: and packages
    const target = posix(relative(ROOT, spec.startsWith('/') ? join(ROOT, spec) : resolve(ROOT, dirname(file), spec)));
    for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+|\s*:\s*/)[0]).filter(Boolean)) out.push(`${target}#${n}`);
  }
  return out;
}

function unusedExports() {
  const all = SCANNED.flatMap(files);
  const code = new Map(all.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
  const used = new Set([...USED_BY_TOOLING, ...all.flatMap((f) => importsOf(f, code.get(f)))]);
  return all.filter((f) => !f.startsWith('tests/')).flatMap((f) => exportsOf(code.get(f)).map((n) => `${f}#${n}`)).filter((k) => !used.has(k));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const unused = unusedExports();
  if (unused.length) {
    console.error(`Exported but imported by no other file (make them local, or remove them if nothing uses them):\n  ${unused.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Every export is imported somewhere.');
}
