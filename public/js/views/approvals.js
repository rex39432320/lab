import { api } from '../api.js';
import { h, replace } from '../dom.js';
import { daysLeftText, longDate, range, shortDate } from '../format.js';
import { icon } from '../icons.js';
import { refreshRoute } from '../router.js';
import { badge, emptyState, guarded, tabs, tile, uid } from '../ui.js';

function decisionRow(path, id, payloadKey) {
  const note = h('input', {
    class: 'input',
    id: uid('c'),
    maxlength: '240',
    placeholder: 'Optional comment to the student',
    'aria-label': 'Comment for the student',
  });
  const send = (decision) => (e) =>
    guarded(
      async () => {
        await api.post(`${path}/${id}/decision`, { decision, comment: note.value || undefined });
        refreshRoute();
      },
      {
        success:
          decision === 'approve'
            ? 'Approved. The student has been notified.'
            : 'Declined. The student has been notified.',
        button: e.currentTarget,
      },
    );
  return h(
    'div',
    { class: 'row row--nowrap' },
    note,
    h(
      'button',
      { class: 'btn btn--success', onclick: send('approve') },
      icon('check', { size: 16 }),
      'Approve',
    ),
    h('button', { class: 'btn btn--danger', onclick: send('reject') }, icon('x', { size: 16 }), 'Decline'),
    payloadKey,
  );
}

const priorityBadge = (score) =>
  badge(`Priority ${score}`, score >= 60 ? 'danger' : score >= 40 ? 'warn' : 'muted', 'gauge');

function accessCard(r) {
  const urgency = r.projectDeadline
    ? Math.round((new Date(r.projectDeadline) - Date.now()) / 86_400_000)
    : null;
  return h(
    'article',
    { class: 'card stack', 'aria-label': `Access request: ${r.equipmentName} for ${r.projectTitle}` },
    h(
      'div',
      { class: 'row row--nowrap' },
      tile({ icon: r.equipmentIcon }, 'sm'),
      h(
        'div',
        { class: 'item__body' },
        h('h3', { class: 'card__title' }, r.equipmentName),
        h(
          'div',
          { class: 'small muted' },
          `${r.requesterName} · ${r.requesterDepartment} · “${r.projectTitle}”`,
        ),
      ),
      priorityBadge(r.requesterPriority),
    ),
    h('blockquote', { class: 'card card--flat card--tight small' }, r.justification),
    h(
      'div',
      { class: 'row small muted' },
      badge(r.projectKind ?? 'project', 'violet'),
      h(
        'span',
        null,
        `Deadline ${longDate(r.projectDeadline)}${urgency !== null ? ` (${daysLeftText(urgency)})` : ''}`,
      ),
      h('span', null, `Requests ${r.hoursNeeded} h`),
      h('span', null, `${r.hoursUsedOnProject} h already used`),
      h('span', null, `Valid until ${shortDate(r.validUntil)}`),
    ),
    decisionRow('/api/access-requests', r.id),
  );
}

function bookingCard(b) {
  return h(
    'article',
    { class: 'card stack', 'aria-label': `Booking request: ${b.equipmentName}` },
    h(
      'div',
      { class: 'row row--nowrap' },
      tile({ icon: b.equipmentIcon }, 'sm'),
      h(
        'div',
        { class: 'item__body' },
        h('h3', { class: 'card__title' }, b.equipmentName),
        h('div', { class: 'small muted' }, `${b.userName}${b.projectTitle ? ` · “${b.projectTitle}”` : ''}`),
      ),
      priorityBadge(b.requesterPriority),
    ),
    h(
      'div',
      { class: 'row small' },
      icon('calendar', { size: 16 }),
      `${shortDate(b.date)} · ${range(b.startHour, b.endHour)}`,
      badge(`${b.hours} h`, 'warn'),
      h('span', { class: 'muted' }, 'Longer than the auto-approval limit'),
    ),
    b.purpose && h('blockquote', { class: 'card card--flat card--tight small' }, b.purpose),
    decisionRow('/api/bookings', b.id),
  );
}

export async function approvalsView({ query }) {
  const data = await api.get('/api/approvals');
  let active = query.tab ?? (data.accessRequests.length || !data.bookings.length ? 'access' : 'bookings');
  const tabHost = h('div');
  const body = h('div', { class: 'stack' });
  function paint(focus) {
    replace(
      tabHost,
      tabs(
        [
          ['access', 'Access requests', data.accessRequests.length],
          ['bookings', 'Long bookings', data.bookings.length],
          ['history', 'Recent decisions', data.history.length],
        ],
        active,
        (k, f) => {
          active = k;
          paint(f);
        },
        'Approval queues',
      ),
    );
    if (focus) tabHost.querySelector('[aria-selected="true"]').focus();
    replace(
      body,
      {
        access: () =>
          data.accessRequests.length
            ? h('div', { class: 'grid grid--2' }, data.accessRequests.map(accessCard))
            : emptyState({
                iconName: 'check-circle',
                title: 'No access requests',
                text: 'Students’ project-based requests for your equipment appear here.',
              }),
        bookings: () =>
          data.bookings.length
            ? h('div', { class: 'grid grid--2' }, data.bookings.map(bookingCard))
            : emptyState({
                iconName: 'check-circle',
                title: 'No bookings to approve',
                text: 'Sessions longer than the equipment’s auto-approval limit need your sign-off.',
              }),
        history: () =>
          data.history.length
            ? h(
                'div',
                { class: 'list' },
                data.history.map((r) =>
                  h(
                    'div',
                    { class: 'item' },
                    h(
                      'div',
                      { class: 'item__body' },
                      h('div', { class: 'item__title' }, `${r.equipmentName} · ${r.projectTitle}`),
                      h('div', { class: 'item__meta' }, r.requesterName, r.comment && `“${r.comment}”`),
                    ),
                    badge(r.status, r.status === 'approved' ? 'success' : 'danger'),
                  ),
                ),
              )
            : emptyState({ iconName: 'inbox', title: 'No decisions yet' }),
      }[active](),
    );
  }
  paint();
  return h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page__header' },
      h(
        'div',
        null,
        h('p', { class: 'eyebrow' }, 'Faculty'),
        h('h1', { class: 'page__title', tabindex: '-1' }, 'Approvals'),
        h(
          'p',
          { class: 'page__sub' },
          'Decide on project-based equipment access and long bookings. Priority shows how urgent and fair a request is.',
        ),
      ),
    ),
    tabHost,
    body,
  );
}
