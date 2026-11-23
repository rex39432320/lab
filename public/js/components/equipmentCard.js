import { h } from '../dom.js';
import { hourLabel, relativeDay } from '../format.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { badge, progress, tile } from '../ui.js';

const ACCESS = {
  open: ['Open access', 'success', 'unlock'],
  granted: ['Access granted', 'success', 'check-circle'],
  pending: ['Access pending', 'warn', 'hourglass'],
  required: ['Needs approval', 'violet', 'lock'],
};

export const accessBadge = (access) => {
  const [text, variant, iconName] = ACCESS[access] ?? ACCESS.open;
  return badge(text, variant, iconName);
};

export function nextFreeText(slot) {
  return slot ? `${relativeDay(slot.date, state.meta.now.date)}, ${hourLabel(slot.startHour)}` : 'No free slot soon';
}

export function equipmentCard(eq) {
  const demandVariant = eq.demand >= 75 ? 'danger' : eq.demand >= 45 ? 'warn' : 'success';
  const available = eq.status === 'available';
  return h('a', { class: 'card card--hover eq-card', href: `#/equipment/${eq.id}`, 'aria-label': `${eq.name}, ${available ? 'available' : 'out of service'}` },
    h('div', { class: 'eq-card__top' }, tile(eq),
      h('div', { class: 'item__body' },
        h('div', { class: 'eq-card__name' }, eq.name),
        h('div', { class: 'eq-card__loc' }, icon('map', { size: 14 }), eq.location)),
      available ? badge(eq.category.split(' ')[0], '') : badge('Maintenance', 'warn', 'wrench')),
    h('p', { class: 'eq-card__desc' }, eq.description),
    eq.matched?.length > 0 && h('div', { class: 'why' }, icon('sparkles', { size: 14 }), 'Matched:', eq.matched.slice(0, 4).map((m) => h('mark', null, m))),
    h('div', { class: 'eq-card__foot' },
      h('div', { class: 'row' }, accessBadge(eq.access), eq.requiresApproval && eq.access === 'open' && badge('Restricted', 'violet', 'lock')),
      h('div', null,
        h('div', { class: 'row xs faint' }, h('span', null, 'Demand, next 7 days'), h('span', { class: 'spacer' }), `${eq.demand}%`),
        progress(eq.demand, demandVariant, `Demand ${eq.demand} percent`)),
      h('div', { class: 'row small' }, icon('clock', { size: 15 }), h('span', { class: 'muted' }, available ? `Next free: ${nextFreeText(eq.nextFree)}` : 'Not bookable right now'))));
}
