// HTTP application: security headers, rate limiting, CSRF guard, auth, routing.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_COOKIE } from './constants.js';
import { HttpError, forbidden, notFound, tooMany } from './lib/errors.js';
import { Reply, Router, authorize } from './lib/router.js';
import { RateLimiter, applySecurityHeaders, parseCookies, verifyToken } from './lib/security.js';
import { campusNow } from './lib/time.js';
import { registerRoutes } from './routes/index.js';
import { createAi } from './services/ai.js';
import { sweep } from './services/bookings.js';
import { createStaticHandler } from './static.js';

const MAX_BODY_BYTES = 64 * 1024;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return reject(new HttpError(415, 'Send JSON with Content-Type: application/json.'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Malformed JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers,
  });
  res.end(body);
}

/**
 * @param {{store: import('./store.js').Store, ai?: object, clock?: () => {date: string, hour: number}, config?: object}} options
 */
export function createApp({ store, ai = createAi(), clock = () => campusNow(), config = {} }) {
  const cfg = {
    secret: config.secret ?? crypto.randomBytes(32).toString('hex'),
    demoMode: config.demoMode ?? true,
    trustProxy: config.trustProxy ?? false,
    sessionHours: 8,
    sweepIntervalMs: 15_000,
    ...config,
    limits: { apiPerMinute: 240, loginPerIp: 30, loginPerEmail: 8, ...config.limits },
  };
  const router = new Router();
  const limiter = new RateLimiter();
  const serveStatic = createStaticHandler(PUBLIC_DIR);
  registerRoutes(router, { store, ai, clock, cfg, limiter });
  let lastSweep = 0;

  const clientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (cfg.trustProxy && forwarded) return String(forwarded).split(',').at(-1).trim();
    return req.socket.remoteAddress ?? 'unknown';
  };
  const isHttps = (req) => Boolean(req.socket.encrypted) || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');

  function authenticate(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const payload = verifyToken(token, cfg.secret);
    const user = payload && store.get('users', payload.uid);
    return user && user.active !== false ? user : null;
  }

  async function handleApi(req, res, url) {
    const ip = clientIp(req);
    const limit = limiter.hit(`api:${ip}`, cfg.limits.apiPerMinute, 60_000);
    if (!limit.allowed) throw tooMany('Too many requests. Please slow down.', limit.retryAfterSec);

    const matched = router.match(req.method, url.pathname);
    if (!matched) throw notFound('Unknown endpoint.');
    if (matched.methodMismatch) throw new HttpError(405, 'Method not allowed.');

    const user = authenticate(req);
    authorize(matched.route.options, user);
    const mutating = !['GET', 'HEAD'].includes(req.method);
    // Custom header + SameSite=Strict cookies defend against CSRF.
    if (mutating && req.headers['x-requested-with'] !== 'lablink') throw forbidden('Missing required request header.');
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    const body = mutating ? await readJson(req) : {};

    const nowMs = Date.now();
    if (nowMs - lastSweep >= cfg.sweepIntervalMs) {
      lastSweep = nowMs;
      sweep(store, clock());
    }

    const result = await matched.route.handler({
      req, user, body, ip, secure: isHttps(req), now: clock(), params: matched.params, query: Object.fromEntries(url.searchParams),
    });
    if (result instanceof Reply) {
      if (result.raw) {
        res.writeHead(result.status, { 'Cache-Control': 'no-store', ...result.headers });
        res.end(result.body);
      } else send(res, result.status, result.body, result.headers);
    } else send(res, 200, result ?? { ok: true });
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    applySecurityHeaders(res, { https: isHttps(req) });
    try {
      if (url.pathname === '/healthz') return send(res, 200, { status: 'ok' });
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (!serveStatic(req, res, url.pathname)) throw notFound('Page not found.');
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) {
        const headers = err.details?.retryAfter ? { 'Retry-After': String(err.details.retryAfter) } : {};
        return send(res, err.status, { error: err.message, details: err.details }, headers);
      }
      console.error('Unhandled error:', err);
      send(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }

  return { handler, close: () => limiter.close(), config: cfg };
}
