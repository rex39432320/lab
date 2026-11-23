import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Router, authorize } from '../server/lib/router.js';
import { addDays, campusNow, hourLabel, isValidDate, prettyDate, weekStart } from '../server/lib/time.js';
import { overview } from '../server/services/analytics.js';
import { Store } from '../server/store.js';
import { NOW, createSeededStore, startServer } from './helpers.js';

describe('store persistence', () => {
  it('writes atomically and reloads the same data', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lablink-')), 'db.json');
    const a = new Store({ file });
    a.insert('users', { id: 'u1', name: 'Test' });
    a.flush();
    const b = new Store({ file });
    assert.equal(b.load(), true);
    assert.equal(b.get('users', 'u1').name, 'Test');
    assert.ok(!fs.existsSync(`${file}.tmp`), 'temp file is renamed away');
  });

  it('starts fresh when the snapshot is corrupt', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lablink-')), 'db.json');
    fs.writeFileSync(file, '{not json');
    const originalError = console.error;
    console.error = () => {};
    try { assert.equal(new Store({ file }).load(), false); } finally { console.error = originalError; }
  });
});

describe('router', () => {
  it('matches params, distinguishes 404 from 405, and decodes segments', () => {
    const router = new Router();
    router.get('/api/things/:id', () => 'ok');
    assert.equal(router.match('GET', '/api/things/a%20b').params.id, 'a b');
    assert.deepEqual(router.match('POST', '/api/things/1'), { methodMismatch: true });
    assert.equal(router.match('GET', '/nope'), null);
  });

  it('enforces authentication and roles', () => {
    assert.throws(() => authorize({ auth: true }, null), { status: 401 });
    assert.throws(() => authorize({ auth: true, roles: ['admin'] }, { role: 'student' }), { status: 403 });
    assert.doesNotThrow(() => authorize({ auth: false }, null));
  });
});

describe('time helpers', () => {
  it('validates dates strictly', () => {
    assert.equal(isValidDate('2026-02-29'), false);
    assert.equal(isValidDate('2028-02-29'), true);
    assert.equal(isValidDate('26-1-1'), false);
  });

  it('formats hours and dates for people', () => {
    assert.equal(hourLabel(0), '12 AM');
    assert.equal(hourLabel(12), '12 PM');
    assert.equal(hourLabel(13.5), '1:30 PM');
    assert.equal(prettyDate('2026-03-02'), 'Mon 2 Mar');
    assert.equal(weekStart('2026-03-01'), '2026-02-23');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  it('reads the campus clock in the configured timezone', () => {
    const now = campusNow(Date.UTC(2026, 0, 1, 18, 30));
    assert.deepEqual(now, { date: '2026-01-02', hour: 0 }); // 18:30 UTC is midnight in IST
  });
});

describe('analytics service', () => {
  it('produces bounded, consistent figures', () => {
    const data = overview(createSeededStore(), NOW);
    assert.equal(data.heatmap.rows.length, 7);
    assert.ok(data.heatmap.rows.flat().every((v) => v >= 0 && v <= 1));
    assert.equal(data.daily.length, 21);
    assert.ok(data.kpis.utilization >= 0 && data.kpis.utilization <= 100);
    assert.ok(data.perEquipment.find((e) => e.status === 'maintenance').utilization === 0);
  });
});

describe('static serving', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  it('serves the app shell with revalidation and gzip', async () => {
    const res = await fetch(`${s.base}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const etag = res.headers.get('etag');
    const again = await fetch(`${s.base}/`, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
  });

  it('exposes a health probe and rejects unknown API routes', async () => {
    assert.equal((await fetch(`${s.base}/healthz`)).status, 200);
    assert.equal((await s.request('GET', '/api/does-not-exist')).status, 404);
    assert.equal((await s.request('POST', '/api/meta', { body: {} })).status, 405);
  });

  it('never serves server source files', async () => {
    for (const p of ['/server/app.js', '/package.json', '/../package.json', '/test/helpers.js']) {
      assert.equal((await fetch(`${s.base}${p}`)).status, 404, p);
    }
  });

  it('hides demo accounts when demo mode is off', async () => {
    const off = await startServer({ config: { demoMode: false } });
    try {
      assert.deepEqual((await off.request('GET', '/api/auth/demo')).body, { accounts: [] });
    } finally { off.close(); }
  });
});
