// Local-only validation host. This is deliberately excluded from the installable extension.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.ACVN_VALIDATION_PORT ?? 8937);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  try {
    const requestURL = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = decodeURIComponent(requestURL.pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/workspace.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    let data = fs.readFileSync(file);
    if (['workspace.html', 'sidepanel.html'].includes(path.basename(file))) data = Buffer.from(data.toString('utf8').replace('src="ui/app.js"', `src="validation/${['1', 'full'].includes(requestURL.searchParams.get('sourceFlow')) ? 'source-flow-bridge' : 'browser-bridge'}.js"`));
    if (path.basename(file) === 'print.html') data = Buffer.from(data.toString('utf8').replace('src="ui/print.js"', 'src="validation/print-bridge.js"'));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Validation host: http://127.0.0.1:${port}/workspace.html?legacy=1 (isolated local origin; Chrome APIs bridged, IndexedDB real)`));
