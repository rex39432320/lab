import { api, qs } from '../api.js';
import { h, replace } from '../dom.js';
import { STATUS_BADGE, hourLabel, range, relativeDay, shortDate, timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { refreshRoute } from '../router.js';
import { state } from '../state.js';
import {
  badge,
  confirmDialog,
  emptyState,
  field,
  guarded,
  openModal,
  selectInput,
  tabs,
  tile,
  toast,
} from '../ui.js';

const todayDate = () => state.meta.now.date;

function rescheduleModal(b) {
  const hours = Array.from({ length: 12 }, (_, i) => i + 8);
  const date = h('input', {
    class: 'input',
    type: 'date',
    id: 'rs-date',
    value: b.date,
    min: todayDate(),
    required: true,
  });
  const start = selectInput(
    hours.map((x) => [x, hourLabel(x)]),
    b.startHour,
  )('rs-start');
  const end = selectInput(
    hours.map((x) => [x + 1, hourLabel(x + 1)]),
    b.endHour,
  )('rs-end');
  const message = h('div', { role: 'alert' });
  const alternatives = h('div', { class: 'stack stack--sm' });

  async function submit(close) {
    message.replaceChildren();
    alternatives.replaceChildren();
    try {
      await api.post(`/api/bookings/${b.id}/reschedule`, {
        date: date.value,
        startHour: Number(start.value),
        endHour: Number(end.value),
      });
      toast('Your booking has been moved.', { type: 'success' });
      close(true);
      refreshRoute();
    } catch (err) {
      message.append(h('div', { class: 'alert alert--danger' }, icon('alert', { size: 18 }), err.message));
      const picks =
        err.data?.resolution?.options?.filter(
          (o) =>
            o.action.kind === 'book' &&
            o.action.sessions.length === 1 &&
            o.action.sessions[0].equipmentId === b.equipmentId,
        ) ?? [];
      picks.slice(0, 3).forEach((o) => {
        const s = o.action.sessions[0];
        alternatives.append(
          h(
            'div',
            { class: 'option' },
            h(
              'div',
              { class: 'option__body' },
              h('div', { class: 'option__title' }, `${shortDate(s.date)}, ${range(s.startHour, s.endHour)}`),
              h('div', { class: 'option__detail' }, o.detail),
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn--sm',
                onclick: () => {
                  date.value = s.date;
                  start.value = s.startHour;
                  end.value = s.endHour;
                  message.replaceChildren();
                  alternatives.replaceChildren();
                },
              },
              'Use this time',
            ),
          ),
        );
      });
      return false;
    }
  }

  openModal({
    title: `Reschedule ${b.equipmentName}`,
    body: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'form-grid' },
        h('div', { class: 'field full' }, h('label', { class: 'label', for: 'rs-date' }, 'New date'), date),
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'rs-start' }, 'Start'), start),
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'rs-end' }, 'End'), end),
      ),
      message,
      alternatives,
    ),
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Move booking', variant: 'primary', onClick: submit },
    ],
  });
}

/** One booking as a list item with contextual actions. */
export function bookingRow(b, { compact = false } = {}) {
  const [variant, statusText] = STATUS_BADGE[b.status] ?? ['muted', b.status];
  const act = (fn, success) => (e) =>
    guarded(
      async () => {
        await fn();
        refreshRoute();
      },
      { success, button: e.currentTarget },
    );
  const actions = [];
  if (b.canCheckIn)
    actions.push(
      h(
        'button',
        {
          class: 'btn btn--success btn--sm',
          onclick: act(() => api.post(`/api/bookings/${b.id}/check-in`), 'Checked in. Have a great session!'),
        },
        icon('play', { size: 14 }),
        'Check in',
      ),
    );
  if (b.canComplete)
    actions.push(
      h(
        'button',
        {
          class: 'btn btn--sm',
          onclick: act(
            () => api.post(`/api/bookings/${b.id}/complete`),
            'Session ended. Thanks for freeing the equipment.',
          ),
        },
        icon('stop', { size: 14 }),
        'End session',
      ),
    );
  if (!compact && b.mine && ['confirmed', 'pending'].includes(b.status) && b.canCancel) {
    actions.push(
      h(
        'button',
        { class: 'btn btn--sm', onclick: () => rescheduleModal(b) },
        icon('calendar', { size: 14 }),
        'Reschedule',
      ),
    );
  }
  if (!compact && b.canCancel) {
    actions.push(
      h(
        'button',
        {
          class: 'btn btn--danger btn--sm',
          onclick: async (e) => {
            if (
              await confirmDialog({
                title: 'Cancel this booking?',
                message: `${b.equipmentName} on ${shortDate(b.date)}, ${range(b.startHour, b.endHour)} will be released for others.`,
                confirmLabel: 'Cancel booking',
                danger: true,
              })
            )
              act(() => api.post(`/api/bookings/${b.id}/cancel`, {}), 'Booking cancelled.')(e);
          },
        },
        icon('x', { size: 14 }),
        'Cancel',
      ),
    );
  }
  return h(
    'div',
    { class: 'item' },
    tile({ icon: b.equipmentIcon, category: '' }, 'sm'),
    h(
      'div',
      { class: 'item__body' },
      h(
        'div',
        { class: 'item__title' },
        h('a', { href: `#/equipment/${b.equipmentId}`, class: 'strong' }, b.equipmentName),
      ),
      h(
        'div',
        { class: 'item__meta' },
        h('span', null, `${relativeDay(b.date, todayDate())} · ${range(b.startHour, b.endHour)}`),
        b.location && h('span', null, b.location),
        b.projectTitle && !compact && h('span', null, b.projectTitle),
        b.userName && !b.mine && h('span', null, b.userName),
      ),
      b.cancelReason && h('div', { class: 'xs faint' }, b.cancelReason),
    ),
    h(
      'div',
      { class: 'row' },
      b.flexible && b.status === 'confirmed' && badge('Flexible', 'warn', 'swap'),
      badge(statusText, variant),
    ),
    actions.length > 0 && h('div', { class: 'row' }, actions),
  );
}

function swapRow(s) {
  const incoming = s.direction === 'incoming';
  const respond = (accept) => (e) =>
    guarded(
      async () => {
        await api.post(`/api/swaps/${s.id}/respond`, { accept });
        refreshRoute();
      },
      {
        success: accept ? 'Swap accepted. You earned goodwill credit.' : 'Swap declined.',
        button: e.currentTarget,
      },
    );
  return h(
    'div',
    { class: `item ${incoming ? 'item--action' : ''}` },
    h('div', { class: 'option__icon' }, icon('swap')),
    h(
      'div',
      { class: 'item__body' },
      h(
        'div',
        { class: 'item__title' },
        incoming ? `${s.requesterName}’s project is asking you to move` : 'Waiting for the holder to respond',
      ),
      h(
        'div',
        { class: 'item__meta' },
        h('span', null, `${s.equipmentName}`),
        h('span', null, `Priority ${s.requesterPriority} vs ${s.holderPriority}`),
        h('span', null, `Requested ${timeAgo(s.createdAt)}`),
      ),
      incoming &&
        s.yourCurrent &&
        h(
          'div',
          { class: 'small' },
          `You hold ${shortDate(s.yourCurrent.date)}, ${range(s.yourCurrent.startHour, s.yourCurrent.endHour)}. Proposed new slot: `,
          h(
            'strong',
            null,
            `${shortDate(s.proposedMove.date)}, ${range(s.proposedMove.startHour, s.proposedMove.endHour)}`,
          ),
        ),
      s.reason && h('div', { class: 'small muted' }, `“${s.reason}”`),
    ),
    incoming
      ? h(
          'div',
          { class: 'row' },
          h(
            'button',
            { class: 'btn btn--success btn--sm', onclick: respond(true) },
            icon('check', { size: 14 }),
            'Accept & move',
          ),
          h('button', { class: 'btn btn--sm', onclick: respond(false) }, 'Keep my slot'),
        )
      : badge('Pending', 'warn'),
  );
}

export async function bookingsView({ query }) {
  const [{ items }, waitlist, swaps] = await Promise.all([
    api.get(`/api/bookings${qs({ scope: 'mine' })}`),
    api.get('/api/waitlist'),
    api.get('/api/swaps'),
  ]);
  const today = todayDate();
  const isUpcoming = (b) =>
    ['pending', 'confirmed', 'checked_in'].includes(b.status) &&
    (b.date > today || (b.date === today && b.endHour > state.meta.now.hour));
  const upcoming = items.filter(isUpcoming);
  const past = items.filter((b) => !isUpcoming(b)).reverse();
  const incoming = swaps.items.filter((s) => s.direction === 'incoming');
  let active = query.tab ?? (incoming.length ? 'swaps' : 'upcoming');
  const body = h('div', { class: 'stack' });
  const tabHost = h('div');

  function paint(focusTab) {
    replace(
      tabHost,
      tabs(
        [
          ['upcoming', 'Upcoming', upcoming.length],
          ['past', 'History', past.length],
          ['waitlist', 'Waitlist', waitlist.items.length],
          ['swaps', 'Swap requests', swaps.items.length],
        ],
        active,
        (key, focus) => {
          active = key;
          paint(focus);
        },
        'Booking views',
      ),
    );
    if (focusTab) tabHost.querySelector('[aria-selected="true"]').focus();
    const panel = {
      upcoming: () =>
        upcoming.length
          ? h(
              'div',
              { class: 'list' },
              upcoming.map((b) => bookingRow(b)),
            )
          : emptyState({
              iconName: 'calendar',
              title: 'No upcoming bookings',
              text: 'Book a slot from any equipment page, or let the Smart Planner schedule your hours.',
              action: h('a', { class: 'btn btn--primary btn--sm', href: '#/discover' }, 'Browse equipment'),
            }),
      past: () =>
        past.length
          ? h(
              'div',
              { class: 'list' },
              past.slice(0, 40).map((b) => bookingRow(b, { compact: true })),
            )
          : emptyState({
              iconName: 'clock',
              title: 'No history yet',
              text: 'Completed and cancelled sessions appear here.',
            }),
      waitlist: () =>
        waitlist.items.length
          ? h(
              'div',
              { class: 'list' },
              waitlist.items.map((w) =>
                h(
                  'div',
                  { class: 'item' },
                  h('div', { class: 'option__icon' }, icon('hourglass')),
                  h(
                    'div',
                    { class: 'item__body' },
                    h('div', { class: 'item__title' }, w.equipmentName),
                    h(
                      'div',
                      { class: 'item__meta' },
                      `${shortDate(w.date)} · ${range(w.startHour, w.endHour)}`,
                      h('span', null, 'Auto-books if the slot frees up'),
                    ),
                  ),
                  h(
                    'button',
                    {
                      class: 'btn btn--sm',
                      onclick: (e) =>
                        guarded(
                          async () => {
                            await api.delete(`/api/waitlist/${w.id}`);
                            refreshRoute();
                          },
                          { success: 'Removed from waitlist.', button: e.currentTarget },
                        ),
                    },
                    'Leave',
                  ),
                ),
              ),
            )
          : emptyState({
              iconName: 'hourglass',
              title: 'You are not on any waitlist',
              text: 'When a slot you need is taken, join the waitlist and LabLink books it for you if it opens up.',
            }),
      swaps: () =>
        swaps.items.length
          ? h('div', { class: 'list' }, swaps.items.map(swapRow))
          : emptyState({
              iconName: 'swap',
              title: 'No swap requests',
              text: 'If a project with a closer deadline needs your flexible slot, the request appears here.',
            }),
    }[active]();
    replace(body, panel);
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
        h('p', { class: 'eyebrow' }, 'Schedule'),
        h('h1', { class: 'page__title', tabindex: '-1' }, 'My bookings'),
        h('p', { class: 'page__sub' }, 'Check in to your sessions, move them, or release them for others.'),
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'a',
          { class: 'btn', href: '/api/bookings/calendar.ics', download: 'lablink-bookings.ics' },
          icon('download', { size: 18 }),
          'Export to calendar (.ics)',
        ),
        h('a', { class: 'btn btn--primary', href: '#/discover' }, icon('plus', { size: 18 }), 'New booking'),
      ),
    ),
    incoming.length > 0 &&
      active !== 'swaps' &&
      h(
        'div',
        { class: 'alert alert--warn', role: 'status' },
        icon('swap'),
        h(
          'div',
          null,
          h('strong', null, `${incoming.length} swap request${incoming.length > 1 ? 's' : ''} waiting. `),
          'A project with a closer deadline needs one of your flexible slots. ',
          h(
            'button',
            {
              class: 'btn btn--sm',
              onclick: () => {
                active = 'swaps';
                paint();
              },
            },
            'Review',
          ),
        ),
      ),
    tabHost,
    body,
  );
}
