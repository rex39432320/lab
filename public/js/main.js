// Application entry: boot, auth gate and route rendering.
import { api } from './api.js';
import { createShell } from './components/shell.js';
import { $, h, replace } from './dom.js';
import { defineRoute, matchRoute, parseHash } from './router.js';
import { state, update } from './state.js';
import { emptyState, errorState, skeletonGrid } from './ui.js';
import { adminView } from './views/admin.js';
import { analyticsView } from './views/analytics.js';
import { approvalsView } from './views/approvals.js';
import { bookingsView } from './views/bookings.js';
import { copilotView } from './views/copilot.js';
import { dashboardView } from './views/dashboard.js';
import { discoverView } from './views/discover.js';
import { equipmentView } from './views/equipment.js';
import { loginView } from './views/login.js';
import { plannerView } from './views/planner.js';
import { projectsView } from './views/projects.js';

const STAFF = ['faculty', 'admin'];
defineRoute('/', dashboardView, { title: 'Dashboard' });
defineRoute('/discover', discoverView, { title: 'Discover equipment' });
defineRoute('/equipment/:id', equipmentView, { title: 'Equipment' });
defineRoute('/bookings', bookingsView, { title: 'My bookings' });
defineRoute('/projects', projectsView, { title: 'Projects' });
defineRoute('/planner', plannerView, { title: 'Smart Planner' });
defineRoute('/copilot', copilotView, { title: 'AI Copilot' });
defineRoute('/approvals', approvalsView, { title: 'Approvals', roles: STAFF });
defineRoute('/analytics', analyticsView, { title: 'Analytics', roles: STAFF });
defineRoute('/admin', adminView, { title: 'Administration', roles: ['admin'] });

const root = $('#app');
let shell = null;
let renderToken = 0;

function showLogin() {
  shell?.destroy();
  shell = null;
  document.title = 'Sign in · LabLink';
  replace(root, loginView({ onSignedIn: () => { location.hash = '#/'; render(); } }));
}

async function signOut() {
  await api.post('/api/auth/logout').catch(() => {});
  update({ user: null, unread: 0 });
  location.hash = '#/';
  render();
}

async function render() {
  if (!state.user) return showLogin();
  if (!shell) {
    shell = createShell({ onSignOut: signOut });
    replace(root, shell.el);
  }
  const { path, query } = parseHash();
  const match = matchRoute(path);
  const token = ++renderToken;
  shell.setActive(path);

  const show = (node, title) => {
    if (token !== renderToken) return;
    replace(shell.host, node);
    document.title = `${title} · LabLink`;
    const heading = $('.page__title', shell.host) ?? shell.host;
    heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  };

  if (!match) return show(h('div', { class: 'page' }, emptyState({ iconName: 'search', title: 'Page not found', text: 'That page does not exist.', action: h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to dashboard') })), 'Not found');
  const { route, params } = match;
  if (route.options.roles && !route.options.roles.includes(state.user.role)) {
    return show(h('div', { class: 'page' }, emptyState({ iconName: 'lock', title: 'Staff only', text: 'You do not have access to this area.', action: h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to dashboard') })), 'No access');
  }

  replace(shell.host, h('div', { class: 'page', 'aria-busy': 'true' }, skeletonGrid(3)));
  try {
    show(await route.loader({ params, query }), route.options.title);
  } catch (err) {
    show(h('div', { class: 'page' }, errorState(err, render)), 'Error');
  }
  shell.refresh();
}

async function boot() {
  $('.skip-link').addEventListener('click', (e) => { e.preventDefault(); ($('.page__title') ?? $('#main'))?.focus(); });
  try {
    const [meta, me] = await Promise.all([api.get('/api/meta'), api.get('/api/auth/me')]);
    update({ meta, user: me.user, unread: me.unread, mode: meta.ai.enabled ? 'gemini' : 'local' });
  } catch (err) {
    replace(root, h('div', { class: 'page' }, errorState(err, () => location.reload())));
    return;
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('app:refresh', render);
  window.addEventListener('auth:expired', () => { update({ user: null }); showLogin(); });
  render();
}

boot();
