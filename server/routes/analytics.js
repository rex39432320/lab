import { bookingView, projectView } from '../serializers.js';
import { overview } from '../services/analytics.js';
import { quotaFor, weekHours, isMember } from '../services/scheduling.js';

export function registerAnalytics(router, { store }) {
  router.get('/api/analytics/overview', { roles: ['faculty', 'admin'] }, ({ now }) => overview(store, now));

  // Personalised dashboard payload for any signed-in user.
  router.get('/api/dashboard', ({ user, now }) => {
    const upcoming = store.data.bookings
      .filter((b) => b.userId === user.id && ['confirmed', 'pending', 'checked_in'].includes(b.status) && (b.date > now.date || (b.date === now.date && b.endHour > now.hour)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);
    const projects = store.data.projects.filter((p) => user.role === 'admin' || isMember(p, user.id) || p.guideId === user.id).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const quota = user.role === 'student' ? quotaFor(user, projects[0], now) : null;
    const pendingApprovals = user.role === 'student' ? 0
      : store.data.accessRequests.filter((r) => r.status === 'pending' && (user.role === 'admin' || store.get('equipment', r.equipmentId)?.custodianId === user.id || store.get('projects', r.projectId)?.guideId === user.id)).length
        + store.data.bookings.filter((b) => b.status === 'pending' && (user.role === 'admin' || store.get('equipment', b.equipmentId)?.custodianId === user.id || store.get('projects', b.projectId)?.guideId === user.id)).length;
    return {
      weekHours: weekHours(store, user.id, now.date),
      quota,
      upcoming: upcoming.slice(0, 6).map((b) => bookingView(store, b, user, now)),
      projects: projects.slice(0, 4).map((p) => projectView(store, p, now)),
      pendingApprovals,
      waitlist: store.data.waitlist.filter((w) => w.userId === user.id && w.status === 'waiting').length,
      incomingSwaps: store.data.swaps.filter((s) => s.holderId === user.id && s.status === 'proposed').length,
      pendingAccess: store.data.accessRequests.filter((r) => r.status === 'pending' && projects.some((p) => p.id === r.projectId) && user.role === 'student').length,
      karma: user.karma ?? 0,
    };
  });
}
