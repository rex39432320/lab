import { ROLES } from '../constants.js';
import { badRequest, notFound } from '../lib/errors.js';
import { v } from '../lib/validate.js';
import { publicUser } from '../serializers.js';
import { audit } from '../services/activity.js';

export function registerAdmin(router, { store }) {
  router.get('/api/admin/users', { roles: ['admin'] }, () => ({ items: store.data.users.map(publicUser) }));

  router.get('/api/faculty', () => ({
    items: store.data.users.filter((u) => u.role !== 'student' && u.active !== false).map((u) => ({ id: u.id, name: u.name, department: u.department, title: u.title })),
  }));

  router.patch('/api/admin/users/:id', { roles: ['admin'] }, ({ params, body, user }) => {
    const target = store.get('users', params.id);
    if (!target) throw notFound('User not found.');
    const data = v.object(body);
    const role = v.oneOf(data.role, 'role', ROLES, { optional: true });
    const weeklyQuota = v.int(data.weeklyQuota, 'weeklyQuota', { min: 1, max: 60, optional: true });
    const active = v.bool(data.active, 'active', { optional: true });
    if (target.id === user.id && (active === false || (role && role !== 'admin'))) throw badRequest('You cannot demote or deactivate your own account.');
    if (role) target.role = role;
    if (weeklyQuota !== undefined) target.weeklyQuota = weeklyQuota;
    if (active !== undefined) target.active = active;
    audit(store, user, 'user.updated', target.id, { role, weeklyQuota, active });
    store.touch();
    return { user: publicUser(target) };
  });

  router.get('/api/admin/audit', { roles: ['admin'] }, ({ query }) => {
    const limit = v.int(query.limit ?? 60, 'limit', { min: 1, max: 200 });
    return { items: store.data.audit.slice(-limit).reverse() };
  });
}
