// Dev server, zero dependencies: `npm start`, then open http://localhost:5173
// It serves the dev harness (a stand-in for Kindroid, dev/) at /, and what the harness loads: the screen (screen/), the
// shared logic (src/) and the run's program (run/program.js, the same code Kindroid runs). Local machine only.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./', import.meta.url)));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
};
const PUBLIC = ['dev', 'screen', 'src', 'run', 'sample'];

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
      if (rel === '') rel = 'dev/index.html';
      const abs = join(root, rel);
      if (!abs.startsWith(root + sep) || !PUBLIC.includes(rel.split(sep)[0]) || !types[extname(abs)]) { res.writeHead(404).end('Not found'); return; }
      if (!(await stat(abs)).isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'content-type': types[extname(abs)], 'cache-control': 'no-store' });
      res.end(await readFile(abs));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, host, () => console.log(`Clotheskin dev harness: http://localhost:${port}`));
}
