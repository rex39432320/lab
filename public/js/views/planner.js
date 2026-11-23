// Smart Planner: spreads the hours a project needs across free slots before a deadline.
import { api } from '../api.js';
import { h, replace } from '../dom.js';
import { daysLeftText, diffDays, range, relativeDay, shortDate } from '../format.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { state } from '../state.js';
import { emptyState, field, guarded, selectInput } from '../ui.js';

export async function plannerView({ query }) {
  const [{ items: equipment }, { items: projects }] = await Promise.all([api.get('/api/equipment?available=true'), api.get('/api/projects')]);
  const today = state.meta.now.date;
  const mine = projects.filter((p) => state.user.role !== 'student' || p.owner.id === state.user.id || p.members.some((m) => m.id === state.user.id));
  const f = {};
  const result = h('div', { class: 'stack', 'aria-live': 'polite' });

  const eqOptions = state.meta.categories.map((cat) => ({ cat, list: equipment.filter((e) => e.category === cat) })).filter((g) => g.list.length);
  f.equipmentId = h('select', { class: 'select', id: 'pl-eq' }, eqOptions.map((g) => h('optgroup', { label: g.cat }, g.list.map((e) => h('option', { value: e.id, selected: e.id === query.equipment }, `${e.name}${e.requiresApproval ? ' 🔒' : ''}`)))));
  f.projectId = h('select', { class: 'select', id: 'pl-project' }, h('option', { value: '' }, '— No project —'), mine.map((p) => h('option', { value: p.id, selected: p.id === query.project }, p.title)));
  f.hours = h('input', { class: 'input', id: 'pl-hours', type: 'number', min: '1', max: '60', value: query.hours ?? '6' });
  f.deadline = h('input', { class: 'input', id: 'pl-deadline', type: 'date', min: today, value: mine.find((p) => p.id === query.project)?.deadline ?? mine[0]?.deadline ?? '' });
  f.sessionHours = selectInput([[1, '1 hour'], [2, '2 hours'], [3, '3 hours'], [4, '4 hours']], 2)('pl-session');
  f.preferred = selectInput([['any', 'Any time'], ['morning', 'Mornings'], ['afternoon', 'Afternoons']], 'any')('pl-pref');
  f.projectId.addEventListener('change', () => { const p = mine.find((x) => x.id === f.projectId.value); if (p) f.deadline.value = p.deadline; });

  const body = () => ({ equipmentId: f.equipmentId.value, projectId: f.projectId.value || undefined, hours: Number(f.hours.value), deadline: f.deadline.value, sessionHours: Number(f.sessionHours.value), preferred: f.preferred.value });

  async function generate(e) {
    e?.preventDefault();
    const btn = document.getElementById('pl-go');
    await guarded(async () => {
      const { plan, params } = await api.post('/api/bookings/plan', body());
      const eq = equipment.find((x) => x.id === params.equipmentId);
      replace(result, plan.sessions.length ? planCard(plan, params, eq) : emptyState({ iconName: 'calendar', title: 'No feasible plan', text: plan.notes.join(' ') || 'Try a later deadline or a different instrument.' }));
      result.querySelector('h2')?.focus();
    }, { button: btn, busy: 'Planning…' });
  }

  function planCard(plan, params, eq) {
    const daysToDeadline = diffDays(params.deadline, today);
    return h('section', { class: 'card card--accent stack', 'aria-labelledby': 'plan-h' },
      h('div', { class: 'row' }, icon('sparkles', { size: 22 }), h('div', null, h('h2', { id: 'plan-h', class: 'card__title', tabindex: '-1' }, `${plan.plannedHours} of ${params.hours} h planned on ${eq.name}`), h('p', { class: 'small muted' }, `Deadline ${shortDate(params.deadline)} · ${daysLeftText(daysToDeadline)}`))),
      plan.shortfall > 0 && h('div', { class: 'alert alert--warn', role: 'alert' }, icon('alert', { size: 18 }), `${plan.shortfall} h could not be placed.`),
      h('div', { class: 'timeline' }, plan.sessions.map((s, i) => h('div', { class: 'timeline__item' }, h('div', { class: 'timeline__dot', 'aria-hidden': 'true' }, i + 1),
        h('div', null, h('div', { class: 'strong' }, `${relativeDay(s.date, today)} · ${range(s.startHour, s.endHour)}`), h('div', { class: 'small muted' }, `${shortDate(s.date)} · ${s.endHour - s.startHour} h session`))))),
      plan.notes.map((n) => h('p', { class: 'small muted' }, n)),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn--primary btn--lg', onclick: (e) => guarded(async () => { await api.post('/api/bookings/commit', { sessions: plan.sessions, purpose: 'Planned with Smart Planner' }); go('/bookings'); }, { success: `Booked ${plan.sessions.length} sessions.`, button: e.currentTarget, busy: 'Booking…' }) }, icon('calendar-check', { size: 18 }), `Book all ${plan.sessions.length} sessions`),
        h('button', { class: 'btn', onclick: generate }, 'Re-plan')));
  }

  return h('div', { class: 'page' },
    h('header', { class: 'page__header' }, h('div', null, h('p', { class: 'eyebrow' }, 'Smart Planner'), h('h1', { class: 'page__title', tabindex: '-1' }, 'Schedule your project hours'),
      h('p', { class: 'page__sub' }, 'Tell LabLink how many hours you need and when you are due. It spreads sessions across free slots, respects your fair-use quota and keeps a buffer before the deadline.'))),
    h('div', { class: 'grid grid--split' },
      h('form', { class: 'card stack', onsubmit: generate },
        h('div', { class: 'form-grid' },
          field('Equipment', () => f.equipmentId, { full: true }), field('Project', () => f.projectId), field('Deadline', () => f.deadline),
          field('Total hours needed', () => f.hours), field('Session length', () => f.sessionHours), field('Preferred time', () => f.preferred, { full: true })),
        h('button', { class: 'btn btn--primary btn--lg', id: 'pl-go', type: 'submit' }, icon('sparkles', { size: 18 }), 'Generate plan')),
      result.children.length ? result : h('div', { class: 'stack' }, result, emptyState({ iconName: 'target', title: 'Your plan appears here', text: 'The planner prefers earlier sessions with gaps between them, so a cancelled slot never ruins your deadline.' }))));
}
