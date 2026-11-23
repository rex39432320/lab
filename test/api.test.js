import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays } from '../server/lib/time.js';
import { weekHours } from '../server/services/scheduling.js';
import { NOW, TUESDAY, WEDNESDAY, startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

describe('authentication & authorization', () => {
  it('rejects unauthenticated API calls', async () => {
    const res = await s.request('GET', '/api/equipment');
    assert.equal(res.status, 401);
  });

  it('rejects wrong passwords with a generic message', async () => {
    const res = await s.request('POST', '/api/auth/login', { body: { email: 'aarav@lablink.edu', password: 'nope-nope' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Incorrect email or password.');
    const unknown = await s.request('POST', '/api/auth/login', { body: { email: 'ghost@lablink.edu', password: 'nope-nope' } });
    assert.equal(unknown.body.error, res.body.error, 'must not reveal which emails exist');
  });

  it('sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const res = await s.request('POST', '/api/auth/login', { body: { email: 'aarav@lablink.edu', password: 'LabLink@2026' } });
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
  });

  it('requires the CSRF header on mutating requests', async () => {
    const res = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  });

  it('rejects tampered session cookies', async () => {
    const res = await s.request('GET', '/api/auth/me', { cookie: 'll_session=eyJ1aWQiOiJ1LWFkbWluIiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.forged' });
    assert.equal(res.body.user, null);
  });

  it('keeps students out of faculty and admin endpoints', async () => {
    const student = await s.login('aarav@lablink.edu');
    assert.equal((await student.get('/api/analytics/overview')).status, 403);
    assert.equal((await student.get('/api/approvals')).status, 403);
    assert.equal((await student.get('/api/admin/users')).status, 403);
    assert.equal((await student.post('/api/equipment', { name: 'x' })).status, 403);
  });

  it('rate limits repeated failed sign-ins', async () => {
    let last;
    for (let i = 0; i < 10; i++) last = await s.request('POST', '/api/auth/login', { body: { email: 'zoya@lablink.edu', password: 'wrong-pass-1' } });
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('retry-after'));
  });

  it('registers a new student with password rules', async () => {
    const weak = await s.request('POST', '/api/auth/register', { body: { name: 'New Student', email: 'new@lablink.edu', department: 'ECE', password: 'onlyletters' } });
    assert.equal(weak.status, 400);
    const ok = await s.request('POST', '/api/auth/register', { body: { name: 'New Student', email: 'new@lablink.edu', department: 'ECE', password: 'Sturdy-pass1' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.role, 'student');
    const dup = await s.request('POST', '/api/auth/register', { body: { name: 'New Student', email: 'new@lablink.edu', department: 'ECE', password: 'Sturdy-pass1' } });
    assert.equal(dup.status, 409);
  });
});

describe('input validation & hardening', () => {
  it('returns 400 with the field name for bad input', async () => {
    const c = await s.login('isha@lablink.edu');
    const res = await c.post('/api/bookings', { equipmentId: 'eq-dso', date: 'tomorrow', startHour: 10, endHour: 11 });
    assert.equal(res.status, 400);
    assert.equal(res.body.details.field, 'date');
    assert.equal((await c.post('/api/bookings', { equipmentId: 'eq-dso', date: TUESDAY, startHour: 12, endHour: 10 })).status, 400);
  });

  it('rejects non-JSON bodies and oversized payloads', async () => {
    const c = await s.login('isha@lablink.edu');
    const cookie = (await s.request('POST', '/api/auth/login', { body: { email: 'isha@lablink.edu', password: 'LabLink@2026' } })).headers.get('set-cookie').split(';')[0];
    const bad = await fetch(`${s.base}/api/bookings/check`, { method: 'POST', headers: { 'X-Requested-With': 'lablink', 'Content-Type': 'text/plain', Cookie: cookie }, body: 'hello' });
    assert.equal(bad.status, 415);
    const big = await c.post('/api/bookings/check', { padding: 'x'.repeat(70_000) });
    assert.equal(big.status, 413);
  });

  it('sends strict security headers', async () => {
    const res = await fetch(`${s.base}/`);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });

  it('blocks path traversal on static files', async () => {
    const res = await fetch(`${s.base}/..%2fserver%2fseed.js`);
    assert.equal(res.status, 404);
    assert.equal((await fetch(`${s.base}/%2e%2e/package.json`)).status, 404);
  });
});

describe('equipment discovery', () => {
  it('lists, filters and searches equipment', async () => {
    const c = await s.login('aarav@lablink.edu');
    const all = await c.get('/api/equipment');
    assert.equal(all.body.items.length, 37);
    const robots = await c.get('/api/equipment?category=Robotics');
    assert.ok(robots.body.items.every((e) => e.category === 'Robotics'));
    const found = await c.get(`/api/equipment?q=${encodeURIComponent('3D printing a prototype')}`);
    assert.equal(found.body.items[0].id, 'eq-fdm');
    assert.equal((await c.get('/api/equipment?category=Nonsense')).status, 400);
  });

  it('shows per-user access state for restricted equipment', async () => {
    const arjun = await s.login('arjun@lablink.edu');
    assert.equal((await arjun.get('/api/equipment/eq-sa')).body.equipment.access, 'granted');
    assert.equal((await arjun.get('/api/equipment/eq-vna')).body.equipment.access, 'pending');
    assert.equal((await arjun.get('/api/equipment/eq-sem')).body.equipment.access, 'required');
  });

  it('returns availability without leaking other users bookings to students', async () => {
    const c = await s.login('aarav@lablink.edu');
    const res = await c.get(`/api/equipment/eq-sa/availability?from=${TUESDAY}&days=1`);
    const booked = res.body.days[0].slots.find((x) => x.state === 'booked');
    assert.ok(booked);
    assert.equal(booked.booking.id, undefined);
    assert.equal(booked.booking.mine, false);
  });
});

describe('booking lifecycle', () => {
  it('creates, conflicts, cancels and auto-promotes the waitlist', async () => {
    const aarav = await s.login('aarav@lablink.edu');
    const slot = { ...s.findFree('eq-fpga', 2, 7, 'u-aarav'), projectId: 'p-irrigation' };
    const { date } = slot;

    const first = await aarav.post('/api/bookings', slot);
    assert.equal(first.status, 201);
    assert.equal(first.body.booking.status, 'confirmed');

    const vikram = await s.login('vikram@lablink.edu');
    const clash = await vikram.post('/api/bookings', { ...slot, projectId: 'p-irrigation' });
    assert.equal(clash.status, 409);
    assert.ok(clash.body.resolution.options.length > 0);
    assert.ok(clash.body.resolution.summary);

    const wait = await vikram.post('/api/waitlist', slot);
    assert.equal(wait.status, 201);
    assert.equal((await vikram.post('/api/waitlist', slot)).status, 409, 'no duplicate waitlist entries');

    const cancel = await aarav.post(`/api/bookings/${first.body.booking.id}/cancel`, {});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.promoted, 1);
    const mine = await vikram.get(`/api/bookings?equipmentId=eq-fpga&from=${date}&to=${date}`);
    assert.equal(mine.body.items[0].status, 'confirmed');
    assert.equal((await vikram.get('/api/waitlist')).body.items.length, 0);
  });

  it('stops users cancelling other people\'s bookings', async () => {
    const aarav = await s.login('aarav@lablink.edu');
    const priya = await s.login('priya@lablink.edu');
    const slot = { ...s.findFree('eq-esp32', 1, 7, 'u-aarav'), projectId: 'p-irrigation' };
    const made = await aarav.post('/api/bookings', slot);
    assert.equal(made.status, 201);
    assert.equal((await priya.post(`/api/bookings/${made.body.booking.id}/cancel`, {})).status, 403);
  });

  it('enforces the weekly fair-use quota', async () => {
    const diya = await s.login('diya@lablink.edu');
    const slot = { ...s.findFree('eq-optics', 3, 8, 'u-diya'), projectId: 'p-interf' };
    s.store.get('users', 'u-diya').weeklyQuota = weekHours(s.store, 'u-diya', slot.date) + 2;
    const first = await diya.post('/api/bookings', { ...slot, endHour: slot.startHour + 2 });
    assert.equal(first.status, 201);
    const over = await diya.post('/api/bookings', { ...slot, startHour: slot.startHour + 2, endHour: slot.startHour + 3 });
    assert.equal(over.status, 422);
    assert.match(over.body.error, /fair-use/);
  });

  it('routes long student bookings to the guide for approval', async () => {
    const aarav = await s.login('aarav@lablink.edu');
    const slot = { ...s.findFree('eq-dso', 4, 8, 'u-aarav'), projectId: 'p-irrigation' };
    const made = await aarav.post('/api/bookings', slot);
    assert.equal(made.status, 201);
    assert.equal(made.body.booking.status, 'pending');
    const rao = await s.login('rao@lablink.edu');
    const inbox = await rao.get('/api/approvals');
    assert.ok(inbox.body.bookings.some((b) => b.id === made.body.booking.id));
    const approved = await rao.post(`/api/bookings/${made.body.booking.id}/decision`, { decision: 'approve', comment: 'Go ahead' });
    assert.equal(approved.body.booking.status, 'confirmed');
    const menon = await s.login('menon@lablink.edu');
    assert.equal((await menon.post(`/api/bookings/${made.body.booking.id}/decision`, { decision: 'approve' })).status, 403, 'not an approver');
    assert.equal((await rao.post(`/api/bookings/${made.body.booking.id}/decision`, { decision: 'approve' })).status, 400, 'already decided');
  });

  it('commits multi-session plans atomically', async () => {
    const aarav = await s.login('aarav@lablink.edu');
    const good = { ...s.findFree('eq-rpi', 2, 9, 'u-aarav'), projectId: 'p-irrigation' };
    const { date } = good;
    const closed = { ...good, date: '2026-03-08' };
    const bad = await aarav.post('/api/bookings/commit', { sessions: [good, closed] });
    assert.equal(bad.status, 422);
    const after = await aarav.get(`/api/bookings?equipmentId=eq-rpi&from=${date}&to=${date}`);
    assert.equal(after.body.items.filter((b) => b.mine && b.startHour === 9).length, 0, 'rolled back');
    const second = { ...s.findFree('eq-rpi', 2, 13, 'u-aarav'), projectId: 'p-irrigation' };
    const ok = await aarav.post('/api/bookings/commit', { sessions: [good, second] });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.bookings.length, 2);
  });

  it('exports upcoming bookings as an ICS calendar', async () => {
    const c = await s.login('aarav@lablink.edu');
    const res = await c.get('/api/bookings/calendar.ics');
    assert.equal(res.status, 200);
    assert.match(res.text, /^BEGIN:VCALENDAR/);
    assert.match(res.text, /END:VCALENDAR\r\n$/);
  });
});

describe('project-based access approval', () => {
  it('lets a faculty approver grant access, unlocking booking', async () => {
    const irrigation = await s.login('aarav@lablink.edu');
    const slot = { ...s.findFree('eq-pcbmill', 2, 5, 'u-aarav'), projectId: 'p-irrigation' };
    const before = await irrigation.post('/api/bookings', slot);
    assert.equal(before.status, 422);
    assert.equal(before.body.details.errors[0].code, 'NO_ACCESS');

    const rao = await s.login('rao@lablink.edu');
    const pending = (await rao.get('/api/approvals')).body.accessRequests.find((r) => r.equipmentId === 'eq-pcbmill');
    assert.ok(pending, 'the seeded pending request is in the faculty inbox');
    const wrongFaculty = await (await s.login('das@lablink.edu')).post(`/api/access-requests/${pending.id}/decision`, { decision: 'approve' });
    assert.equal(wrongFaculty.status, 403);
    assert.equal((await rao.post(`/api/access-requests/${pending.id}/decision`, { decision: 'approve', comment: 'Safety briefing done' })).status, 200);

    const after = await irrigation.post('/api/bookings', slot);
    assert.equal(after.status, 201);
    const notes = await irrigation.get('/api/notifications');
    assert.ok(notes.body.items.some((n) => n.title === 'Access approved'));
  });

  it('prevents duplicate access requests and requests for open equipment', async () => {
    const aarav = await s.login('aarav@lablink.edu');
    assert.equal((await aarav.post('/api/access-requests', { projectId: 'p-irrigation', equipmentId: 'eq-dso', justification: 'Need it for debugging power draw.' })).status, 400);
    const first = await aarav.post('/api/access-requests', { projectId: 'p-irrigation', equipmentId: 'eq-sem', justification: 'Inspect solder joints under SEM.' });
    assert.equal(first.status, 201);
    assert.equal((await aarav.post('/api/access-requests', { projectId: 'p-irrigation', equipmentId: 'eq-sem', justification: 'Inspect solder joints under SEM.' })).status, 409);
    assert.equal((await aarav.post('/api/access-requests', { projectId: 'p-5g', equipmentId: 'eq-sem', justification: 'Not my project at all really.' })).status, 403);
  });
});

describe('fair-share swap negotiation', () => {
  it('proposes, accepts and rewards goodwill', async () => {
    const arjun = await s.login('arjun@lablink.edu');
    const request = { equipmentId: 'eq-sa', projectId: 'p-5g', date: TUESDAY, startHour: 11, endHour: 13 };
    const check = await arjun.post('/api/bookings/check', request);
    const swapOption = check.body.resolution.options.find((o) => o.type === 'swap');
    assert.ok(swapOption);

    const proposed = await arjun.post('/api/swaps', { targetBookingId: swapOption.action.targetBookingId, request, message: 'Spectrum mask test due Friday' });
    assert.equal(proposed.status, 201);
    assert.equal((await arjun.post('/api/swaps', { targetBookingId: swapOption.action.targetBookingId, request })).status, 409, 'only one open swap');

    const vikram = await s.login('vikram@lablink.edu');
    const inbox = await vikram.get('/api/swaps');
    assert.equal(inbox.body.items[0].direction, 'incoming');
    assert.equal((await arjun.post(`/api/swaps/${proposed.body.swap.id}/respond`, { accept: true })).status, 403, 'only the holder can respond');

    const accepted = await vikram.post(`/api/swaps/${proposed.body.swap.id}/respond`, { accept: true });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.karma, 1);

    const arjunBookings = await arjun.get(`/api/bookings?equipmentId=eq-sa&from=${TUESDAY}&to=${TUESDAY}`);
    assert.ok(arjunBookings.body.items.some((b) => b.mine && b.startHour === 11 && b.endHour === 13));
    const vikramBooking = (await vikram.get('/api/bookings?equipmentId=eq-sa')).body.items.find((b) => b.projectId === 'p-drone');
    assert.notEqual(vikramBooking.date === TUESDAY && vikramBooking.startHour, 10, 'holder was moved');
  });

  it('adds the requester to the waitlist when a swap is declined', async () => {
    const isha = await s.login('isha@lablink.edu');
    const request = { equipmentId: 'eq-jetson', projectId: 'p-sorter', date: TUESDAY, startHour: 13, endHour: 15 };
    const res = await isha.post('/api/bookings/check', request);
    const swap = res.body.resolution.options.find((o) => o.type === 'swap');
    assert.ok(swap, 'Aarav holds a flexible, lower-priority Jetson slot');
    const proposed = await isha.post('/api/swaps', { targetBookingId: swap.action.targetBookingId, request });
    const aarav = await s.login('aarav@lablink.edu');
    const declined = await aarav.post(`/api/swaps/${proposed.body.swap.id}/respond`, { accept: false });
    assert.equal(declined.body.swap.status, 'declined');
    assert.ok((await isha.get('/api/waitlist')).body.items.some((w) => w.equipmentId === 'eq-jetson'));
  });
});

describe('maintenance workflow', () => {
  it('cancels upcoming bookings and notifies users when equipment goes down', async () => {
    const admin = await s.login('admin@lablink.edu');
    const before = s.store.data.bookings.filter((b) => b.equipmentId === 'eq-gel' && ['confirmed', 'pending'].includes(b.status) && b.date >= NOW.date).length;
    const res = await admin.patch('/api/equipment/eq-gel', { status: 'maintenance' });
    assert.equal(res.status, 200);
    assert.ok(res.body.cancelled >= before);
    const student = await s.login('sneha@lablink.edu');
    const attempt = await student.post('/api/bookings', { equipmentId: 'eq-gel', projectId: 'p-crispr', date: addDays(NOW.date, 3), startHour: 9, endHour: 10 });
    assert.ok([409, 422].includes(attempt.status));
  });
});

describe('analytics & dashboard', () => {
  it('serves utilisation analytics to faculty', async () => {
    const rao = await s.login('rao@lablink.edu');
    const res = await rao.get('/api/analytics/overview');
    assert.equal(res.status, 200);
    assert.equal(res.body.heatmap.rows.length, 7);
    assert.ok(res.body.kpis.hoursShared > 0);
    assert.ok(res.body.perEquipment.every((e) => e.utilization >= 0 && e.utilization <= 100));
  });

  it('serves a personalised dashboard', async () => {
    const c = await s.login('arjun@lablink.edu');
    const res = await c.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.quota.limit >= 12);
    assert.ok(Array.isArray(res.body.upcoming));
  });
});

describe('copilot chat', () => {
  it('finds equipment from a description', async () => {
    const c = await s.login('aarav@lablink.edu');
    const res = await c.post('/api/ai/chat', { message: 'I need something to 3D print a prototype' });
    assert.equal(res.status, 200);
    assert.equal(res.body.cards[0].equipment.id, 'eq-fdm');
    assert.equal(res.body.mode, 'local');
  });

  it('builds a plan card from a scheduling request', async () => {
    const c = await s.login('arjun@lablink.edu');
    const res = await c.post('/api/ai/chat', { message: 'Plan 4 hours on the Raspberry Pi kit before Friday' });
    assert.equal(res.body.cards[0].type, 'plan');
    assert.ok(res.body.cards[0].sessions.length >= 2);
  });

  it('validates message length', async () => {
    const c = await s.login('aarav@lablink.edu');
    assert.equal((await c.post('/api/ai/chat', { message: '' })).status, 400);
    assert.equal((await c.post('/api/ai/chat', { message: 'x'.repeat(401) })).status, 400);
  });
});

describe('no-show release', () => {
  it('releases an unclaimed slot after the grace period and promotes the waitlist', async () => {
    const local = await startServer({ now: { date: NOW.date, hour: 9.5 } });
    try {
      const eq = local.store.get('equipment', 'eq-la');
      for (const b of local.store.data.bookings.filter((x) => x.date === NOW.date && (x.equipmentId === eq.id || ['u-aarav', 'u-vikram'].includes(x.userId)))) b.status = 'cancelled';
      const aarav = await local.login('aarav@lablink.edu');
      const made = await aarav.post('/api/bookings', { equipmentId: eq.id, projectId: 'p-irrigation', date: NOW.date, startHour: 11, endHour: 13 });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      const vikram = await local.login('vikram@lablink.edu');
      const wait = await vikram.post('/api/waitlist', { equipmentId: eq.id, projectId: 'p-irrigation', date: NOW.date, startHour: 12, endHour: 13 });
      assert.equal(wait.status, 201, JSON.stringify(wait.body));

      local.clock.current = { date: NOW.date, hour: 11.6 };
      await aarav.get('/api/dashboard'); // any authenticated call runs the lifecycle sweep
      assert.equal(local.store.get('bookings', made.body.booking.id).status, 'no_show');
      const promoted = (await vikram.get(`/api/bookings?equipmentId=${eq.id}&from=${NOW.date}&to=${NOW.date}`)).body.items.find((b) => b.mine);
      assert.equal(promoted.status, 'confirmed');
      assert.equal(promoted.startHour, 12);
    } finally {
      local.close();
    }
  });
});

describe('wednesday scenario data', () => {
  it('seeds pending approvals for faculty demos', async () => {
    const menon = await s.login('menon@lablink.edu');
    const inbox = await menon.get('/api/approvals');
    assert.ok(inbox.body.bookings.some((b) => b.date === WEDNESDAY));
  });
});
