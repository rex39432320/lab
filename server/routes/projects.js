import { CATEGORIES, PROJECT_KINDS } from '../constants.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { created } from '../lib/router.js';
import { addDays } from '../lib/time.js';
import { v } from '../lib/validate.js';
import { accessView, bookingView, equipmentSummary, projectView } from '../serializers.js';
import { audit, notify } from '../services/activity.js';
import { pendingAccessRequests, pendingBookings } from '../services/approvals.js';
import { approversFor, canDecide } from '../services/bookings.js';
import { priorityFor } from '../services/priority.js';
import { hoursOf, isActive, isMember } from '../services/scheduling.js';
import { searchEquipment } from '../services/search.js';

export function registerProjects(router, { store, ai }) {
  const findProject = (id) => {
    const p = store.get('projects', id);
    if (!p) throw notFound('Project not found.');
    return p;
  };
  const canManage = (user, p) => user.role === 'admin' || p.ownerId === user.id || p.guideId === user.id;
  const canSee = (user, p) => user.role === 'admin' || isMember(p, user.id) || p.guideId === user.id;

  router.get('/api/projects', ({ user, now }) => ({
    items: store.data.projects
      .filter((p) => canSee(user, p))
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .map((p) => projectView(store, p, now)),
  }));

  router.post('/api/projects', ({ body, user, now }) => {
    const data = v.object(body);
    const guideId = v.id(data.guideId, 'guideId');
    const guide = store.get('users', guideId);
    if (!guide || guide.role === 'student') throw badRequest('guideId: choose a faculty guide');
    const deadline = v.date(data.deadline, 'deadline');
    if (deadline < now.date) throw badRequest('deadline: must not be in the past');
    const project = store.insert('projects', {
      id: store.nextId('p'),
      title: v.string(data.title, 'title', { min: 3, max: 90 }),
      description: v.string(data.description, 'description', { min: 10, max: 600 }),
      ownerId: user.id,
      memberIds: [],
      guideId,
      department: user.department,
      deadline,
      kind: v.oneOf(data.kind ?? 'course', 'kind', PROJECT_KINDS),
      plannedHours: v.int(data.plannedHours ?? 10, 'plannedHours', { min: 1, max: 500 }),
      status: 'active',
      createdAt: Date.now(),
    });
    audit(store, user, 'project.created', project.id, { title: project.title });
    return created({ project: projectView(store, project, now) });
  });

  router.patch('/api/projects/:id', ({ params, body, user, now }) => {
    const p = findProject(params.id);
    if (!canManage(user, p)) throw forbidden('Only the project owner or guide can edit this project.');
    const data = v.object(body);
    const changes = {
      title: v.string(data.title, 'title', { min: 3, max: 90, optional: true }),
      description: v.string(data.description, 'description', { min: 10, max: 600, optional: true }),
      deadline: v.date(data.deadline, 'deadline', { optional: true }),
      kind: v.oneOf(data.kind, 'kind', PROJECT_KINDS, { optional: true }),
      plannedHours: v.int(data.plannedHours, 'plannedHours', { min: 1, max: 500, optional: true }),
      status: v.oneOf(data.status, 'status', ['active', 'completed'], { optional: true }),
    };
    Object.assign(p, Object.fromEntries(Object.entries(changes).filter(([, x]) => x !== undefined)));
    store.touch();
    return { project: projectView(store, p, now) };
  });

  router.post('/api/projects/:id/members', ({ params, body, user, now }) => {
    const p = findProject(params.id);
    if (!(user.role === 'admin' || p.ownerId === user.id))
      throw forbidden('Only the project owner can add members.');
    const member = store.data.users.find((u) => u.email === v.email(body.email));
    if (!member || member.role !== 'student') throw notFound('No student account with that email.');
    if (isMember(p, member.id)) throw conflict('That student is already on the project.');
    if (p.memberIds.length >= 5) throw badRequest('A project can have at most 6 people.');
    p.memberIds.push(member.id);
    notify(store, member.id, {
      type: 'project',
      title: 'Added to a project',
      body: `${user.name} added you to “${p.title}”.`,
      link: '#/projects',
    });
    store.touch();
    return { project: projectView(store, p, now) };
  });

  router.delete('/api/projects/:id/members/:userId', ({ params, user, now }) => {
    const p = findProject(params.id);
    if (!(user.role === 'admin' || p.ownerId === user.id || params.userId === user.id)) throw forbidden();
    p.memberIds = p.memberIds.filter((id) => id !== params.userId);
    store.touch();
    return { project: projectView(store, p, now) };
  });

  // AI-assisted equipment recommendations from a project's description.
  router.post('/api/projects/:id/recommend', async ({ params, user, now }) => {
    const p = findProject(params.id);
    if (!canSee(user, p)) throw forbidden();
    const text = `${p.title}. ${p.description}`;
    const interpreted = await ai.interpretQuery(text, CATEGORIES);
    const results = searchEquipment(store.data.equipment, text, {
      extraKeywords: interpreted?.keywords ?? [],
      limit: 8,
    });
    return {
      aiUsed: Boolean(interpreted),
      items: results.map((r) => ({
        ...equipmentSummary(store, r.equipment, now, user),
        matched: r.matched,
        score: r.score,
      })),
    };
  });

  // ---- Access requests (project-based, faculty approved) ----
  router.get('/api/access-requests', ({ user }) => ({
    items: store.data.accessRequests
      .filter((r) => {
        const p = store.get('projects', r.projectId);
        const eq = store.get('equipment', r.equipmentId);
        return (
          user.role === 'admin' ||
          (p && isMember(p, user.id)) ||
          p?.guideId === user.id ||
          eq?.custodianId === user.id
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => accessView(store, r)),
  }));

  router.post('/api/access-requests', ({ body, user }) => {
    const data = v.object(body);
    const project = findProject(v.id(data.projectId, 'projectId'));
    const eq = store.get('equipment', v.id(data.equipmentId, 'equipmentId'));
    if (!eq) throw notFound('Equipment not found.');
    if (!isMember(project, user.id)) throw forbidden('You can only request access for your own projects.');
    if (!eq.requiresApproval) throw badRequest('This equipment does not need an access request.');
    if (
      store.data.accessRequests.some(
        (r) =>
          r.projectId === project.id && r.equipmentId === eq.id && ['pending', 'approved'].includes(r.status),
      )
    ) {
      throw conflict('This project already has a pending or approved request for that equipment.');
    }
    const request = store.insert('accessRequests', {
      id: store.nextId('ar'),
      projectId: project.id,
      equipmentId: eq.id,
      requesterId: user.id,
      justification: v.string(data.justification, 'justification', { min: 10, max: 400 }),
      hoursNeeded: v.int(data.hoursNeeded ?? 4, 'hoursNeeded', { min: 1, max: 200 }),
      status: 'pending',
      validUntil: addDays(project.deadline, 7),
      createdAt: Date.now(),
    });
    for (const approverId of approversFor(eq, project)) {
      notify(store, approverId, {
        type: 'approval',
        title: 'Access request awaiting you',
        body: `${user.name} requested ${eq.name} for “${project.title}”.`,
        link: '#/approvals',
      });
    }
    audit(store, user, 'access.requested', request.id, { equipment: eq.name, project: project.title });
    return created({ request: accessView(store, request) });
  });

  router.post(
    '/api/access-requests/:id/decision',
    { roles: ['faculty', 'admin'] },
    ({ params, body, user }) => {
      const r = store.get('accessRequests', params.id);
      if (!r) throw notFound('Request not found.');
      const eq = store.get('equipment', r.equipmentId);
      const project = store.get('projects', r.projectId);
      if (!canDecide(user, eq, project))
        throw forbidden('You are not an approver for this equipment or project.');
      if (r.status !== 'pending') throw conflict('This request was already decided.');
      const decision = v.oneOf(body.decision, 'decision', ['approve', 'reject']);
      r.status = decision === 'approve' ? 'approved' : 'rejected';
      r.comment = v.string(body.comment, 'comment', { max: 240, optional: true });
      r.decidedBy = user.id;
      r.decidedAt = Date.now();
      notify(store, r.requesterId, {
        type: 'access',
        title: decision === 'approve' ? 'Access approved' : 'Access request declined',
        body: `${eq.name} for “${project.title}”${r.comment ? `: ${r.comment}` : ''}`,
        link: decision === 'approve' ? `#/equipment/${eq.id}` : '#/projects',
      });
      audit(store, user, `access.${decision}d`, r.id, { equipment: eq.name, project: project.title });
      store.touch();
      return { request: accessView(store, r) };
    },
  );

  router.delete('/api/access-requests/:id', ({ params, user }) => {
    const r = store.get('accessRequests', params.id);
    if (!r) throw notFound('Request not found.');
    if (r.requesterId !== user.id && user.role !== 'admin') throw forbidden();
    if (r.status !== 'pending') throw badRequest('Only pending requests can be withdrawn.');
    store.remove('accessRequests', r.id);
    return { ok: true };
  });

  // ---- Faculty approval inbox ----
  router.get('/api/approvals', { roles: ['faculty', 'admin'] }, ({ user, now }) => {
    const requestView = (r) => {
      const eq = store.get('equipment', r.equipmentId);
      const project = store.get('projects', r.projectId);
      const requester = store.get('users', r.requesterId);
      return {
        ...accessView(store, r),
        projectKind: project?.kind,
        projectDescription: project?.description,
        requesterDepartment: requester?.department,
        requesterPriority: requester ? priorityFor(store, requester, project, now).score : 0,
        hoursUsedOnProject: store.data.bookings
          .filter((b) => b.projectId === r.projectId && b.equipmentId === eq?.id && isActive(b))
          .reduce((s, b) => s + hoursOf(b), 0),
      };
    };
    return {
      accessRequests: pendingAccessRequests(store, user).map(requestView),
      bookings: pendingBookings(store, user).map((b) => ({
        ...bookingView(store, b, user, now),
        requesterPriority: priorityFor(
          store,
          store.get('users', b.userId),
          store.get('projects', b.projectId),
          now,
        ).score,
      })),
      history: store.data.accessRequests
        .filter((r) => r.status !== 'pending' && r.decidedBy === user.id)
        .slice(-8)
        .reverse()
        .map((r) => accessView(store, r)),
    };
  });
}
