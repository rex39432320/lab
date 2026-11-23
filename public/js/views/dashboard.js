import { api } from '../api.js';
import { h } from '../dom.js';
import { daysLeftText, relativeDay } from '../format.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { isStaff, state } from '../state.js';
import { badge, emptyState, progress, ring } from '../ui.js';
import { bookingRow } from './bookings.js';

const PROMPTS = [
  'Find equipment for an IoT project',
  'What is free tomorrow afternoon?',
  'Plan 6 hours on the oscilloscope before Friday',
];

function kpi(label, iconName, value, note, extra) {
  return h('div', { class: 'card kpi' }, h('div', { class: 'kpi__label' }, icon(iconName, { size: 16 }), label), h('div', { class: 'kpi__value' }, value), note && h('div', { class: 'kpi__note' }, note), extra);
}

function projectCard(p) {
  const total = Math.max(p.plannedHours, p.hoursCompleted + p.hoursScheduled);
  const donePct = total ? ((p.hoursCompleted + p.hoursScheduled) / total) * 100 : 0;
  const urgency = p.daysLeft <= 3 ? 'urgent' : p.daysLeft <= 7 ? 'soon' : '';
  return h('a', { class: 'item', href: '#/projects' },
    h('div', { class: 'item__body' },
      h('div', { class: 'item__title' }, p.title),
      h('div', { class: 'item__meta' }, badge(p.kind, 'violet'), h('span', { class: `countdown ${urgency ? `countdown--${urgency}` : ''}` }, daysLeftText(p.daysLeft))),
      h('div', { class: 'meter' }, progress(donePct, p.daysLeft <= 3 && donePct < 60 ? 'danger' : '', `${p.title} hours planned`),
        h('span', { class: 'xs faint nowrap' }, `${p.hoursCompleted + p.hoursScheduled}/${p.plannedHours} h`))));
}

export async function dashboardView() {
  const d = await api.get('/api/dashboard');
  const user = state.user;
  const today = state.meta.now.date;
  const hour = state.meta.now.hour;
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const staff = isStaff();
  const first = user.name.replace(/^(Dr\.|Prof\.)\s*/, '').split(' ')[0];

  const input = h('input', { class: 'input', id: 'ask', placeholder: 'Ask the Copilot… “I need to test a 5G antenna”', maxlength: '300', 'aria-label': 'Ask the AI Copilot' });
  const ask = (text) => go(`/copilot?q=${encodeURIComponent(text)}`);

  const actionItems = [];
  if (d.incomingSwaps) actionItems.push(['swap', `${d.incomingSwaps} swap request${d.incomingSwaps > 1 ? 's' : ''} need your answer`, '/bookings']);
  if (staff && d.pendingApprovals) actionItems.push(['inbox', `${d.pendingApprovals} approval${d.pendingApprovals > 1 ? 's' : ''} waiting`, '/approvals']);
  if (d.waitlist) actionItems.push(['hourglass', `On ${d.waitlist} waitlist${d.waitlist > 1 ? 's' : ''} — you will be auto-booked if a slot opens`, '/bookings']);
  if (d.pendingAccess) actionItems.push(['lock', `${d.pendingAccess} access request${d.pendingAccess > 1 ? 's' : ''} awaiting faculty`, '/projects']);

  return h('div', { class: 'page' },
    h('header', { class: 'page__header' },
      h('div', null, h('p', { class: 'eyebrow' }, relativeDay(today, today) === 'Today' ? 'Overview' : 'Overview'),
        h('h1', { class: 'page__title', tabindex: '-1' }, `${greeting}, `, h('span', { class: 'gradient-text' }, first)),
        h('p', { class: 'page__sub' }, staff ? 'Here is what needs your attention across the labs today.' : 'Here is your lab schedule, project deadlines and fair-use allowance.')),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/planner' }, icon('target', { size: 18 }), 'Smart Planner'), h('a', { class: 'btn btn--primary', href: '#/discover' }, icon('search', { size: 18 }), 'Find equipment'))),

    h('form', { class: 'card card--accent stack stack--sm', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) ask(input.value.trim()); } },
      h('div', { class: 'row' }, h('span', { class: 'bot-avatar' }, icon('sparkles', { size: 18 })), h('div', null, h('strong', null, 'Ask LabLink Copilot'), h('div', { class: 'small muted' }, 'Describe what you need in plain English — equipment, slots, plans.'))),
      h('div', { class: 'row row--nowrap' }, input, h('button', { class: 'btn btn--primary', type: 'submit' }, icon('send', { size: 16 }), 'Ask')),
      h('div', { class: 'chips' }, PROMPTS.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => ask(p) }, p)))),

    actionItems.length > 0 && h('section', { 'aria-label': 'Needs your attention', class: 'stack stack--sm' }, actionItems.map(([ic, text, to]) =>
      h('a', { class: 'item item--action', href: `#${to}` }, icon(ic), h('div', { class: 'item__body strong' }, text), icon('arrow-right', { size: 18 })))),

    h('div', { class: 'grid grid--4' },
      !staff && d.quota
        ? h('div', { class: 'card kpi' }, h('div', { class: 'kpi__label' }, icon('gauge', { size: 16 }), 'Weekly fair-use'),
          h('div', { class: 'row' }, ring({ value: d.weekHours, max: d.quota.limit, label: `${d.weekHours} of ${d.quota.limit} hours used this week`, text: `${d.weekHours}h` }),
            h('div', null, h('div', { class: 'kpi__value' }, d.quota.limit - d.weekHours, h('small', null, ' h left')), h('div', { class: 'kpi__note' }, d.quota.boosted ? 'Includes deadline boost +50%' : `of ${d.quota.limit} h this week`))))
        : kpi('Hours this week', 'clock', d.weekHours, 'booked by you'),
      kpi('Upcoming sessions', 'calendar-check', d.upcoming.length, d.upcoming[0] ? `Next: ${relativeDay(d.upcoming[0].date, today)}` : 'Nothing scheduled'),
      staff ? kpi('Pending approvals', 'inbox', d.pendingApprovals, d.pendingApprovals ? 'Review in Approvals' : 'Inbox zero') : kpi('Goodwill credit', 'heart', d.karma, 'Earned by releasing slots to others'),
      kpi('Active projects', 'folder', d.projects.length, d.projects[0] ? `Closest due: ${daysLeftText(d.projects[0].daysLeft)}` : 'Create a project to get started')),

    h('div', { class: 'grid grid--split' },
      h('section', { class: 'card stack', 'aria-labelledby': 'up-next' },
        h('div', { class: 'card__head' }, h('h2', { class: 'card__title', id: 'up-next' }, 'Up next'), h('span', { class: 'spacer' }), h('a', { class: 'btn btn--ghost btn--sm', href: '#/bookings' }, 'All bookings', icon('arrow-right', { size: 15 }))),
        d.upcoming.length
          ? h('div', { class: 'list' }, d.upcoming.map((b) => bookingRow(b, { compact: true })))
          : emptyState({ iconName: 'calendar', title: 'No upcoming sessions', text: 'Find equipment and book your first slot.', action: h('a', { class: 'btn btn--primary btn--sm', href: '#/discover' }, 'Browse equipment') })),
      h('section', { class: 'card stack', 'aria-labelledby': 'proj-h' },
        h('div', { class: 'card__head' }, h('h2', { class: 'card__title', id: 'proj-h' }, 'Projects & deadlines'), h('span', { class: 'spacer' }), h('a', { class: 'btn btn--ghost btn--sm', href: '#/projects' }, 'Manage', icon('arrow-right', { size: 15 }))),
        d.projects.length ? h('div', { class: 'list' }, d.projects.map(projectCard)) : emptyState({ iconName: 'folder', title: 'No projects yet', text: 'Projects unlock restricted equipment and raise your scheduling priority.', action: h('a', { class: 'btn btn--primary btn--sm', href: '#/projects' }, 'Create a project') }))),

    h('section', { class: 'card', 'aria-labelledby': 'how-h' },
      h('h2', { class: 'card__title', id: 'how-h' }, 'How LabLink keeps access fair'),
      h('div', { class: 'grid grid--4' },
        [['target', 'Deadline-aware', 'Closer deadlines earn higher priority when slots collide.'], ['gauge', 'Fair-share quotas', 'Weekly allowances stop any one team hogging equipment.'], ['swap', 'Consent-based swaps', 'Holders can be asked to move and earn goodwill credit.'], ['hourglass', 'Smart waitlist', 'Cancelled and no-show slots go to the highest-priority waiter.']]
          .map(([ic, t, text]) => h('div', { class: 'stack stack--sm' }, h('div', { class: 'option__icon' }, icon(ic)), h('strong', null, t), h('p', { class: 'small muted' }, text))))));
}
