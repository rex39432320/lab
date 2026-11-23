// The conflict-resolution UI: explains why a request failed, shows the user's
// fair-share priority breakdown, and offers ranked, one-click alternatives.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { badge } from '../ui.js';

const OPTION_META = {
  alt_slot: ['calendar-check', 'Nearby slot'],
  alt_equipment: ['chip', 'Equivalent equipment'],
  split: ['clock', 'Split session'],
  swap: ['swap', 'Fair-share swap'],
  waitlist: ['hourglass', 'Waitlist'],
};
const ACTION_LABEL = { book: 'Book this', swap: 'Ask to swap', request_access: 'Request access', waitlist: 'Join waitlist' };

function priorityBlock(requester) {
  return h('details', { class: 'card card--flat card--tight' },
    h('summary', { class: 'row' },
      h('span', { class: 'score', 'aria-hidden': 'true' }, requester.score),
      h('span', null, h('strong', null, `Your fair-share priority: ${requester.score}/100`),
        h('span', { class: 'small muted' }, ' — tap to see how it is calculated'))),
    h('div', { class: 'stack stack--sm' }, requester.breakdown.map((f) =>
      h('div', { class: 'factor' },
        h('span', null, f.label),
        h('div', { class: 'progress', role: 'img', 'aria-label': `${f.label}: ${Math.round(f.value * 100)} percent` }, h('div', { class: 'progress__bar', vars: { '--pct': `${f.value * 100}%` } })),
        h('span', { class: 'strong right' }, `+${f.points}`),
        h('span', { class: 'factor__note' }, f.note)))));
}

/**
 * @param {object} resolution  server resolution payload
 * @param {(option: object, button: HTMLButtonElement) => void} onAction
 */
export function resolutionPanel(resolution, onAction) {
  const blocking = resolution.errors.filter((e) => e.code !== 'CONFLICT');
  const conflict = resolution.errors.some((e) => e.code === 'CONFLICT');
  const best = resolution.options.find((o) => o.type !== 'waitlist');
  return h('section', { class: 'card card--warn stack', 'aria-labelledby': 'res-title', tabindex: '-1', id: 'resolution' },
    h('div', { class: 'row row--nowrap' }, icon('sparkles', { size: 22 }),
      h('div', null, h('h3', { id: 'res-title' }, conflict ? 'That slot is taken — here are your best options' : 'That request can’t go ahead as asked'),
        h('p', { class: 'small muted' }, resolution.requested.label))),
    h('p', null, resolution.summary),
    h('span', { class: 'ai-tag' }, icon('sparkles', { size: 14 }), resolution.summarySource === 'gemini' ? 'Explained by Gemini' : 'Explained by the rule-based engine'),
    blocking.length > 0 && h('div', { class: 'stack stack--sm' }, blocking.map((e) => h('div', { class: 'alert alert--danger', role: 'alert' }, icon('alert', { size: 18 }), e.message))),
    resolution.conflicts.length > 0 && h('div', { class: 'small muted' }, `Conflicting booking${resolution.conflicts.length > 1 ? 's' : ''}: `,
      resolution.conflicts.map((c) => `${c.label}${c.holder ? ` (${c.holder})` : ''}${c.flexible ? ' · flexible' : ''}`).join('; ')),
    priorityBlock(resolution.requester),
    h('div', { class: 'stack stack--sm', role: 'list', 'aria-label': 'Suggested options' }, resolution.options.map((opt) => {
      const [iconName, kind] = opt.action.kind === 'request_access' ? ['lock', 'Access needed'] : OPTION_META[opt.type] ?? ['sparkles', 'Option'];
      return h('div', { class: `option ${opt === best ? 'option--best' : ''}`, role: 'listitem' },
        h('div', { class: 'option__icon' }, icon(iconName)),
        h('div', { class: 'option__body' },
          h('div', { class: 'row' }, h('span', { class: 'option__title' }, opt.title), opt === best && badge('Best match', 'violet', 'star'), badge(kind)),
          h('div', { class: 'option__detail' }, opt.detail)),
        h('button', { class: `btn btn--sm ${opt === best ? 'btn--primary' : ''}`, onclick: (e) => onAction(opt, e.currentTarget) }, ACTION_LABEL[opt.action.kind]));
    })));
}
