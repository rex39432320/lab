import { api } from '../api.js';
import { equipmentCard } from '../components/equipmentCard.js';
import { h } from '../dom.js';
import { daysLeftText, longDate } from '../format.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { state } from '../state.js';
import { accessRequestModal } from './equipment.js';
import {
  avatar,
  badge,
  emptyState,
  field,
  guarded,
  openModal,
  progress,
  selectInput,
  toast,
  submitAction,
} from '../ui.js';

const ACCESS_BADGE = {
  approved: ['success', 'check-circle'],
  pending: ['warn', 'hourglass'],
  rejected: ['danger', 'x-circle'],
};

async function newProjectModal() {
  const { items: faculty } = await api.get('/api/faculty');
  const f = {};
  const message = h('div', { role: 'alert' });
  const kinds = state.meta.projectKinds.map((k) => [k, k[0].toUpperCase() + k.slice(1)]);
  openModal({
    title: 'Create a project',
    description: 'Projects unlock restricted equipment and give the scheduler context about your deadline.',
    body: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'form-grid' },
        field(
          'Title',
          (id) =>
            (f.title = h('input', {
              class: 'input',
              id,
              required: true,
              minlength: '3',
              maxlength: '90',
              autofocus: true,
            })),
          { full: true },
        ),
        field(
          'What are you building?',
          (id) =>
            (f.description = h('textarea', {
              class: 'textarea',
              id,
              required: true,
              minlength: '10',
              maxlength: '600',
              placeholder:
                'Mention the technologies and measurements involved — Copilot uses this to suggest equipment.',
            })),
          { full: true },
        ),
        field(
          'Faculty guide',
          (id) =>
            (f.guideId = selectInput(
              faculty.map((u) => [u.id, `${u.name} (${u.department})`]),
              faculty.find((u) => u.department === state.user.department)?.id,
            )(id)),
        ),
        field('Project type', (id) => (f.kind = selectInput(kinds, 'course')(id))),
        field(
          'Deadline',
          (id) =>
            (f.deadline = h('input', {
              class: 'input',
              id,
              type: 'date',
              required: true,
              min: state.meta.now.date,
            })),
        ),
        field(
          'Planned lab hours',
          (id) =>
            (f.plannedHours = h('input', {
              class: 'input',
              id,
              type: 'number',
              min: '1',
              max: '500',
              value: '12',
            })),
        ),
      ),
      message,
    ),
    actions: [
      { label: 'Cancel', value: null },
      submitAction({
        label: 'Create project',
        message,
        submit: () =>
          api.post('/api/projects', {
            title: f.title.value,
            description: f.description.value,
            guideId: f.guideId.value,
            kind: f.kind.value,
            deadline: f.deadline.value,
            plannedHours: Number(f.plannedHours.value),
          }),
        onSuccess: () => toast('Project created. Request equipment access next.', { type: 'success' }),
      }),
    ],
  });
}

function addMemberModal(project) {
  const email = h('input', {
    class: 'input',
    id: 'mem-email',
    type: 'email',
    required: true,
    placeholder: 'teammate@lablink.edu',
    autofocus: true,
  });
  const message = h('div', { role: 'alert' });
  openModal({
    title: 'Add a teammate',
    description: 'Team members share the project’s equipment access and deadline.',
    body: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'mem-email' }, 'Student email'), email),
      message,
    ),
    actions: [
      { label: 'Cancel', value: null },
      submitAction({
        label: 'Add member',
        message,
        submit: () => api.post(`/api/projects/${project.id}/members`, { email: email.value }),
        onSuccess: () => toast('Teammate added.', { type: 'success' }),
      }),
    ],
  });
}

async function requestAccessFlow(project) {
  const { items } = await api.get('/api/equipment?approval=true');
  const taken = new Set(project.access.filter((a) => a.status !== 'rejected').map((a) => a.equipmentId));
  const options = items.filter((e) => !taken.has(e.id));
  if (!options.length)
    return toast('This project already has requests for every restricted instrument.', { type: 'info' });
  const sel = selectInput(
    options.map((e) => [e.id, `${e.name} — ${e.department}`]),
    options[0].id,
  )('pick-eq');
  const res = await openModal({
    title: 'Which equipment do you need?',
    body: h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', for: 'pick-eq' }, 'Restricted equipment'),
      sel,
    ),
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Continue', variant: 'primary', value: 'go' },
    ],
  }).promise;
  if (res !== 'go') return;
  const eq = options.find((e) => e.id === sel.value);
  accessRequestModal({
    equipmentId: eq.id,
    equipmentName: eq.name,
    projects: [{ id: project.id, title: project.title }],
    projectId: project.id,
  });
}

async function suggestModal(project, button) {
  await guarded(
    async () => {
      const data = await api.post(`/api/projects/${project.id}/recommend`);
      openModal({
        title: 'Suggested equipment',
        wide: true,
        description: `${data.aiUsed ? 'Gemini and the' : 'The'} smart-search engine read “${project.title}” and matched it to these instruments.`,
        body: data.items.length
          ? h('div', { class: 'grid grid--2' }, data.items.slice(0, 6).map(equipmentCard))
          : emptyState({
              iconName: 'search',
              title: 'No strong matches',
              text: 'Add more technical detail to the project description.',
            }),
        actions: [{ label: 'Close', value: null }],
      });
    },
    { button, busy: 'Analysing…' },
  );
}

function projectCard(p) {
  const total = Math.max(p.plannedHours, p.hoursCompleted + p.hoursScheduled);
  const pct = total ? ((p.hoursCompleted + p.hoursScheduled) / total) * 100 : 0;
  const urgency = p.daysLeft <= 3 ? 'urgent' : p.daysLeft <= 7 ? 'soon' : '';
  const mine = p.owner.id === state.user.id || state.user.role === 'admin';
  const asStudent = state.user.role === 'student';
  return h(
    'article',
    { class: 'card stack', 'aria-labelledby': `p-${p.id}` },
    h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'item__body' },
        h('h3', { id: `p-${p.id}`, class: 'card__title' }, p.title),
        h(
          'div',
          { class: 'row small muted' },
          badge(p.kind, 'violet'),
          h(
            'span',
            { class: `countdown ${urgency ? `countdown--${urgency}` : ''}` },
            daysLeftText(p.daysLeft),
          ),
          `· due ${longDate(p.deadline)}`,
        ),
      ),
    ),
    h('p', { class: 'small muted' }, p.description),
    h(
      'div',
      null,
      h(
        'div',
        { class: 'row xs faint' },
        'Lab hours planned',
        h('span', { class: 'spacer' }),
        `${p.hoursCompleted} done · ${p.hoursScheduled} scheduled · ${p.plannedHours} target`,
      ),
      progress(pct, p.daysLeft <= 3 && pct < 60 ? 'danger' : '', `${p.title} hours`),
    ),
    h(
      'div',
      { class: 'row small' },
      icon('users', { size: 16 }),
      h('span', { class: 'muted' }, 'Team:'),
      [p.owner, ...p.members].map((m) =>
        h('span', { class: 'row', 'aria-label': m.name }, avatar(m.name), m.name.split(' ')[0]),
      ),
      h('span', { class: 'spacer' }),
      h('span', { class: 'faint' }, `Guide: ${p.guide.name}`),
    ),
    h(
      'div',
      { class: 'stack stack--sm' },
      h('strong', { class: 'small' }, 'Equipment access'),
      p.access.length
        ? h(
            'div',
            { class: 'chips' },
            p.access.map((a) => {
              const [variant, ic] = ACCESS_BADGE[a.status];
              return h(
                'a',
                {
                  class: `badge badge--${variant}`,
                  href: `#/equipment/${a.equipmentId}`,
                  title: a.comment ?? '',
                },
                icon(ic, { size: 13 }),
                `${a.equipmentName} · ${a.status}`,
              );
            }),
          )
        : h('span', { class: 'small faint' }, 'No restricted equipment requested yet.'),
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        { class: 'btn btn--sm btn--primary', onclick: () => go(`/planner?project=${p.id}`) },
        icon('target', { size: 15 }),
        'Plan lab hours',
      ),
      asStudent &&
        h(
          'button',
          { class: 'btn btn--sm', onclick: () => requestAccessFlow(p) },
          icon('lock', { size: 15 }),
          'Request access',
        ),
      h(
        'button',
        { class: 'btn btn--sm', onclick: (e) => suggestModal(p, e.currentTarget) },
        icon('sparkles', { size: 15 }),
        'Suggest equipment',
      ),
      mine &&
        asStudent &&
        h(
          'button',
          { class: 'btn btn--sm btn--ghost', onclick: () => addMemberModal(p) },
          icon('plus', { size: 15 }),
          'Add teammate',
        ),
    ),
  );
}

export async function projectsView() {
  const { items } = await api.get('/api/projects');
  const canCreate = state.user.role !== 'admin';
  return h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page__header' },
      h(
        'div',
        null,
        h('p', { class: 'eyebrow' }, state.user.role === 'student' ? 'Your work' : 'Projects you guide'),
        h('h1', { class: 'page__title', tabindex: '-1' }, 'Projects'),
        h(
          'p',
          { class: 'page__sub' },
          'Projects connect your deadline and team to restricted equipment, and drive fair scheduling priority.',
        ),
      ),
      canCreate &&
        h(
          'button',
          { class: 'btn btn--primary', onclick: newProjectModal },
          icon('plus', { size: 18 }),
          'New project',
        ),
    ),
    items.length
      ? h('div', { class: 'grid grid--2' }, items.map(projectCard))
      : emptyState({
          iconName: 'folder',
          title: 'No projects yet',
          text: 'Create your first project to request restricted equipment.',
          action:
            canCreate &&
            h('button', { class: 'btn btn--primary', onclick: newProjectModal }, 'Create a project'),
        }),
  );
}
