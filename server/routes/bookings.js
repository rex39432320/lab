import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { Reply, created } from '../lib/router.js';
import { v, slotInput } from '../lib/validate.js';
import { bookingView } from '../serializers.js';
import { audit, notify } from '../services/activity.js';
import { canDecide, cancelBooking, createBooking, promoteWaitlist } from '../services/bookings.js';
import { planSessions } from '../services/planner.js';
import { priorityFor } from '../services/priority.js';
import { buildResolution, localSummary } from '../services/resolver.js';
import { validateBooking } from '../services/scheduling.js';

const pad = (n) => String(n).padStart(2, '0');
const icsStamp = (date, hour) => `${date.replaceAll('-', '')}T${pad(hour)}0000`;
const icsEscape = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

function buildIcs(store, bookings) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LabLink//Bookings//EN', 'CALSCALE:GREGORIAN'];
  for (const b of bookings) {
    const eq = store.get('equipment', b.equipmentId);
    lines.push(
      'BEGIN:VEVENT', `UID:${b.id}@lablink`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
      `DTSTART:${icsStamp(b.date, b.startHour)}`, `DTEND:${icsStamp(b.date, b.endHour)}`,
      `SUMMARY:${icsEscape(`Lab: ${eq?.name ?? 'Equipment'}`)}`, `LOCATION:${icsEscape(eq?.location ?? '')}`,
      `DESCRIPTION:${icsEscape(b.purpose || 'LabLink booking')}`, 'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export function registerBookings(router, { store, ai }) {
  const findBooking = (id) => {
    const b = store.get('bookings', id);
    if (!b) throw notFound('Booking not found.');
    return b;
  };
  const view = (b, user, now) => bookingView(store, b, user, now);

  async function resolutionResponse(user, input, now) {
    const resolution = buildResolution(store, user, input, now);
    const eq = store.get('equipment', input.equipmentId);
    const top = resolution.options[0];
    const facts = { equipment: eq?.name, requested: resolution.requested.label, problems: resolution.errors.map((e) => e.code), yourPriority: resolution.requester.score, bestOption: top && { type: top.type, title: top.title, detail: top.detail } };
    const aiText = resolution.errors.length ? await ai.narrate(facts) : null;
    resolution.summary = aiText ?? localSummary(resolution, eq?.name ?? 'This equipment');
    resolution.summarySource = aiText ? 'gemini' : 'rules';
    return resolution;
  }

  router.get('/api/bookings', ({ query, user, now }) => {
    const scopeAll = query.scope === 'all' && user.role !== 'student';
    const equipmentId = v.id(query.equipmentId, 'equipmentId', { optional: true });
    const status = v.string(query.status, 'status', { max: 20, optional: true });
    const from = v.date(query.from, 'from', { optional: true });
    const to = v.date(query.to, 'to', { optional: true });
    const items = store.data.bookings
      .filter((b) => (scopeAll || b.userId === user.id) && (!equipmentId || b.equipmentId === equipmentId) && (!status || b.status === status) && (!from || b.date >= from) && (!to || b.date <= to))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
      .slice(-400);
    return { items: items.map((b) => view(b, user, now)) };
  });

  router.get('/api/bookings/calendar.ics', ({ user, now }) => {
    const upcoming = store.data.bookings.filter((b) => b.userId === user.id && ['confirmed', 'pending'].includes(b.status) && b.date >= now.date);
    return new Reply(buildIcs(store, upcoming), { raw: true, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="lablink-bookings.ics"' } });
  });

  // Dry-run validation plus smart alternatives; creates nothing.
  router.post('/api/bookings/check', async ({ body, user, now }) => {
    const input = slotInput(v.object(body));
    const check = validateBooking(store, user, input, now);
    const priority = priorityFor(store, user, check.project, now);
    if (!check.errors.length) return { valid: true, warnings: check.warnings, needsApproval: check.needsApproval, hours: check.hours, priority };
    return { valid: false, errors: check.errors, warnings: check.warnings, resolution: await resolutionResponse(user, input, now) };
  });

  router.post('/api/bookings', async ({ body, user, now }) => {
    const data = v.object(body);
    const input = slotInput(data);
    const flexible = v.bool(data.flexible, 'flexible', { optional: true }) ?? false;
    const check = validateBooking(store, user, input, now);
    if (check.errors.some((e) => e.code === 'CONFLICT')) {
      const resolution = await resolutionResponse(user, input, now);
      return new Reply({ error: check.errors.find((e) => e.code === 'CONFLICT').message, resolution }, { status: 409 });
    }
    if (check.errors.length) throw new HttpError(422, check.errors[0].message, { errors: check.errors });
    const { booking } = createBooking(store, user, input, now, { flexible });
    return created({ booking: view(booking, user, now), needsApproval: booking.status === 'pending' });
  });

  // Atomically create several sessions (planner output, split sessions, alternatives).
  router.post('/api/bookings/commit', ({ body, user, now }) => {
    const data = v.object(body);
    const sessions = v.array(data.sessions, 'sessions', { max: 12, each: (s, f) => slotInput(v.object(s, f)) });
    if (!sessions.length) throw badRequest('sessions: provide at least one session');
    const made = [];
    try {
      sessions.forEach((s, i) => {
        try {
          made.push(createBooking(store, user, { ...s, purpose: s.purpose || data.purpose || '' }, now, { flexible: data.flexible === true }).booking);
        } catch (err) {
          throw new HttpError(422, `Session ${i + 1}: ${err.message}`, { index: i, errors: err.details?.errors });
        }
      });
    } catch (err) {
      for (const b of made) store.remove('bookings', b.id);
      throw err;
    }
    audit(store, user, 'conflict.resolved', made[0].id, { sessions: made.length });
    return created({ bookings: made.map((b) => view(b, user, now)) });
  });

  router.post('/api/bookings/plan', ({ body, user, now }) => {
    const data = v.object(body);
    const equipmentId = v.id(data.equipmentId, 'equipmentId');
    const eq = store.get('equipment', equipmentId);
    if (!eq) throw notFound('Equipment not found.');
    const projectId = v.id(data.projectId, 'projectId', { optional: true });
    const project = projectId ? store.get('projects', projectId) : null;
    if (projectId && !project) throw notFound('Project not found.');
    const params = {
      equipmentId, projectId,
      hours: v.int(data.hours, 'hours', { min: 1, max: 60 }),
      deadline: v.date(data.deadline ?? project?.deadline, 'deadline'),
      sessionHours: v.int(data.sessionHours ?? 2, 'sessionHours', { min: 1, max: 8 }),
      preferred: v.oneOf(data.preferred ?? 'any', 'preferred', ['any', 'morning', 'afternoon']),
    };
    return { plan: planSessions(store, user, params, now), params };
  });

  router.post('/api/bookings/:id/cancel', ({ params, body, user, now }) => {
    const b = findBooking(params.id);
    const eq = store.get('equipment', b.equipmentId);
    const mine = b.userId === user.id;
    if (!mine && !(user.role !== 'student' && canDecide(user, eq, store.get('projects', b.projectId)))) throw forbidden('You can only cancel your own bookings.');
    if (!['pending', 'confirmed'].includes(b.status)) throw badRequest('This booking can no longer be cancelled.');
    const reason = v.string(body.reason, 'reason', { max: 200, optional: true }) ?? (mine ? 'Cancelled by user' : `Cancelled by ${user.name}`);
    const promoted = cancelBooking(store, user, b, now, reason);
    if (!mine) notify(store, b.userId, { type: 'booking', title: 'Your booking was cancelled', body: `${eq.name} on ${b.date}: ${reason}`, link: '#/bookings' });
    return { booking: view(b, user, now), promoted: promoted.length };
  });

  router.post('/api/bookings/:id/check-in', ({ params, user, now }) => {
    const b = findBooking(params.id);
    const v0 = bookingView(store, b, user, now);
    if (!v0.canCheckIn) throw badRequest('Check-in opens 15 minutes before your slot and closes when it ends.');
    b.status = 'checked_in';
    b.checkedInAt = Date.now();
    audit(store, user, 'booking.checked_in', b.id);
    return { booking: view(b, user, now) };
  });

  router.post('/api/bookings/:id/complete', ({ params, user, now }) => {
    const b = findBooking(params.id);
    if (b.userId !== user.id || b.status !== 'checked_in') throw badRequest('Only an active session can be ended.');
    b.status = 'completed';
    b.completedAt = Date.now();
    // Finishing early frees the remainder of the slot for the waitlist.
    if (b.date === now.date && now.hour < b.endHour - 0.5) {
      b.endHour = Math.max(b.startHour + 1, Math.ceil(now.hour));
      promoteWaitlist(store, now, b.equipmentId, b.date);
    }
    store.touch();
    return { booking: view(b, user, now) };
  });

  router.patch('/api/bookings/:id', ({ params, body, user, now }) => {
    const b = findBooking(params.id);
    if (b.userId !== user.id) throw forbidden();
    b.flexible = v.bool(body.flexible, 'flexible');
    store.touch();
    return { booking: view(b, user, now) };
  });

  router.post('/api/bookings/:id/reschedule', async ({ params, body, user, now }) => {
    const b = findBooking(params.id);
    if (b.userId !== user.id) throw forbidden('You can only move your own bookings.');
    if (!['pending', 'confirmed'].includes(b.status)) throw badRequest('This booking can no longer be moved.');
    const input = slotInput({ ...v.object(body), equipmentId: b.equipmentId, projectId: b.projectId ?? undefined });
    const check = validateBooking(store, user, input, now, { ignoreBookingId: b.id });
    if (check.errors.some((e) => e.code === 'CONFLICT')) {
      return new Reply({ error: 'That time is taken.', resolution: await resolutionResponse(user, input, now) }, { status: 409 });
    }
    if (check.errors.length) throw new HttpError(422, check.errors[0].message, { errors: check.errors });
    const old = { date: b.date, equipmentId: b.equipmentId };
    Object.assign(b, { date: input.date, startHour: input.startHour, endHour: input.endHour, status: check.needsApproval ? 'pending' : 'confirmed' });
    audit(store, user, 'booking.rescheduled', b.id, { from: old.date, to: b.date });
    promoteWaitlist(store, now, old.equipmentId, old.date);
    store.touch();
    return { booking: view(b, user, now) };
  });

  router.post('/api/bookings/:id/decision', { roles: ['faculty', 'admin'] }, ({ params, body, user, now }) => {
    const b = findBooking(params.id);
    const eq = store.get('equipment', b.equipmentId);
    if (!canDecide(user, eq, store.get('projects', b.projectId))) throw forbidden('You are not an approver for this booking.');
    if (b.status !== 'pending') throw badRequest('This booking is not awaiting approval.');
    const decision = v.oneOf(body.decision, 'decision', ['approve', 'reject']);
    const comment = v.string(body.comment, 'comment', { max: 240, optional: true });
    b.status = decision === 'approve' ? 'confirmed' : 'rejected';
    b.decidedBy = user.id;
    b.decisionComment = comment;
    notify(store, b.userId, {
      type: 'booking', title: decision === 'approve' ? 'Booking approved' : 'Booking declined',
      body: `${eq.name} on ${b.date}${comment ? `: ${comment}` : ''}`, link: '#/bookings',
    });
    audit(store, user, `booking.${decision}d`, b.id, { equipment: eq.name });
    if (decision === 'reject') promoteWaitlist(store, now, b.equipmentId, b.date);
    store.touch();
    return { booking: view(b, user, now) };
  });
}
