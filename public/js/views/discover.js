import { api, qs } from '../api.js';
import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { equipmentCard } from '../components/equipmentCard.js';
import { announce, emptyState, errorState, skeletonGrid } from '../ui.js';

const SORTS = [
  ['', 'Best match / A–Z'],
  ['soonest', 'Soonest available'],
  ['demand', 'Highest demand'],
];
const EXAMPLES = [
  'capture and decode sensor signals',
  'print a prototype enclosure',
  'train a neural network',
  'measure DNA expression',
  'characterise a 5G antenna',
];

export async function discoverView({ query }) {
  const filters = {
    q: query.q ?? '',
    category: query.category ?? '',
    department: query.department ?? '',
    sort: query.sort ?? '',
    available: query.available === 'true',
    approval: query.approval === 'true',
  };
  const results = h('div', { class: 'stack', 'aria-live': 'polite' });
  const meta = h('div', { class: 'row small muted', role: 'status' });

  const searchInput = h('input', {
    class: 'input',
    id: 'disc-q',
    type: 'search',
    value: filters.q,
    maxlength: '300',
    placeholder: 'Describe your project or need… e.g. “I want to debug an I²C sensor”',
    autocomplete: 'off',
  });
  const chipHost = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by category' });

  async function load() {
    history.replaceState(null, '', `#/discover${qs({ ...filters })}`);
    replace(results, skeletonGrid(6));
    try {
      const data = await api.get(`/api/equipment${qs(filters)}`);
      const { items, query: info } = data;
      replace(
        meta,
        h('span', null, `${items.length} result${items.length === 1 ? '' : 's'}`),
        info.q &&
          h(
            'span',
            { class: 'row' },
            icon('sparkles', { size: 14 }),
            info.aiUsed ? 'Gemini interpreted your request:' : 'Smart search on:',
            info.keywords.length
              ? info.keywords.map((k) => h('span', { class: 'badge badge--violet' }, k))
              : h('em', null, `“${info.q}”`),
          ),
      );
      announce(`${items.length} equipment results`);
      replace(
        results,
        items.length
          ? h('div', { class: 'grid grid--auto' }, items.map(equipmentCard))
          : emptyState({
              iconName: 'search',
              title: 'No equipment matched',
              text: 'Try different words, clear a filter, or ask the Copilot for ideas.',
              action: h(
                'a',
                { class: 'btn btn--primary btn--sm', href: `#/copilot?q=${encodeURIComponent(filters.q)}` },
                'Ask the Copilot',
              ),
            }),
      );
    } catch (err) {
      replace(results, errorState(err, load));
    }
  }

  function paintChips() {
    replace(
      chipHost,
      [['', 'All'], ...state.meta.categories.map((c) => [c, c])].map(([value, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(filters.category === value),
            onclick: () => {
              filters.category = value;
              paintChips();
              load();
            },
          },
          label,
        ),
      ),
    );
  }
  paintChips();

  const dept = h(
    'select',
    {
      class: 'select',
      id: 'disc-dept',
      onchange: (e) => {
        filters.department = e.target.value;
        load();
      },
    },
    h('option', { value: '' }, 'All departments'),
    Object.entries(state.meta.departments).map(([k, v]) =>
      h('option', { value: k, selected: filters.department === k }, v),
    ),
  );
  const sort = h(
    'select',
    {
      class: 'select',
      id: 'disc-sort',
      onchange: (e) => {
        filters.sort = e.target.value;
        load();
      },
    },
    SORTS.map(([v, t]) => h('option', { value: v, selected: filters.sort === v }, t)),
  );
  const toggle = (key, label) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: filters[key],
        onchange: (e) => {
          filters[key] = e.target.checked;
          load();
        },
      }),
      label,
    );

  load();
  return h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page__header' },
      h(
        'div',
        null,
        h('p', { class: 'eyebrow' }, 'Equipment discovery'),
        h('h1', { class: 'page__title', tabindex: '-1' }, 'Find the right equipment'),
        h(
          'p',
          { class: 'page__sub' },
          'Search across every department’s instruments, development kits and workstations — in your own words.',
        ),
      ),
    ),
    h(
      'form',
      {
        class: 'card stack',
        role: 'search',
        onsubmit: (e) => {
          e.preventDefault();
          filters.q = searchInput.value.trim();
          load();
        },
      },
      h(
        'div',
        { class: 'row row--nowrap' },
        h(
          'div',
          { class: 'item__body relative' },
          h('label', { class: 'sr-only', for: 'disc-q' }, 'Describe what you need'),
          searchInput,
        ),
        h('button', { class: 'btn btn--primary', type: 'submit' }, icon('sparkles', { size: 16 }), 'Search'),
      ),
      h(
        'div',
        { class: 'row small muted' },
        'Try:',
        EXAMPLES.map((ex) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              onclick: () => {
                searchInput.value = ex;
                filters.q = ex;
                load();
              },
            },
            ex,
          ),
        ),
      ),
      h('hr', { class: 'divider' }),
      chipHost,
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'disc-dept' }, 'Department'), dept),
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'disc-sort' }, 'Sort by'), sort),
        h(
          'div',
          { class: 'stack stack--sm' },
          toggle('available', 'Bookable now'),
          toggle('approval', 'Needs approval'),
        ),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            onclick: () => {
              history.replaceState(null, '', '#/discover');
              refreshView();
            },
          },
          'Clear filters',
        ),
      ),
    ),
    meta,
    results,
  );

  function refreshView() {
    window.dispatchEvent(new Event('app:refresh'));
  }
}
