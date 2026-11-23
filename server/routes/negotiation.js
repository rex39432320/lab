// Waitlist and fair-share swap negotiation between students.
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { created } from '../lib/router.js';
import { hourLabel, prettyDate } from '../lib/time.js';
import { slotInput, v } from '../lib/validate.js';
import { audit, notify } from '../services/activity.js';
import { createBooking } from '../services/bookings.js';
import { buildResolution } from '../services/resolver.js';
import { findConflicts, overlaps, validateBooking } from '../services/scheduling.js';

const SWAP_TTL_MS = 24 * 3_600_000;
const slotText = (s) => `${prettyDate(s.date)}, ${hourLabel(s.startHour)}–${hourLabel(s.endHour)}`;

export function registerNegotiation(router, { store }) {
  const waitlistView = (w) => ({
    id: w.id,
    equipmentId: w.equipmentId,
    equipmentName: store.get('equipment', w.equipmentId)?.name,
    projectId: w.projectId,
    date: w.date,
    startHour: w.startHour,
    endHour: w.endHour,
    status: w.status,
    createdAt: w.createdAt,
  });

  function addToWaitlist(user, input) {
    const duplicate = store.data.waitlist.some(
      (w) =>
        w.status === 'waiting' &&
        w.userId === user.id &&
        w.equipmentId === input.equipmentId &&
        w.date === input.date &&
        overlaps(w.startHour, w.endHour, input.startHour, input.endHour),
    );
    if (duplicate) throw conflict('You are already on the waitlist for that time.');
    const entry = store.insert('waitlist', {
      id: store.nextId('w'),
      userId: user.id,
      ...input,
      status: 'waiting',
      createdAt: Date.now(),
    });
    audit(store, user, 'waitlist.joined', entry.id, {
      equipment: store.get('equipment', input.equipmentId)?.name,
    });
    return entry;
  }

  router.get('/api/waitlist', ({ user }) => ({
    items: store.data.waitlist
      .filter((w) => w.userId === user.id && w.status === 'waiting')
      .map(waitlistView),
  }));

  router.post('/api/waitlist', ({ body, user, now }) => {
    const input = slotInput(v.object(body));
    const check = validateBooking(store, user, input, now, { skipConflict: true });
    if (check.errors.length) throw new HttpError(422, check.errors[0].message, { errors: check.errors });
    if (!findConflicts(store, input.equipmentId, input.date, input.startHour, input.endHour).length) {
      throw badRequest('That slot is free right now. Book it directly.');
    }
    return created({ item: waitlistView(addToWaitlist(user, input)) });
  });

  router.delete('/api/waitlist/:id', ({ params, user }) => {
    const w = store.get('waitlist', params.id);
    if (!w) throw notFound('Waitlist entry not found.');
    if (w.userId !== user.id) throw forbidden();
    store.remove('waitlist', w.id);
    return { ok: true };
  });

  const swapView = (s, user) => {
    const held = store.get('bookings', s.targetBookingId);
    const eq = store.get('equipment', held?.equipmentId);
    return {
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      expiresAt: s.createdAt + SWAP_TTL_MS,
      direction: s.holderId === user.id ? 'incoming' : 'outgoing',
      equipmentName: eq?.name,
      requesterName: store.get('users', s.requesterId)?.name,
      reason: s.reason,
      requesterPriority: s.requesterScore,
      holderPriority: s.holderScore,
      yourCurrent: held && { date: held.date, startHour: held.startHour, endHour: held.endHour },
      proposedMove: s.holderAlt,
      requested: s.request,
    };
  };

  router.get('/api/swaps', ({ user }) => ({
    items: store.data.swaps
      .filter((s) => (s.holderId === user.id || s.requesterId === user.id) && s.status === 'proposed')
      .map((s) => swapView(s, user)),
  }));

  router.post('/api/swaps', ({ body, user, now }) => {
    const data = v.object(body);
    const targetBookingId = v.id(data.targetBookingId, 'targetBookingId');
    const input = slotInput(v.object(data.request, 'request'));
    const resolution = buildResolution(store, user, input, now);
    const option = resolution.options.find(
      (o) => o.action.kind === 'swap' && o.action.targetBookingId === targetBookingId,
    );
    if (!option) throw conflict('A swap is no longer possible for that booking. Try the other options.');
    const held = store.get('bookings', targetBookingId);
    if (store.data.swaps.some((s) => s.status === 'proposed' && s.targetBookingId === targetBookingId))
      throw conflict('A swap request for that booking is already pending.');

    const swap = store.insert('swaps', {
      id: store.nextId('s'),
      requesterId: user.id,
      holderId: held.userId,
      targetBookingId,
      request: input,
      holderAlt: option.action.holderAlt,
      status: 'proposed',
      createdAt: Date.now(),
      requesterScore: resolution.requester.score,
      holderScore: option.action.holderScore,
      reason: v.string(data.message, 'message', { max: 200, optional: true }) ?? '',
    });
    notify(store, held.userId, {
      type: 'swap',
      title: 'A teammate asks to swap a slot',
      body: `A project with a closer deadline needs ${store.get('equipment', held.equipmentId).name} on ${slotText(held)}. You would move to ${slotText(swap.holderAlt)} and earn goodwill credit.`,
      link: '#/approvals',
    });
    audit(store, user, 'swap.proposed', swap.id);
    return created({ swap: swapView(swap, user) });
  });

  router.post('/api/swaps/:id/respond', ({ params, body, user, now }) => {
    const swap = store.get('swaps', params.id);
    if (!swap) throw notFound('Swap request not found.');
    if (swap.holderId !== user.id) throw forbidden('Only the slot holder can respond.');
    if (swap.status !== 'proposed') throw conflict('This swap was already handled.');
    const accept = v.bool(body.accept, 'accept');
    const requester = store.get('users', swap.requesterId);
    const held = store.get('bookings', swap.targetBookingId);
    const eq = store.get('equipment', held.equipmentId);

    if (Date.now() > swap.createdAt + SWAP_TTL_MS) {
      swap.status = 'expired';
      store.touch();
      throw new HttpError(410, 'This swap request has expired.');
    }

    if (!accept) {
      swap.status = 'declined';
      notify(store, requester.id, {
        type: 'swap',
        title: 'Swap declined',
        body: `The holder kept ${eq.name} on ${slotText(held)}. You can join the waitlist instead.`,
        link: `#/equipment/${eq.id}`,
      });
      try {
        addToWaitlist(requester, swap.request);
      } catch {
        /* already waiting or no longer valid */
      }
      store.touch();
      return { swap: swapView(swap, user) };
    }

    // Accept: move the holder first, then book the requester; roll back on failure.
    const before = { date: held.date, startHour: held.startHour, endHour: held.endHour };
    const alt = swap.holderAlt;
    const holderCheck = validateBooking(
      store,
      user,
      { equipmentId: held.equipmentId, projectId: held.projectId ?? undefined, ...alt },
      now,
      { ignoreBookingId: held.id },
    );
    if (holderCheck.errors.length)
      throw conflict('The proposed new slot is no longer free. Ask the requester to try again.');
    Object.assign(held, alt, { bumpCount: (held.bumpCount ?? 0) + 1 });
    try {
      createBooking(store, requester, swap.request, now);
    } catch (err) {
      Object.assign(held, before, { bumpCount: held.bumpCount - 1 });
      throw conflict(`The swap could not be completed: ${err.message}`);
    }
    user.karma = (user.karma ?? 0) + 1;
    swap.status = 'accepted';
    audit(store, user, 'conflict.resolved', swap.id, { via: 'swap' });
    notify(store, requester.id, {
      type: 'swap',
      title: 'Swap accepted',
      body: `You now have ${eq.name} on ${slotText(swap.request)}.`,
      link: '#/bookings',
    });
    store.touch();
    return { swap: swapView(swap, user), karma: user.karma };
  });
}
