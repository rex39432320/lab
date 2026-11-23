// Static file server for the SPA: path-traversal safe, ETag revalidation, gzip.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.txt']);

export function createStaticHandler(root) {
  const base = path.resolve(root);
  const cache = new Map();

  function load(file) {
    const stat = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
    const ext = path.extname(file);
    const body = fs.readFileSync(file);
    const entry = {
      mtimeMs: stat.mtimeMs,
      body,
      type: TYPES[ext] ?? 'application/octet-stream',
      gzip: COMPRESSIBLE.has(ext) ? zlib.gzipSync(body) : null,
      etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
    };
    cache.set(file, entry);
    return entry;
  }

  /** @returns {boolean} true when a response was sent */
  return function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (rel.includes('\0')) return false;
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.resolve(base, `.${path.posix.normalize(rel)}`);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return false;

    const entry = load(file);
    const headers = {
      'Content-Type': entry.type,
      ETag: entry.etag,
      'Cache-Control': 'no-cache',
      Vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers).end();
      return true;
    }
    const useGzip = entry.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const body = useGzip ? entry.gzip : entry.body;
    if (useGzip) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
