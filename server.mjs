// Zero-dependency static server for local development of the screen: `npm start` then open http://localhost:5173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./screen/', import.meta.url)));
const port = Number(process.env.PORT || 5173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8',
};
const PUBLIC = ['index.html', 'theme.css', 'styles.css', 'src', 'assets'];

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
      if (rel === '') rel = 'index.html';
      const abs = join(root, rel);
      const top = rel.split(sep)[0];
      if (!abs.startsWith(root + sep) || !PUBLIC.includes(top)) { res.writeHead(404).end('Not found'); return; }
      const s = await stat(abs);
      if (!s.isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'content-type': types[extname(abs)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(abs));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, () => console.log(`Clotheskin running at http://localhost:${port}`));
}
