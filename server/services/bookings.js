// Booking lifecycle: create, cancel, waitlist promotion, no-show release.
import { conflict, forbidden } from '../lib/errors.js';
import { hourLabel, prettyDate } from '../lib/time.js';
import { audit, notify } from './activity.js';
import { priorityFor } from './priority.js';
import { findConflicts, hoursOf, validateBooking } from './scheduling.js';

export const NO_SHOW_GRACE_HOURS = 0.5;
const slotText = (b) => `${prettyDate(b.date)}, ${hourLabel(b.startHour)}–${hourLabel(b.endHour)}`;

/** Who may approve a booking or access request for this equipment/project. */
export function approversFor(equipment, project) {
  return [...new Set([equipment.custodianId, project?.guideId].filter(Boolean))];
}

export function canDecide(user, equipment, project) {
  return user.role === 'admin' || approversFor(equipment, project).includes(user.id);
}

export function createBooking(store, user, input, now, { flexible = false, viaWaitlist = false } = {}) {
  const check = validateBooking(store, user, input, now);
  if (check.errors.length) {
    const first = check.errors[0];
    throw conflict(first.message, { code: first.code, errors: check.errors });
  }
  const booking = {
    id: store.nextId('b'),
    equipmentId: input.equipmentId,
    userId: user.id,
    projectId: input.projectId ?? null,
    date: input.date,
    startHour: input.startHour,
    endHour: input.endHour,
    purpose: input.purpose ?? '',
    status: check.needsApproval ? 'pending' : 'confirmed',
    flexible,
    bumpCount: 0,
    priority: priorityFor(store, user, check.project, now).score,
    createdAt: Date.now(),
  };
  store.insert('bookings', booking);
  audit(store, user, viaWaitlist ? 'booking.promoted' : 'booking.created', booking.id, {
    equipment: check.equipment.name, slot: slotText(booking), status: booking.status,
  });
  if (booking.status === 'pending') {
    for (const approverId of approversFor(check.equipment, check.project)) {
      if (approverId === user.id) continue;
      notify(store, approverId, {
        type: 'approval',
        title: 'Booking needs approval',
        body: `${user.name} requested ${check.equipment.name} for ${hoursOf(booking)} h on ${slotText(booking)}.`,
        link: '#/approvals',
      });
    }
  }
  return { booking, equipment: check.equipment };
}

export function cancelBooking(store, actor, booking, now, reason = 'Cancelled by user') {
  const equipment = store.get('equipment', booking.equipmentId);
  booking.status = 'cancelled';
  booking.cancelReason = reason;
  audit(store, actor, 'booking.cancelled', booking.id, { equipment: equipment?.name, slot: slotText(booking), reason });
  store.touch();
  return promoteWaitlist(store, now, booking.equipmentId, booking.date);
}

/** Offer freed capacity to waiting requests, highest priority first. */
export function promoteWaitlist(store, now, equipmentId, date) {
  const promoted = [];
  const candidates = store.data.waitlist
    .filter((w) => w.status === 'waiting' && w.equipmentId === equipmentId && w.date === date)
    .map((w) => ({ w, user: store.get('users', w.userId) }))
    .filter((c) => c.user)
    .map((c) => ({ ...c, score: priorityFor(store, c.user, store.get('projects', c.w.projectId), now).score }))
    .sort((a, b) => b.score - a.score || a.w.createdAt - b.w.createdAt);

  for (const { w, user } of candidates) {
    if (findConflicts(store, equipmentId, date, w.startHour, w.endHour).length) continue;
    try {
      const { booking, equipment } = createBooking(store, user, w, now, { viaWaitlist: true });
      w.status = 'promoted';
      w.bookingId = booking.id;
      notify(store, user.id, {
        type: 'waitlist',
        title: 'A slot opened up for you',
        body: `${equipment.name} on ${slotText(booking)} was booked automatically from your waitlist.`,
        link: '#/bookings',
      });
      promoted.push(booking);
    } catch {
      // The request no longer validates (quota, access…); leave it waiting.
    }
  }
  store.touch();
  return promoted;
}

export function assertCanCancel(user, booking) {
  if (booking.userId !== user.id && user.role === 'student') throw forbidden('You can only cancel your own bookings.');
}

/**
 * Lifecycle sweep. Releases slots whose holder has not checked in within the
 * grace period (and notifies the waitlist), and closes out finished sessions.
 */
export function sweep(store, now) {
  let changed = false;
  for (const b of store.data.bookings) {
    const ended = b.date < now.date || (b.date === now.date && b.endHour <= now.hour);
    if (b.status === 'pending' && (b.date < now.date || (b.date === now.date && b.startHour <= now.hour))) {
      b.status = 'expired';
      changed = true;
      notify(store, b.userId, { type: 'booking', title: 'Booking request expired', body: `Nobody approved your request for ${slotText(b)} in time.`, link: '#/bookings' });
    } else if (b.status === 'checked_in' && ended) {
      b.status = 'completed';
      changed = true;
    } else if (b.status === 'confirmed') {
      const missed = b.date < now.date || (b.date === now.date && now.hour >= b.startHour + NO_SHOW_GRACE_HOURS);
      if (!missed) continue;
      b.status = 'no_show';
      b.cancelReason = 'Not checked in';
      changed = true;
      notify(store, b.userId, { type: 'booking', title: 'Slot released (no check-in)', body: `${slotText(b)} was released because you did not check in.`, link: '#/bookings' });
      if (!ended) promoteWaitlist(store, now, b.equipmentId, b.date);
    }
  }
  if (changed) store.touch();
  return changed;
}
