// Shared test harness: a seeded app on an ephemeral port with a frozen clock.
import http from 'node:http';
import { createApp } from '../server/app.js';
import { seedStore } from '../server/seed.js';
import { createAi } from '../server/services/ai.js';
import { Store } from '../server/store.js';
import { DEMO_PASSWORD } from '../server/constants.js';
import { addDays } from '../server/lib/time.js';
import { freeWindows } from '../server/services/scheduling.js';

// A Monday morning; the seed's crafted scenarios land on Tuesday/Wednesday.
export const NOW = { date: '2026-03-02', hour: 8 };
export const TUESDAY = addDays(NOW.date, 1);
export const WEDNESDAY = addDays(NOW.date, 2);

export function createSeededStore(now = NOW) {
  const store = new Store();
  seedStore(store, now);
  return store;
}

export async function startServer({ ai = createAi({ apiKey: '' }), now = NOW, config = {} } = {}) {
  const store = createSeededStore(now);
  const clock = { current: { ...now } };
  const app = createApp({ store, ai, clock: () => clock.current, config: { secret: 'test-secret', demoMode: true, sweepIntervalMs: 0, limits: { loginPerIp: 10_000, apiPerMinute: 100_000 }, ...config } });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { body, cookie, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'X-Requested-With': 'lablink', ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  /** Sign in (cached per email) and return a tiny client bound to that session. */
  const clients = new Map();
  async function login(email, password = DEMO_PASSWORD) {
    if (clients.has(email)) return clients.get(email);
    const res = await request('POST', '/api/auth/login', { body: { email, password } });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const client = Object.fromEntries(['get', 'post', 'patch', 'delete'].map((m) => [m, (path, body) => request(m.toUpperCase(), path, { body, cookie })]));
    clients.set(email, client);
    return client;
  }

  /** First open window of `hours` on this equipment (and free for `userId`), from `fromOffset` days out. */
  function findFree(equipmentId, hours = 2, fromOffset = 7, userId) {
    const eq = store.get('equipment', equipmentId);
    for (let i = fromOffset; i < fromOffset + 14; i++) {
      const date = addDays(now.date, i);
      for (const [a, b] of freeWindows(store, eq, date, now)) {
        for (let start = a; start + hours <= b; start++) {
          const clash = store.data.bookings.some((x) => x.userId === userId && x.date === date && x.status !== 'cancelled' && start < x.endHour && x.startHour < start + hours);
          if (!clash) return { equipmentId, date, startHour: start, endHour: start + hours };
        }
      }
    }
    throw new Error(`no free ${hours}h window on ${equipmentId}`);
  }

  return { store, base, request, login, findFree, clock, close: () => { app.close(); server.close(); } };
}
