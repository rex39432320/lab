// Administration: users, equipment status and the audit trail.
import { api } from '../api.js';
import { h, replace } from '../dom.js';
import { timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { refreshRoute } from '../router.js';
import { state } from '../state.js';
import { badge, confirmDialog, field, guarded, openModal, selectInput, tabs, tile, toast } from '../ui.js';

const ROLES = [['student', 'Student'], ['faculty', 'Faculty'], ['admin', 'Admin']];

function usersTable(users) {
  const rows = users.map((u) => {
    const role = selectInput(ROLES, u.role, { 'aria-label': `Role for ${u.name}` })(`role-${u.id}`);
    const quota = h('input', { class: 'input', type: 'number', min: '1', max: '60', value: u.weeklyQuota ?? '', disabled: u.role !== 'student', 'aria-label': `Weekly hours for ${u.name}` });
    const save = async (patch, success) => { await guarded(async () => { await api.patch(`/api/admin/users/${u.id}`, patch); refreshRoute(); }, { success }); };
    role.addEventListener('change', () => save({ role: role.value }, `${u.name} is now ${role.value}.`));
    quota.addEventListener('change', () => save({ weeklyQuota: Number(quota.value) }, 'Weekly allowance updated.'));
    return h('tr', null,
      h('td', null, h('div', { class: 'strong' }, u.name), h('div', { class: 'xs faint' }, u.email)),
      h('td', null, u.department), h('td', null, role), h('td', null, quota),
      h('td', null, u.active ? badge('Active', 'success') : badge('Deactivated', 'danger')),
      h('td', { class: 'right' }, h('button', { class: `btn btn--sm ${u.active ? 'btn--danger' : ''}`, disabled: u.id === state.user.id, onclick: async () => {
        if (u.active && !(await confirmDialog({ title: `Deactivate ${u.name}?`, message: 'They will be signed out and unable to sign in until reactivated.', confirmLabel: 'Deactivate', danger: true }))) return;
        save({ active: !u.active }, u.active ? 'Account deactivated.' : 'Account reactivated.');
      } }, u.active ? 'Deactivate' : 'Reactivate')));
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('caption', { class: 'sr-only' }, 'Users and permissions'),
    h('thead', null, h('tr', null, ['User', 'Dept', 'Role', 'Weekly hours', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, rows)));
}

function equipmentTable(items) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('caption', { class: 'sr-only' }, 'Equipment inventory'),
    h('thead', null, h('tr', null, ['Equipment', 'Department', 'Custodian', 'Access', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', null, items.map((e) => h('tr', null,
      h('td', null, h('div', { class: 'row row--nowrap' }, tile(e, 'sm'), h('div', null, h('a', { href: `#/equipment/${e.id}`, class: 'strong' }, e.name), h('div', { class: 'xs faint' }, e.location)))),
      h('td', null, e.department), h('td', null, e.custodian), h('td', null, e.requiresApproval ? badge('Approval', 'violet', 'lock') : badge('Open', 'success')),
      h('td', null, e.status === 'available' ? badge('Available', 'success') : badge('Maintenance', 'warn', 'wrench')),
      h('td', { class: 'right' }, h('button', { class: 'btn btn--sm', onclick: async (ev) => {
        const next = e.status === 'available' ? 'maintenance' : 'available';
        if (next === 'maintenance' && !(await confirmDialog({ title: `Take ${e.name} out of service?`, message: 'All upcoming bookings will be cancelled and users notified.', confirmLabel: 'Take offline', danger: true }))) return;
        await guarded(async () => { const r = await api.patch(`/api/equipment/${e.id}`, { status: next }); if (r.cancelled) toast(`${r.cancelled} booking(s) cancelled and users notified.`, { type: 'info' }); refreshRoute(); }, { success: next === 'maintenance' ? 'Equipment is now under maintenance.' : 'Equipment is available again.', button: ev.currentTarget });
      } }, e.status === 'available' ? 'Set maintenance' : 'Restore')))))));
}

function addEquipmentModal() {
  const f = {};
  const message = h('div', { role: 'alert' });
  const depts = Object.entries(state.meta.departments);
  openModal({
    title: 'Add equipment', wide: true,
    body: h('div', { class: 'stack' }, h('div', { class: 'form-grid' },
      field('Name', (id) => (f.name = h('input', { class: 'input', id, required: true, minlength: '2', maxlength: '80', autofocus: true }))),
      field('Location', (id) => (f.location = h('input', { class: 'input', id, required: true, maxlength: '80', placeholder: 'Block A · Lab 204' }))),
      field('Category', (id) => (f.category = selectInput(state.meta.categories.map((c) => [c, c]), state.meta.categories[0])(id))),
      field('Department', (id) => (f.department = selectInput(depts, depts[0][0])(id))),
      field('Description', (id) => (f.description = h('textarea', { class: 'textarea', id, required: true, minlength: '10', maxlength: '500' })), { full: true }),
      field('Key specs (one per line)', (id) => (f.specs = h('textarea', { class: 'textarea', id, maxlength: '600' })), { full: true }),
      field('Search tags (comma separated)', (id) => (f.tags = h('input', { class: 'input', id, maxlength: '300', placeholder: 'oscilloscope, signal, debugging' })), { full: true }),
      h('label', { class: 'check full' }, (f.requiresApproval = h('input', { type: 'checkbox' })), h('span', null, 'Requires faculty approval (project-based access)'))), message),
    actions: [{ label: 'Cancel', value: null }, { label: 'Add equipment', variant: 'primary', onClick: async (close) => {
      message.replaceChildren();
      try {
        await api.post('/api/equipment', {
          name: f.name.value, location: f.location.value, category: f.category.value, department: f.department.value, description: f.description.value,
          specs: f.specs.value.split('\n').map((s) => s.trim()).filter(Boolean), tags: f.tags.value.split(',').map((s) => s.trim()).filter(Boolean), requiresApproval: f.requiresApproval.checked,
        });
        toast('Equipment added to the catalogue.', { type: 'success' });
        close(true);
        refreshRoute();
      } catch (err) { message.append(h('div', { class: 'alert alert--danger' }, err.message)); return false; }
    } }],
  });
}

const ACTION_LABEL = { 'auth.login': 'signed in', 'booking.created': 'created a booking', 'booking.cancelled': 'cancelled a booking', 'booking.promoted': 'was auto-booked from the waitlist', 'conflict.resolved': 'resolved a conflict', 'access.approved': 'approved access', 'access.rejected': 'declined access', 'access.requested': 'requested access', 'equipment.updated': 'updated equipment' };

export async function adminView({ query }) {
  const [{ items: users }, { items: equipment }, { items: audit }] = await Promise.all([api.get('/api/admin/users'), api.get('/api/equipment'), api.get('/api/admin/audit?limit=60')]);
  let active = query.tab ?? 'users';
  const tabHost = h('div');
  const body = h('div', { class: 'stack' });
  function paint(focus) {
    replace(tabHost, tabs([['users', 'Users', users.length], ['equipment', 'Equipment', equipment.length], ['audit', 'Audit log']], active, (k, f) => { active = k; paint(f); }, 'Administration sections'));
    if (focus) tabHost.querySelector('[aria-selected="true"]').focus();
    replace(body, {
      users: () => usersTable(users),
      equipment: () => h('div', { class: 'stack' }, h('div', { class: 'row' }, h('button', { class: 'btn btn--primary', onclick: addEquipmentModal }, icon('plus', { size: 18 }), 'Add equipment')), equipmentTable(equipment)),
      audit: () => h('div', { class: 'list' }, audit.map((a) => h('div', { class: 'item' }, h('div', { class: 'option__icon' }, icon('shield')), h('div', { class: 'item__body' }, h('div', { class: 'item__title' }, `${a.actorName} ${ACTION_LABEL[a.action] ?? a.action}`), h('div', { class: 'item__meta' }, a.meta?.equipment, a.meta?.slot, a.meta?.demo && 'seeded history')), h('span', { class: 'xs faint' }, timeAgo(a.at))))),
    }[active]());
  }
  paint();
  return h('div', { class: 'page' },
    h('header', { class: 'page__header' }, h('div', null, h('p', { class: 'eyebrow' }, 'Lab coordinator'), h('h1', { class: 'page__title', tabindex: '-1' }, 'Administration'), h('p', { class: 'page__sub' }, 'Manage roles and fair-use allowances, equipment availability, and review every action in the audit trail.'))),
    tabHost, body);
}
