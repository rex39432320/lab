// Core scheduling rules: slot arithmetic, availability and booking validation.
import { addDays, diffDays, dayOfWeek, weekStart } from '../lib/time.js';

/** Statuses that occupy an equipment slot. */
export const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'checked_in', 'completed']);
export const BOOKING_WINDOW_DAYS = 21;
export const DEFAULT_QUOTA_HOURS = 12;
export const DEADLINE_BOOST_DAYS = 3;

export const isActive = (b) => ACTIVE_STATUSES.has(b.status);
export const hoursOf = (b) => b.endHour - b.startHour;
export const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;
export const isMember = (project, userId) => project.ownerId === userId || project.memberIds.includes(userId);

export function bookingsFor(store, equipmentId, date) {
  return store.data.bookings.filter((b) => b.equipmentId === equipmentId && b.date === date && isActive(b));
}

export function findConflicts(store, equipmentId, date, startHour, endHour, ignoreId) {
  return bookingsFor(store, equipmentId, date).filter(
    (b) => b.id !== ignoreId && overlaps(b.startHour, b.endHour, startHour, endHour),
  );
}

export const isOpenDay = (eq, date) => (eq.openDays ?? [1, 2, 3, 4, 5, 6]).includes(dayOfWeek(date));
export const isPastSlot = (now, date, startHour) => date < now.date || (date === now.date && startHour < now.hour);

/** Contiguous bookable [start, end) windows for one equipment on one date. */
export function freeWindows(store, eq, date, now, ignoreId) {
  if (eq.status !== 'available' || !isOpenDay(eq, date)) return [];
  const taken = bookingsFor(store, eq.id, date).filter((b) => b.id !== ignoreId);
  const windows = [];
  let start = null;
  for (let h = eq.openHour; h < eq.closeHour; h++) {
    const free = !isPastSlot(now, date, h) && !taken.some((b) => overlaps(b.startHour, b.endHour, h, h + 1));
    if (free && start === null) start = h;
    if (!free && start !== null) {
      windows.push([start, h]);
      start = null;
    }
  }
  if (start !== null) windows.push([start, eq.closeHour]);
  return windows;
}

/** Earliest window of `hours` length within `maxDays`, or null. */
export function nextFree(store, eq, now, hours = 1, maxDays = 14) {
  for (let i = 0; i <= maxDays; i++) {
    const date = addDays(now.date, i);
    const window = freeWindows(store, eq, date, now).find(([a, b]) => b - a >= hours);
    if (window) return { date, startHour: window[0], endHour: window[0] + hours };
  }
  return null;
}

/** Per-hour slot states for the calendar UI. */
export function daySlots(store, eq, date, now, viewer) {
  const open = isOpenDay(eq, date);
  const privileged = viewer.role !== 'student';
  const slots = [];
  for (let hour = eq.openHour; hour < eq.closeHour; hour++) {
    const slot = { hour, state: 'free' };
    if (eq.status !== 'available') slot.state = 'maintenance';
    else if (!open) slot.state = 'closed';
    else if (isPastSlot(now, date, hour)) slot.state = 'past';
    const booking = bookingsFor(store, eq.id, date).find((b) => overlaps(b.startHour, b.endHour, hour, hour + 1));
    if (booking) {
      const mine = booking.userId === viewer.id;
      slot.state = slot.state === 'past' ? 'past-booked' : 'booked';
      slot.booking = {
        id: mine || privileged ? booking.id : undefined,
        mine,
        status: booking.status,
        flexible: booking.flexible,
        startHour: booking.startHour,
        endHour: booking.endHour,
      };
    }
    slots.push(slot);
  }
  return slots;
}

export function weekHours(store, userId, date, ignoreId) {
  const ws = weekStart(date);
  return store.data.bookings
    .filter((b) => b.userId === userId && b.id !== ignoreId && isActive(b) && weekStart(b.date) === ws)
    .reduce((sum, b) => sum + hoursOf(b), 0);
}

/** Weekly hour allowance; students on a project due within 3 days get a 50% boost. */
export function quotaFor(user, project, now) {
  const base = user.weeklyQuota ?? DEFAULT_QUOTA_HOURS;
  const daysLeft = project ? diffDays(project.deadline, now.date) : Infinity;
  const boosted = daysLeft >= 0 && daysLeft <= DEADLINE_BOOST_DAYS;
  return { base, limit: boosted ? Math.round(base * 1.5) : base, boosted };
}

/** Project-based access check for restricted equipment. */
export function accessFor(store, user, eq, projectId, date) {
  if (!eq.requiresApproval || user.role !== 'student') return { required: false, ok: true };
  const grant = store.data.accessRequests.find(
    (r) =>
      r.status === 'approved' &&
      r.equipmentId === eq.id &&
      r.validUntil >= date &&
      (projectId ? r.projectId === projectId : false) &&
      isMember(store.get('projects', r.projectId) ?? { ownerId: '', memberIds: [] }, user.id),
  );
  return { required: true, ok: Boolean(grant), grant };
}

/**
 * Validate a prospective booking. Never throws: returns blocking `errors`
 * (CONFLICT is reported separately so callers can offer smart alternatives).
 */
export function validateBooking(store, user, input, now, { ignoreBookingId, skipConflict = false } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (code, message) => errors.push({ code, message });
  const eq = store.get('equipment', input.equipmentId);
  if (!eq) return { errors: [{ code: 'EQUIPMENT_NOT_FOUND', message: 'That equipment does not exist.' }], warnings, conflicts: [] };

  const { date, startHour, endHour } = input;
  const hours = endHour - startHour;
  let project = null;
  if (input.projectId) {
    project = store.get('projects', input.projectId);
    if (!project || (user.role === 'student' && !isMember(project, user.id))) {
      fail('PROJECT_INVALID', 'Choose one of your own projects.');
      project = null;
    }
  }

  if (eq.status !== 'available') fail('MAINTENANCE', `${eq.name} is currently ${eq.status} and cannot be booked.`);
  else if (!isOpenDay(eq, date)) fail('CLOSED', `${eq.name} is not available on this day.`);
  else if (startHour < eq.openHour || endHour > eq.closeHour) {
    fail('CLOSED', `${eq.name} can be booked between ${eq.openHour}:00 and ${eq.closeHour}:00 only.`);
  }
  if (isPastSlot(now, date, startHour)) fail('PAST', 'That time has already started or passed.');
  if (diffDays(date, now.date) > BOOKING_WINDOW_DAYS) fail('TOO_FAR', `You can book at most ${BOOKING_WINDOW_DAYS} days ahead.`);
  if (hours > eq.maxHoursPerBooking) fail('TOO_LONG', `A single booking on this equipment is limited to ${eq.maxHoursPerBooking} hours.`);

  const access = accessFor(store, user, eq, input.projectId, date);
  if (!access.ok) {
    fail('NO_ACCESS', input.projectId
      ? 'This equipment needs faculty-approved access for your project. Request access first.'
      : 'This equipment needs a project with faculty-approved access. Select a project.');
  }

  if (user.role === 'student') {
    const quota = quotaFor(user, project, now);
    const used = weekHours(store, user.id, date, ignoreBookingId);
    if (used + hours > quota.limit) {
      fail('QUOTA', `Weekly fair-use limit reached: ${used}/${quota.limit} h used this week, this booking adds ${hours} h.`);
    }
  }

  const overlapping = store.data.bookings.find(
    (b) => b.userId === user.id && b.id !== ignoreBookingId && b.date === date && isActive(b) && overlaps(b.startHour, b.endHour, startHour, endHour),
  );
  if (overlapping) fail('SELF_OVERLAP', 'You already have another booking at this time.');

  const conflicts = skipConflict ? [] : findConflicts(store, eq.id, date, startHour, endHour, ignoreBookingId);
  if (conflicts.length) fail('CONFLICT', 'Part of that window is already booked.');
  if (project && date > project.deadline) warnings.push(`This is after your project deadline (${project.deadline}).`);

  const needsApproval = user.role === 'student' && hours > eq.autoApproveHours;
  if (needsApproval) warnings.push(`Bookings over ${eq.autoApproveHours} h need approval from your guide.`);
  return { equipment: eq, project, hours, errors, warnings, conflicts, needsApproval };
}
