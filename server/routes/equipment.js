import { CATEGORIES, DEPARTMENTS, EQUIPMENT_STATUSES, ICONS } from '../constants.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { created } from '../lib/router.js';
import { addDays, dayOfWeek } from '../lib/time.js';
import { v } from '../lib/validate.js';
import { equipmentDetail, equipmentSummary, similarEquipment } from '../serializers.js';
import { audit, notify } from '../services/activity.js';
import { cancelBooking } from '../services/bookings.js';
import { similarity } from '../services/resolver.js';
import { daySlots, isActive } from '../services/scheduling.js';
import { searchEquipment } from '../services/search.js';

function parseSpec(body, { partial = false } = {}) {
  const opt = partial ? { optional: true } : {};
  const spec = {
    name: v.string(body.name, 'name', { min: 2, max: 80, ...opt }),
    category: v.oneOf(body.category, 'category', CATEGORIES, opt),
    department: v.oneOf(body.department, 'department', Object.keys(DEPARTMENTS), opt),
    location: v.string(body.location, 'location', { min: 2, max: 80, ...opt }),
    icon: v.oneOf(body.icon ?? (partial ? undefined : 'chip'), 'icon', ICONS, { optional: true }),
    description: v.string(body.description, 'description', { min: 10, max: 500, ...opt }),
    specs: v.array(body.specs, 'specs', { max: 8, optional: true, each: (s, f) => v.string(s, f, { max: 80 }) }),
    tags: v.array(body.tags, 'tags', { max: 12, optional: true, each: (s, f) => v.string(s, f, { max: 30 }).toLowerCase() }),
    requiresApproval: v.bool(body.requiresApproval, 'requiresApproval', { optional: true }),
    maxHoursPerBooking: v.int(body.maxHoursPerBooking, 'maxHoursPerBooking', { min: 1, max: 12, optional: true }),
    autoApproveHours: v.int(body.autoApproveHours, 'autoApproveHours', { min: 1, max: 12, optional: true }),
    openHour: v.int(body.openHour, 'openHour', { min: 0, max: 23, optional: true }),
    closeHour: v.int(body.closeHour, 'closeHour', { min: 1, max: 24, optional: true }),
    status: v.oneOf(body.status, 'status', EQUIPMENT_STATUSES, { optional: true }),
  };
  return Object.fromEntries(Object.entries(spec).filter(([, value]) => value !== undefined));
}

export function registerEquipment(router, { store, ai }) {
  const find = (id) => {
    const eq = store.get('equipment', id);
    if (!eq) throw notFound('Equipment not found.');
    return eq;
  };

  router.get('/api/equipment', async ({ query, user, now }) => {
    const filters = {
      category: v.oneOf(query.category, 'category', CATEGORIES, { optional: true }),
      department: v.oneOf(query.department, 'department', Object.keys(DEPARTMENTS), { optional: true }),
      status: v.oneOf(query.status, 'status', EQUIPMENT_STATUSES, { optional: true }),
    };
    let items = store.data.equipment.filter((e) =>
      (!filters.category || e.category === filters.category) &&
      (!filters.department || e.department === filters.department) &&
      (!filters.status || e.status === filters.status) &&
      (query.approval !== 'true' || e.requiresApproval));

    const q = v.string(query.q, 'q', { max: 300, optional: true });
    const info = { q: q ?? '', aiUsed: false, keywords: [] };
    const matchedBy = new Map();
    if (q) {
      const interpreted = await ai.interpretQuery(q, CATEGORIES);
      info.aiUsed = Boolean(interpreted);
      info.keywords = interpreted?.keywords ?? [];
      const results = searchEquipment(items, q, { extraKeywords: info.keywords });
      results.forEach((r) => matchedBy.set(r.equipment.id, { matched: r.matched, score: r.score }));
      items = results.map((r) => r.equipment);
    } else {
      items = [...items].sort((a, b) => a.name.localeCompare(b.name));
    }

    const rows = items.map((e) => ({ ...equipmentSummary(store, e, now, user), ...(matchedBy.get(e.id) ?? {}) }));
    if (query.sort === 'demand') rows.sort((a, b) => b.demand - a.demand);
    else if (query.sort === 'soonest') rows.sort((a, b) => (a.nextFree?.date ?? '9').localeCompare(b.nextFree?.date ?? '9') || (a.nextFree?.startHour ?? 0) - (b.nextFree?.startHour ?? 0));
    if (query.available === 'true') return { items: rows.filter((r) => r.status === 'available' && r.nextFree), total: rows.length, query: info };
    return { items: rows, total: rows.length, query: info };
  });

  router.get('/api/equipment/:id', ({ params, user, now }) => {
    const eq = find(params.id);
    return { equipment: equipmentDetail(store, eq, now, user, similarEquipment(store, eq, now, user, similarity)) };
  });

  router.get('/api/equipment/:id/availability', ({ params, query, user, now }) => {
    const eq = find(params.id);
    const from = v.date(query.from, 'from', { optional: true }) ?? now.date;
    const days = v.int(query.days ?? 7, 'days', { min: 1, max: 14 });
    return {
      equipment: { id: eq.id, name: eq.name, openHour: eq.openHour, closeHour: eq.closeHour, status: eq.status, maxHoursPerBooking: eq.maxHoursPerBooking, autoApproveHours: eq.autoApproveHours },
      days: Array.from({ length: days }, (_, i) => {
        const date = addDays(from, i);
        return { date, dow: dayOfWeek(date), slots: daySlots(store, eq, date, now, user) };
      }),
    };
  });

  router.post('/api/equipment', { roles: ['admin'] }, ({ body, user }) => {
    const spec = parseSpec(v.object(body));
    if ((spec.closeHour ?? 18) <= (spec.openHour ?? 9)) throw badRequest('closeHour must be after openHour.');
    const eq = store.insert('equipment', {
      id: store.nextId('eq'), specs: [], tags: [], requiresApproval: false, maxHoursPerBooking: 4, autoApproveHours: 3,
      openHour: 9, closeHour: 18, openDays: [1, 2, 3, 4, 5, 6], status: 'available', popularity: 0.3,
      custodianId: store.data.users.find((u) => u.role === 'faculty' && u.department === spec.department)?.id ?? user.id, ...spec,
    });
    audit(store, user, 'equipment.created', eq.id, { name: eq.name });
    return created({ equipment: eq });
  });

  router.patch('/api/equipment/:id', { roles: ['admin', 'faculty'] }, ({ params, body, user, now }) => {
    const eq = find(params.id);
    if (user.role === 'faculty' && eq.custodianId !== user.id) throw forbidden('Only the equipment custodian can change it.');
    const changes = parseSpec(v.object(body), { partial: true });
    const wasAvailable = eq.status === 'available';
    Object.assign(eq, changes);
    if (eq.closeHour <= eq.openHour) throw badRequest('closeHour must be after openHour.');
    let cancelled = 0;
    if (wasAvailable && eq.status === 'maintenance') {
      for (const b of store.data.bookings.filter((x) => x.equipmentId === eq.id && isActive(x) && x.status !== 'completed' && (x.date > now.date || (x.date === now.date && x.endHour > now.hour)))) {
        cancelBooking(store, user, b, now, 'Equipment taken out of service');
        notify(store, b.userId, { type: 'booking', title: 'Booking cancelled: maintenance', body: `${eq.name} is out of service, so your ${b.date} booking was cancelled. Check suggested alternatives.`, link: `#/equipment/${eq.id}` });
        cancelled += 1;
      }
    }
    audit(store, user, 'equipment.updated', eq.id, { changes: Object.keys(changes), cancelled });
    store.touch();
    return { equipment: eq, cancelled };
  });

  router.delete('/api/equipment/:id', { roles: ['admin'] }, ({ params, user, now }) => {
    const eq = find(params.id);
    const upcoming = store.data.bookings.some((b) => b.equipmentId === eq.id && isActive(b) && b.date >= now.date && b.status !== 'completed');
    if (upcoming) throw forbidden('Cancel or move upcoming bookings before removing this equipment.');
    store.remove('equipment', eq.id);
    audit(store, user, 'equipment.deleted', eq.id, { name: eq.name });
    return { ok: true };
  });
}
