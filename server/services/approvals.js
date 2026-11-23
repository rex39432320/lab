// Which pending requests a given staff member may decide on.
import { canDecide } from './bookings.js';

const decidable = (store, user, equipmentId, projectId) => {
  const equipment = store.get('equipment', equipmentId);
  return Boolean(equipment) && canDecide(user, equipment, store.get('projects', projectId));
};

/** Pending project-access requests this user is an approver for. */
export function pendingAccessRequests(store, user) {
  return store.data.accessRequests.filter(
    (r) => r.status === 'pending' && decidable(store, user, r.equipmentId, r.projectId),
  );
}

/** Pending (long-duration) bookings this user is an approver for. */
export function pendingBookings(store, user) {
  return store.data.bookings.filter(
    (b) => b.status === 'pending' && decidable(store, user, b.equipmentId, b.projectId),
  );
}

/** Total items awaiting this user's decision (always 0 for students). */
export function pendingApprovalCount(store, user) {
  if (user.role === 'student') return 0;
  return pendingAccessRequests(store, user).length + pendingBookings(store, user).length;
}
