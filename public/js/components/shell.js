// Application shell: sidebar navigation, top bar, theme toggle, notifications.
import { api } from '../api.js';
import { $, h, replace } from '../dom.js';
import { timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { state, update } from '../state.js';
import { avatar, badge, emptyState } from '../ui.js';

const STAFF = ['faculty', 'admin'];
const NAV = [
  { to: '/', label: 'Dashboard', icon: 'home' },
  { to: '/discover', label: 'Discover', icon: 'search' },
  { to: '/copilot', label: 'AI Copilot', icon: 'sparkles' },
  { to: '/planner', label: 'Smart Planner', icon: 'target' },
  { to: '/bookings', label: 'My Bookings', icon: 'calendar-check', count: 'swaps' },
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { section: 'Faculty & lab staff', roles: STAFF },
  { to: '/approvals', label: 'Approvals', icon: 'inbox', roles: STAFF, count: 'approvals' },
  { to: '/analytics', label: 'Analytics', icon: 'chart', roles: STAFF },
  { to: '/admin', label: 'Administration', icon: 'settings', roles: ['admin'] },
];

export function createShell({ onSignOut }) {
  const counts = { swaps: 0, approvals: 0 };
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Primary' });
  const host = h('div', { id: 'main', tabindex: '-1' });
  const scrim = h('div', { class: 'scrim', hidden: true, onclick: () => setOpen(false) });
  const bellWrap = h('div', { class: 'relative' });
  const menuBtn = h(
    'button',
    {
      class: 'btn btn--icon btn--ghost menu-btn',
      'aria-label': 'Open navigation',
      'aria-controls': 'sidebar',
      'aria-expanded': 'false',
      onclick: () => setOpen(true),
    },
    icon('menu'),
  );

  function setOpen(open) {
    sidebar.dataset.open = String(open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) $('a', sidebar)?.focus();
  }

  const navLinks = new Map();
  function renderNav() {
    navLinks.clear();
    const role = state.user.role;
    const items = NAV.filter((n) => !n.roles || n.roles.includes(role)).map((n) => {
      if (n.section) return h('div', { class: 'nav__label' }, n.section);
      const count = n.count ? counts[n.count] : 0;
      const link = h(
        'a',
        { class: 'nav__link', href: `#${n.to}`, onclick: () => setOpen(false) },
        icon(n.icon),
        n.label,
        count > 0 && h('span', { class: 'nav__badge', 'aria-label': `${count} pending` }, count),
      );
      navLinks.set(n.to, link);
      return link;
    });
    replace(
      sidebar,
      h(
        'a',
        { class: 'brand', href: '#/', 'aria-label': 'LabLink home' },
        h('span', { class: 'brand__mark' }, icon('target', { size: 22 })),
        h(
          'span',
          null,
          h('span', { class: 'brand__name' }, 'LabLink'),
          h('span', { class: 'brand__tag' }, 'Campus lab sharing'),
        ),
      ),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, items),
      h(
        'div',
        { class: 'sidebar__foot' },
        h(
          'div',
          { class: 'user-chip' },
          avatar(state.user.name),
          h(
            'div',
            { class: 'user-chip__meta' },
            h('div', { class: 'user-chip__name' }, state.user.name),
            h('div', { class: 'user-chip__role' }, `${state.user.role} · ${state.user.department}`),
          ),
        ),
        h(
          'button',
          { class: 'btn btn--ghost btn--sm btn--block', onclick: onSignOut },
          icon('logout', { size: 16 }),
          'Sign out',
        ),
      ),
    );
  }

  function setActive(path) {
    const key = [...navLinks.keys()]
      .filter((k) => (k === '/' ? path === '/' : path === k || path.startsWith(`${k}/`)))
      .sort((a, b) => b.length - a.length)[0];
    navLinks.forEach((link, to) =>
      to === key ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current'),
    );
    setOpen(false);
  }

  // ---- Theme ----
  const themeBtn = h('button', { class: 'btn btn--icon btn--ghost', onclick: toggleTheme });
  function paintTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    replace(themeBtn, icon(dark ? 'sun' : 'moon'));
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('lablink-theme', next);
    } catch {
      /* ignore */
    }
    paintTheme();
  }

  // ---- Notifications ----
  let popover = null;
  const bell = h('button', {
    class: 'btn btn--icon btn--ghost relative',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    onclick: togglePopover,
  });
  function paintBell() {
    replace(
      bell,
      icon('bell'),
      state.unread > 0 &&
        h('span', { class: 'bell-dot', 'aria-hidden': 'true' }, state.unread > 9 ? '9+' : state.unread),
    );
    bell.setAttribute('aria-label', state.unread ? `Notifications, ${state.unread} unread` : 'Notifications');
  }
  async function togglePopover() {
    if (popover) return closePopover();
    popover = h(
      'div',
      { class: 'popover', role: 'region', 'aria-label': 'Notifications' },
      h('p', { class: 'muted small' }, 'Loading…'),
    );
    bellWrap.append(popover);
    bell.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escape, true);
    try {
      const { items, unread } = await api.get('/api/notifications');
      update({ unread });
      replace(
        popover,
        h(
          'div',
          { class: 'row' },
          h('strong', null, 'Notifications'),
          h('span', { class: 'spacer' }),
          unread > 0 && h('button', { class: 'btn btn--ghost btn--sm', onclick: markAll }, 'Mark all read'),
        ),
        items.length
          ? h('div', { class: 'stack--sm stack' }, items.map(notificationRow))
          : emptyState({ iconName: 'bell', title: 'All caught up', text: 'New activity will show up here.' }),
      );
    } catch (err) {
      replace(popover, h('p', { class: 'error-text' }, err.message));
    }
  }
  function notificationRow(n) {
    return h(
      'a',
      {
        class: `notif ${n.read ? '' : 'notif--unread'}`,
        href: n.link || '#/',
        onclick: async () => {
          closePopover();
          if (!n.read) {
            await api.post(`/api/notifications/${n.id}/read`).catch(() => {});
            refresh();
          }
        },
      },
      !n.read && h('span', { class: 'notif__dot', 'aria-label': 'Unread' }),
      h(
        'div',
        null,
        h('div', { class: 'strong small' }, n.title),
        n.body && h('div', { class: 'small muted' }, n.body),
        h('div', { class: 'xs faint' }, timeAgo(n.createdAt)),
      ),
    );
  }
  async function markAll() {
    await api.post('/api/notifications/read-all');
    update({ unread: 0 });
    closePopover();
    paintBell();
  }
  function outside(e) {
    if (popover && !bellWrap.contains(e.target)) closePopover();
  }
  function escape(e) {
    if (e.key === 'Escape') {
      closePopover();
      bell.focus();
    }
  }
  function closePopover() {
    popover?.remove();
    popover = null;
    bell.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', escape, true);
  }

  async function refresh() {
    try {
      const [me, dash] = await Promise.all([api.get('/api/auth/me'), api.get('/api/dashboard')]);
      counts.swaps = dash.incomingSwaps;
      counts.approvals = dash.pendingApprovals;
      update({ unread: me.unread });
      const path = location.hash.slice(1).split('?')[0] || '/';
      renderNav();
      setActive(path);
      paintBell();
    } catch {
      /* polling is best-effort */
    }
  }

  const search = h(
    'form',
    {
      class: 'topbar__search',
      role: 'search',
      onsubmit: (e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get('q').toString().trim();
        go(q ? `/discover?q=${encodeURIComponent(q)}` : '/discover');
      },
    },
    icon('search', { size: 18 }),
    h('label', { class: 'sr-only', for: 'global-search' }, 'Search equipment'),
    h('input', {
      class: 'input',
      id: 'global-search',
      name: 'q',
      type: 'search',
      placeholder: 'Describe what you need, e.g. “capture sensor signals”',
      autocomplete: 'off',
      maxlength: '200',
    }),
  );

  renderNav();
  paintTheme();
  paintBell();
  bellWrap.append(bell);

  const el = h(
    'div',
    { class: 'app' },
    sidebar,
    scrim,
    h(
      'div',
      { class: 'main' },
      h(
        'header',
        { class: 'topbar' },
        menuBtn,
        search,
        h('span', { class: 'spacer' }),
        badge(state.mode === 'gemini' ? 'Gemini AI' : 'Local AI engine', 'violet', 'sparkles'),
        themeBtn,
        bellWrap,
      ),
      h('main', { id: 'main-content' }, host),
    ),
  );

  const timer = setInterval(() => {
    if (!document.hidden) refresh();
  }, 60_000);
  refresh();
  return { el, host, setActive, refresh, destroy: () => clearInterval(timer) };
}
