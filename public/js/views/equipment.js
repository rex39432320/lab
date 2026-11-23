// Equipment detail: accessible weekly calendar, live validation, conflict
// resolution and project-based access requests.
import { api, qs } from '../api.js';
import { equipmentCard, accessBadge } from '../components/equipmentCard.js';
import { resolutionPanel } from '../components/resolutionPanel.js';
import { debounce, h, replace } from '../dom.js';
import { addDays, dow, hourLabel, range, relativeDay, shortDate, weekStart } from '../format.js';
import { icon } from '../icons.js';
import { go, refreshRoute } from '../router.js';
import { isStaff, state } from '../state.js';
import { badge, emptyState, field, guarded, openModal, tile, toast, uid } from '../ui.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function accessRequestModal({ equipmentId, equipmentName, projects, projectId }) {
  const project = h('select', { class: 'select', id: 'ar-project' }, projects.map((p) => h('option', { value: p.id, selected: p.id === projectId }, p.title)));
  const why = h('textarea', { class: 'textarea', id: 'ar-why', required: true, minlength: '10', maxlength: '400', placeholder: 'What will you do with it, and why does your project need it?' });
  const hours = h('input', { class: 'input', id: 'ar-hours', type: 'number', min: '1', max: '200', value: '6' });
  const message = h('div', { role: 'alert' });
  openModal({
    title: `Request access to ${equipmentName}`,
    description: 'Faculty review requests per project. Approval covers every team member until shortly after your deadline.',
    body: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'ar-project' }, 'Project'), project),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'ar-why' }, 'Justification'), why),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'ar-hours' }, 'Estimated hours needed'), hours), message),
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Send request', variant: 'primary',
      onClick: async (close) => {
        message.replaceChildren();
        try {
          await api.post('/api/access-requests', { projectId: project.value, equipmentId, justification: why.value, hoursNeeded: Number(hours.value) });
          toast('Your guide and the equipment custodian have been notified.', { type: 'success', title: 'Request sent' });
          close(true);
          refreshRoute();
        } catch (err) {
          message.append(h('div', { class: 'alert alert--danger' }, icon('alert', { size: 18 }), err.message));
          return false;
        }
      },
    }],
  });
}

export async function equipmentView({ params, query }) {
  const { equipment: eq } = await api.get(`/api/equipment/${params.id}`);
  const today = state.meta.now.date;
  const maxWeeks = Math.ceil(state.meta.bookingWindowDays / 7);
  const firstWeek = weekStart(today);
  let week = weekStart(query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : today);
  let sel = query.date && query.start ? { date: query.date, from: Number(query.start), to: Number(query.end ?? Number(query.start) + 1) - 1, anchor: null } : null;
  let days = [];
  let validation = null;
  let focusKey = null;
  let userPicked = false;

  const calHost = h('div');
  const weekLabel = h('strong', { 'aria-live': 'polite' });
  const panelHost = h('div', { class: 'stack' });
  const resolutionHost = h('div');
  const projectSel = h('select', { class: 'select', id: 'bk-project' });
  const purpose = h('input', { class: 'input', id: 'bk-purpose', maxlength: '280', placeholder: 'What will you work on?' });
  const flexible = h('input', { type: 'checkbox', id: 'bk-flex' });
  const canBook = eq.status === 'available';
  const privileged = isStaff();

  if (eq.bookableProjects.length) {
    projectSel.append(...(!eq.requiresApproval || privileged ? [h('option', { value: '' }, privileged ? '— No project —' : '— No project (personal use) —')] : []), ...eq.bookableProjects.map((p) => h('option', { value: p.id }, p.title)));
  } else {
    projectSel.append(h('option', { value: '' }, '— No project —'));
  }

  const selRange = () => (sel ? { start: sel.from, end: sel.to + 1 } : null);
  const payload = () => ({ equipmentId: eq.id, projectId: projectSel.value || undefined, date: sel.date, startHour: sel.from, endHour: sel.to + 1, purpose: purpose.value || undefined });

  async function loadWeek() {
    replace(calHost, h('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading calendar' }, h('div', { class: 'skeleton--card' })));
    try {
      const data = await api.get(`/api/equipment/${eq.id}/availability${qs({ from: week, days: 7 })}`);
      days = data.days;
      paintCalendar();
    } catch (err) {
      replace(calHost, h('div', { class: 'alert alert--danger', role: 'alert' }, err.message));
    }
  }

  function slotClass(day, slot) {
    const picked = sel && sel.date === day.date && slot.hour >= sel.from && slot.hour <= sel.to;
    const b = slot.booking;
    const classes = ['slot'];
    if (slot.state === 'free') classes.push('slot--free');
    else if (slot.state === 'booked') classes.push(b.mine ? 'slot--mine' : b.status === 'pending' ? 'slot--pending' : 'slot--booked', b.flexible && !b.mine && 'slot--flex');
    else classes.push(`slot--${slot.state === 'past-booked' ? 'past' : slot.state}`);
    if (picked) classes.push('slot--selected');
    return classes.filter(Boolean).join(' ');
  }

  const stateText = (slot) => ({
    free: 'free', booked: slot.booking?.mine ? 'your booking' : `booked${slot.booking?.flexible ? ', holder is flexible' : ''}${slot.booking?.status === 'pending' ? ', awaiting approval' : ''}`,
    past: 'in the past', 'past-booked': 'in the past', closed: 'closed', maintenance: 'out of service',
  }[slot.state]);

  function paintCalendar() {
    weekLabel.textContent = `${shortDate(week)} – ${shortDate(addDays(week, 6))}`;
    const hours = Array.from({ length: eq.closeHour - eq.openHour }, (_, i) => eq.openHour + i);
    const grid = h('div', { class: 'cal__grid', role: 'group', 'aria-label': `Weekly availability for ${eq.name}. Use arrow keys to move between slots; press Enter to pick a start, then an end hour.` },
      h('div', { class: 'cal__corner' }),
      days.map((d) => h('div', { class: `cal__dayhead ${d.date === today ? 'cal__dayhead--today' : ''}` }, h('strong', null, WEEKDAYS[d.dow]), h('span', null, `${+d.date.slice(8)} ${shortDate(d.date).split(' ')[2]}`))),
      hours.map((hr, r) => [
        h('div', { class: 'cal__time', 'aria-hidden': 'true' }, hourLabel(hr)),
        days.map((d, c) => {
          const slot = d.slots[r];
          const selectable = ['free', 'booked'].includes(slot.state) && !slot.booking?.mine && canBook;
          const key = `${c}:${r}`;
          return h('button', {
            type: 'button', class: slotClass(d, slot), tabindex: (focusKey ? focusKey === key : r === 0 && c === days.findIndex((x) => x.date >= today) % 7) ? '0' : '-1',
            dataset: { c, r, key }, 'aria-disabled': selectable ? undefined : 'true',
            'aria-pressed': sel && sel.date === d.date && slot.hour >= sel.from && slot.hour <= sel.to ? 'true' : 'false',
            'aria-label': `${WEEKDAYS[d.dow]} ${shortDate(d.date)}, ${hourLabel(slot.hour)}: ${stateText(slot)}`,
            title: slot.booking?.flexible && !slot.booking.mine ? 'Booked, but the holder marked this slot as flexible' : undefined,
            onclick: () => selectable && pick(d.date, slot.hour),
            onfocus: () => { focusKey = key; },
          }, slot.state === 'booked' ? (slot.booking.mine ? 'You' : slot.booking.status === 'pending' ? 'Pending' : 'Booked') : slot.state === 'free' ? '' : slot.state === 'closed' ? '—' : '');
        }),
      ]));
    grid.addEventListener('keydown', (e) => {
      const el = e.target.closest('.slot');
      const move = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
      if (!el || !move) return;
      e.preventDefault();
      const next = grid.querySelector(`[data-c="${+el.dataset.c + move[0]}"][data-r="${+el.dataset.r + move[1]}"]`);
      if (next) { el.tabIndex = -1; next.tabIndex = 0; next.focus(); }
    });
    replace(calHost, h('div', { class: 'cal' }, grid));
  }

  function pick(date, hour) {
    if (!sel || sel.anchor === null || sel.date !== date) sel = { date, from: hour, to: hour, anchor: hour };
    else sel = { date, from: Math.min(sel.anchor, hour), to: Math.max(sel.anchor, hour), anchor: null };
    paintCalendar();
    focusKey && grid_focus();
    paintPanel();
    userPicked = true;
    runValidation();
  }
  function grid_focus() { calHost.querySelector(`[data-key="${focusKey}"]`)?.focus(); }

  const runValidation = debounce(async () => {
    if (!sel || sel.anchor !== null) { validation = null; return paintPanel(); }
    validation = { loading: true };
    paintPanel();
    try {
      validation = await api.post('/api/bookings/check', payload());
    } catch (err) {
      validation = { valid: false, error: err.message };
    }
    paintPanel();
    if (validation.resolution) {
      replace(resolutionHost, resolutionPanel(validation.resolution, handleOption));
      if (userPicked) resolutionHost.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    } else replace(resolutionHost);
    userPicked = false;
  }, 220);

  async function handleOption(option, button) {
    const a = option.action;
    if (a.kind === 'book') {
      await guarded(async () => {
        await api.post('/api/bookings/commit', { sessions: a.sessions, flexible: flexible.checked, purpose: purpose.value || undefined });
        if (a.sessions[0].equipmentId !== eq.id) go('/bookings'); else { sel = null; refreshRoute(); }
      }, { success: a.sessions.length > 1 ? `Booked ${a.sessions.length} sessions.` : 'Booked! See it under My Bookings.', button, busy: 'Booking…' });
    } else if (a.kind === 'waitlist') {
      await guarded(async () => { await api.post('/api/waitlist', a.request); refreshRoute(); }, { success: 'You are on the waitlist. We will book it automatically if it frees up.', button });
    } else if (a.kind === 'swap') {
      const msg = h('textarea', { class: 'textarea', id: 'sw-msg', maxlength: '200', placeholder: 'Optional note to the holder, e.g. “Spectrum mask test due Friday.”' });
      const res = await openModal({
        title: 'Ask the holder to swap',
        description: 'They keep the choice: they can accept (and move to a nearby slot) or decline. Declining adds you to the waitlist automatically.',
        body: h('div', { class: 'field' }, h('label', { class: 'label', for: 'sw-msg' }, 'Message (optional)'), msg),
        actions: [{ label: 'Cancel', value: null }, { label: 'Send swap request', variant: 'primary', value: 'send' }],
      }).promise;
      if (res === 'send') await guarded(async () => { await api.post('/api/swaps', { targetBookingId: a.targetBookingId, request: a.request, message: msg.value || undefined }); refreshRoute(); }, { success: 'Swap request sent. You will be notified when they respond.' });
    } else if (a.kind === 'request_access') {
      const { equipment } = await api.get(`/api/equipment/${a.equipmentId}`);
      accessRequestModal({ equipmentId: a.equipmentId, equipmentName: equipment.name, projects: equipment.projectsNeedingAccess.filter((p) => !p.pending).map((p) => ({ id: p.id, title: p.title })), projectId: a.projectId });
    }
  }

  function paintPanel() {
    const r = selRange();
    const status = !sel ? null : sel.anchor !== null ? h('div', { class: 'alert alert--info', role: 'status' }, icon('info', { size: 18 }), `Start: ${hourLabel(sel.from)}. Now pick the last hour you need (or press Enter again on the same slot for 1 hour).`)
      : validation?.loading ? h('div', { class: 'small muted', role: 'status' }, 'Checking availability…')
        : validation?.valid ? h('div', { class: 'stack stack--sm', role: 'status' },
          h('div', { class: 'alert alert--success' }, icon('check-circle', { size: 18 }), `Available · ${validation.hours} h`),
          validation.priority && h('div', { class: 'small muted' }, `Your fair-share priority here: ${validation.priority.score}/100`),
          validation.warnings.map((w) => h('div', { class: 'alert alert--warn' }, icon('alert', { size: 18 }), w)))
          : validation && h('div', { class: 'alert alert--danger', role: 'alert' }, icon('alert', { size: 18 }), validation.error ?? (validation.errors?.some((e) => e.code === 'CONFLICT') ? 'That slot is already taken — fair alternatives are listed below.' : validation.errors?.[0]?.message ?? 'This request needs attention.'));
    const ready = canBook && sel && sel.anchor === null && validation?.valid;
    replace(panelHost,
      h('div', { class: 'row' }, h('strong', null, r ? `${relativeDay(sel.date, today)} · ${range(r.start, r.end)}` : 'Pick a time on the calendar'), r && h('span', { class: 'badge' }, `${r.end - r.start} h`)),
      status,
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'bk-project' }, eq.requiresApproval && !privileged ? 'Project (approved access required)' : 'Project'), projectSel),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'bk-purpose' }, 'Purpose'), purpose),
      h('label', { class: 'check' }, flexible, h('span', null, h('strong', null, 'I’m flexible'), h('span', { class: 'hint' }, ' — allow a higher-priority project to ask me to move. Accepting a swap earns goodwill credit.'))),
      h('button', { class: 'btn btn--primary btn--lg btn--block', disabled: !ready, onclick: async (e) => {
        await guarded(async () => {
          const res = await api.post('/api/bookings', { ...payload(), flexible: flexible.checked });
          sel = null; validation = null;
          toast(res.needsApproval ? 'Sent to your guide for approval because it is a long session.' : 'Booking confirmed. See it under My Bookings.', { type: 'success', title: res.needsApproval ? 'Awaiting approval' : 'Booked' });
          refreshRoute();
        }, { button: e.currentTarget, busy: 'Booking…' });
      } }, icon('calendar-check', { size: 18 }), ready ? `Confirm booking · ${r.end - r.start} h` : 'Select an available time'));
  }
  projectSel.addEventListener('change', () => sel && runValidation());

  const accessCard = eq.requiresApproval && !privileged && eq.access !== 'granted' && h('section', { class: 'card card--accent stack', 'aria-labelledby': 'acc-h' },
    h('div', { class: 'row' }, icon('lock', { size: 22 }), h('div', null, h('h2', { class: 'card__title', id: 'acc-h' }, 'Faculty approval required'), h('p', { class: 'small muted' }, 'Access is granted per project by the equipment custodian or your project guide.'))),
    eq.projectsNeedingAccess.length
      ? h('div', { class: 'stack stack--sm' }, eq.projectsNeedingAccess.map((p) => h('div', { class: 'item' }, h('div', { class: 'item__body strong' }, p.title),
        p.pending ? badge('Request pending', 'warn', 'hourglass') : h('button', { class: 'btn btn--primary btn--sm', onclick: () => accessRequestModal({ equipmentId: eq.id, equipmentName: eq.name, projects: [{ id: p.id, title: p.title }], projectId: p.id }) }, 'Request access'))))
      : h('div', { class: 'stack stack--sm' }, h('p', { class: 'small' }, 'Create a project first — restricted equipment is allocated to projects, which also raises your scheduling priority.'), h('a', { class: 'btn btn--primary btn--sm', href: '#/projects' }, 'Create a project')));

  const nav = h('div', { class: 'row' },
    h('button', { class: 'btn btn--sm', disabled: week <= firstWeek, 'aria-label': 'Previous week', onclick: () => { week = addDays(week, -7); sel = null; loadWeek(); paintPanel(); } }, icon('chevron-left', { size: 16 })),
    weekLabel,
    h('button', { class: 'btn btn--sm', 'aria-label': 'Next week', onclick: () => { if (addDays(week, 7) <= addDays(firstWeek, 7 * (maxWeeks - 1))) { week = addDays(week, 7); sel = null; loadWeek(); paintPanel(); } else toast(`You can book up to ${state.meta.bookingWindowDays} days ahead.`, { type: 'info' }); } }, icon('chevron-right', { size: 16 })),
    h('button', { class: 'btn btn--ghost btn--sm', onclick: () => { week = firstWeek; loadWeek(); } }, 'This week'));

  loadWeek();
  paintPanel();
  if (sel) runValidation();

  const specsId = uid('specs');
  return h('div', { class: 'page' },
    h('nav', { 'aria-label': 'Breadcrumb', class: 'small' }, h('a', { href: '#/discover' }, 'Discover'), ' / ', eq.name),
    h('header', { class: 'page__header' },
      h('div', { class: 'row row--nowrap' }, tile(eq, 'lg'),
        h('div', null, h('h1', { class: 'page__title', tabindex: '-1' }, eq.name),
          h('div', { class: 'row small muted' }, icon('map', { size: 15 }), h('span', null, eq.location), h('span', null, `Custodian: ${eq.custodian}`)))),
      h('div', { class: 'row' }, badge(eq.category), eq.status === 'available' ? badge('Available', 'success', 'check-circle') : badge('Under maintenance', 'warn', 'wrench'), accessBadge(eq.access))),
    eq.status !== 'available' && h('div', { class: 'alert alert--warn', role: 'status' }, icon('wrench'), 'This equipment is out of service. Browse the similar equipment below, or join its waitlist once it returns.'),
    accessCard,
    h('div', { class: 'grid grid--split' },
      h('div', { class: 'stack' },
        h('section', { class: 'card stack', 'aria-labelledby': 'cal-h' },
          h('div', { class: 'card__head' }, h('h2', { class: 'card__title', id: 'cal-h' }, 'Availability'), h('span', { class: 'spacer' }), nav),
          calHost,
          h('div', { class: 'legend', 'aria-label': 'Calendar legend' },
            h('span', null, h('i', { class: 'l-free' }), 'Free'), h('span', null, h('i', { class: 'l-booked' }), 'Booked'), h('span', null, h('i', { class: 'l-flex' }), 'Booked, flexible'), h('span', null, h('i', { class: 'l-mine' }), 'Yours'), h('span', null, h('i', { class: 'l-sel' }), 'Selected')),
          h('p', { class: 'hint' }, 'Tip: you can select a booked slot too — LabLink will explain the conflict and suggest fair alternatives.')),
        h('div', { id: 'resolution-host' }, resolutionHost),
        h('section', { class: 'card stack', 'aria-labelledby': specsId },
          h('h2', { class: 'card__title', id: specsId }, 'About this equipment'),
          h('p', { class: 'muted' }, eq.description),
          h('ul', { class: 'stack stack--sm' }, eq.specs.map((s) => h('li', { class: 'row row--nowrap small' }, icon('check', { size: 16 }), s))),
          h('div', { class: 'chips' }, eq.tags.map((t) => h('span', { class: 'tag' }, `#${t}`))),
          h('hr', { class: 'divider' }),
          h('div', { class: 'grid grid--3' },
            h('div', null, h('div', { class: 'xs faint' }, 'Lab hours'), h('strong', null, `${hourLabel(eq.openHour)} – ${hourLabel(eq.closeHour)}`)),
            h('div', null, h('div', { class: 'xs faint' }, 'Max per booking'), h('strong', null, `${eq.maxHoursPerBooking} h`)),
            h('div', null, h('div', { class: 'xs faint' }, 'Auto-approved up to'), h('strong', null, `${eq.autoApproveHours} h`))))),
      h('aside', { class: 'sticky stack', 'aria-label': 'Booking' },
        h('section', { class: 'card stack', 'aria-labelledby': 'bk-h' }, h('h2', { class: 'card__title', id: 'bk-h' }, canBook ? 'Book a slot' : 'Booking unavailable'), canBook ? panelHost : emptyState({ iconName: 'wrench', title: 'Out of service', text: 'We will notify users when it returns.' })),
        h('section', { class: 'card stack stack--sm' }, h('div', { class: 'row' }, icon('trend', { size: 18 }), h('strong', null, 'Demand')), h('p', { class: 'small muted' }, `${eq.demand}% booked over the next 7 days · ${eq.bookingsLast30} bookings in the last 30 days.`)))),
    eq.similar.length > 0 && h('section', { class: 'stack', 'aria-labelledby': 'sim-h' },
      h('h2', { class: 'card__title', id: 'sim-h' }, 'Similar equipment — good alternatives when this one is busy'),
      h('div', { class: 'grid grid--auto' }, eq.similar.map(equipmentCard))));
}
