// Shape internal records into API responses (never leaking secrets).
import { addDays, diffDays } from './lib/time.js';
import { hoursOf, isActive, isMember, nextFree } from './services/scheduling.js';

export const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, title: u.title,
  weeklyQuota: u.weeklyQuota, karma: u.karma ?? 0, active: u.active !== false,
});

const nameOf = (store, id) => store.get('users', id)?.name ?? 'Unknown';

export function accessStatus(store, user, eq) {
  if (!eq.requiresApproval || user.role !== 'student') return 'open';
  const mine = store.data.accessRequests.filter((r) => r.equipmentId === eq.id && isMember(store.get('projects', r.projectId) ?? { ownerId: '', memberIds: [] }, user.id));
  if (mine.some((r) => r.status === 'approved')) return 'granted';
  if (mine.some((r) => r.status === 'pending')) return 'pending';
  return 'required';
}

function demandFor(store, eq, now) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(now.date, i));
  const capacity = dates.length * (eq.closeHour - eq.openHour);
  const booked = store.data.bookings
    .filter((b) => b.equipmentId === eq.id && dates.includes(b.date) && isActive(b))
    .reduce((sum, b) => sum + hoursOf(b), 0);
  return Math.min(100, Math.round((booked / capacity) * 100));
}

export function equipmentSummary(store, eq, now, user) {
  return {
    id: eq.id, name: eq.name, category: eq.category, department: eq.department, location: eq.location, icon: eq.icon,
    description: eq.description, tags: eq.tags, status: eq.status, requiresApproval: eq.requiresApproval,
    maxHoursPerBooking: eq.maxHoursPerBooking, autoApproveHours: eq.autoApproveHours,
    openHour: eq.openHour, closeHour: eq.closeHour, openDays: eq.openDays,
    custodian: nameOf(store, eq.custodianId), demand: demandFor(store, eq, now),
    nextFree: nextFree(store, eq, now), access: accessStatus(store, user, eq),
  };
}

export function equipmentDetail(store, eq, now, user, similarList) {
  const mine = store.data.projects.filter((p) => isMember(p, user.id));
  const granted = mine.filter((p) => store.data.accessRequests.some((r) => r.status === 'approved' && r.equipmentId === eq.id && r.projectId === p.id));
  const bookableProjects = user.role !== 'student' ? store.data.projects.filter((p) => p.guideId === user.id) : eq.requiresApproval ? granted : mine;
  return {
    ...equipmentSummary(store, eq, now, user),
    specs: eq.specs,
    custodianId: eq.custodianId,
    bookableProjects: bookableProjects.map((p) => ({ id: p.id, title: p.title, deadline: p.deadline })),
    projectsNeedingAccess: eq.requiresApproval && user.role === 'student'
      ? mine.filter((p) => !granted.includes(p)).map((p) => ({
        id: p.id, title: p.title,
        pending: store.data.accessRequests.some((r) => r.status === 'pending' && r.equipmentId === eq.id && r.projectId === p.id),
      }))
      : [],
    similar: similarList,
    bookingsLast30: store.data.bookings.filter((b) => b.equipmentId === eq.id && isActive(b) && Math.abs(diffDays(b.date, now.date)) <= 30).length,
  };
}

export function bookingView(store, b, viewer, now) {
  const eq = store.get('equipment', b.equipmentId);
  const project = b.projectId ? store.get('projects', b.projectId) : null;
  const mine = b.userId === viewer.id;
  const privileged = viewer.role !== 'student';
  const canSee = mine || privileged;
  return {
    id: b.id, equipmentId: b.equipmentId, equipmentName: eq?.name ?? 'Removed equipment', equipmentIcon: eq?.icon, location: eq?.location,
    userId: canSee ? b.userId : undefined, userName: canSee ? nameOf(store, b.userId) : undefined,
    projectId: canSee ? b.projectId : undefined, projectTitle: canSee ? project?.title : undefined,
    date: b.date, startHour: b.startHour, endHour: b.endHour, hours: hoursOf(b), status: b.status,
    flexible: b.flexible, purpose: canSee ? b.purpose : undefined, cancelReason: b.cancelReason,
    mine,
    canCheckIn: mine && b.status === 'confirmed' && b.date === now.date && now.hour >= b.startHour - 0.25 && now.hour < b.endHour,
    canComplete: mine && b.status === 'checked_in',
    canCancel: (mine || privileged) && ['pending', 'confirmed'].includes(b.status) && (b.date > now.date || (b.date === now.date && b.endHour > now.hour)),
  };
}

export function projectView(store, p, now) {
  const bookings = store.data.bookings.filter((b) => b.projectId === p.id && isActive(b));
  const done = bookings.filter((b) => b.status === 'completed').reduce((s, b) => s + hoursOf(b), 0);
  const planned = bookings.filter((b) => b.status !== 'completed').reduce((s, b) => s + hoursOf(b), 0);
  return {
    id: p.id, title: p.title, description: p.description, kind: p.kind, status: p.status, department: p.department,
    deadline: p.deadline, daysLeft: diffDays(p.deadline, now.date), plannedHours: p.plannedHours,
    hoursCompleted: done, hoursScheduled: planned,
    owner: { id: p.ownerId, name: nameOf(store, p.ownerId) },
    guide: { id: p.guideId, name: nameOf(store, p.guideId) },
    members: p.memberIds.map((id) => ({ id, name: nameOf(store, id) })),
    access: store.data.accessRequests.filter((r) => r.projectId === p.id).map((r) => accessView(store, r)),
  };
}

export function accessView(store, r) {
  const eq = store.get('equipment', r.equipmentId);
  const project = store.get('projects', r.projectId);
  return {
    id: r.id, projectId: r.projectId, projectTitle: project?.title, projectDeadline: project?.deadline,
    equipmentId: r.equipmentId, equipmentName: eq?.name, equipmentIcon: eq?.icon,
    requesterId: r.requesterId, requesterName: nameOf(store, r.requesterId),
    justification: r.justification, hoursNeeded: r.hoursNeeded, status: r.status, validUntil: r.validUntil,
    comment: r.comment, decidedBy: r.decidedBy ? nameOf(store, r.decidedBy) : undefined, createdAt: r.createdAt,
  };
}

export function similarEquipment(store, eq, now, user, similarity, limit = 4) {
  return store.data.equipment
    .filter((o) => o.id !== eq.id)
    .map((o) => ({ o, sim: similarity(eq, o) }))
    .filter((x) => x.sim >= 0.5)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit)
    .map(({ o, sim }) => ({ ...equipmentSummary(store, o, now, user), similarity: Math.round(sim * 100) }));
}
