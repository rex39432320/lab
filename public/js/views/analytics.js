// Utilisation analytics for faculty and lab coordinators.
import { api } from '../api.js';
import { barList, dailyChart, heatmap } from '../components/charts.js';
import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { emptyState, tile } from '../ui.js';

const INSIGHT_ICON = { hot: 'trend', idle: 'hourglass', maintenance: 'wrench', noshow: 'alert' };

function kpi(label, iconName, value, suffix, note) {
  return h(
    'div',
    { class: 'card kpi' },
    h('div', { class: 'kpi__label' }, icon(iconName, { size: 16 }), label),
    h('div', { class: 'kpi__value' }, value, suffix && h('small', null, ` ${suffix}`)),
    h('div', { class: 'kpi__note' }, note),
  );
}

function toCsv(rows) {
  const esc = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const lines = [
    [
      'Equipment',
      'Category',
      'Department',
      'Status',
      'Utilisation %',
      'Booked hours',
      'Capacity hours',
      'Bookings',
    ]
      .map(esc)
      .join(','),
  ];
  for (const r of rows)
    lines.push(
      [r.name, r.category, r.department, r.status, r.utilization, r.hours, r.capacity, r.bookings]
        .map(esc)
        .join(','),
    );
  return lines.join('\n');
}

export async function analyticsView() {
  const data = await api.get('/api/analytics/overview');
  const k = data.kpis;
  let category = '';
  const listHost = h('div');

  function paintList() {
    const rows = data.perEquipment.filter((e) => !category || e.category === category).slice(0, 14);
    replace(
      listHost,
      rows.length
        ? barList(
            rows.map((e) => ({ label: e.name, value: e.utilization, id: e.id, lead: tile(e, 'sm') })),
            { href: (r) => `#/equipment/${r.id}` },
          )
        : emptyState({ title: 'No equipment in this category' }),
    );
  }
  paintList();

  const catSelect = h(
    'select',
    {
      class: 'select',
      id: 'an-cat',
      'aria-label': 'Filter by category',
      onchange: (e) => {
        category = e.target.value;
        paintList();
      },
    },
    h('option', { value: '' }, 'All categories'),
    state.meta.categories.map((c) => h('option', { value: c }, c)),
  );

  return h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page__header' },
      h(
        'div',
        null,
        h('p', { class: 'eyebrow' }, 'Resource utilisation'),
        h('h1', { class: 'page__title', tabindex: '-1' }, 'Lab analytics'),
        h(
          'p',
          { class: 'page__sub' },
          'See which equipment is overloaded or idle across departments, and where to steer demand. Based on the last 14 days of confirmed usage.',
        ),
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            const url = URL.createObjectURL(new Blob([toCsv(data.perEquipment)], { type: 'text/csv' }));
            const a = h('a', { href: url, download: 'lablink-utilisation.csv' });
            document.body.append(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          },
        },
        icon('download', { size: 18 }),
        'Export CSV',
      ),
    ),
    h(
      'div',
      { class: 'grid grid--4' },
      kpi(
        'Overall utilisation',
        'gauge',
        `${k.utilization}%`,
        '',
        `${k.available} of ${k.equipment} instruments bookable`,
      ),
      kpi('Hours shared', 'clock', k.hoursShared, 'h', `${k.bookings} bookings by ${k.activeUsers} people`),
      kpi('Conflicts resolved', 'swap', k.conflictsResolved, '', 'Via alternatives, swaps and waitlist'),
      kpi('No-show rate', 'alert', `${k.noShowRate}%`, '', 'Unclaimed slots auto-release after 30 min'),
    ),
    h(
      'div',
      { class: 'grid grid--split' },
      h(
        'section',
        { class: 'card stack', 'aria-labelledby': 'util-h' },
        h(
          'div',
          { class: 'card__head' },
          h('h2', { class: 'card__title', id: 'util-h' }, 'Equipment utilisation'),
          h('span', { class: 'spacer' }),
          catSelect,
        ),
        listHost,
      ),
      h(
        'section',
        { class: 'card stack', 'aria-labelledby': 'ins-h' },
        h('h2', { class: 'card__title', id: 'ins-h' }, 'Recommendations'),
        data.insights.length
          ? h(
              'div',
              { class: 'stack stack--sm' },
              data.insights.map((i) =>
                h(
                  'div',
                  { class: `insight insight--${i.type}` },
                  h('div', { class: 'insight__icon' }, icon(INSIGHT_ICON[i.type] ?? 'info')),
                  h(
                    'div',
                    null,
                    i.equipmentId
                      ? h('a', { href: `#/equipment/${i.equipmentId}`, class: 'strong' }, i.title)
                      : h('strong', null, i.title),
                    h('div', { class: 'small muted' }, i.detail),
                  ),
                ),
              ),
            )
          : emptyState({ iconName: 'check-circle', title: 'Everything looks balanced' }),
      ),
    ),
    h(
      'div',
      { class: 'grid grid--split' },
      h(
        'section',
        { class: 'card stack', 'aria-labelledby': 'daily-h' },
        h('h2', { class: 'card__title', id: 'daily-h' }, 'Booked hours per day'),
        dailyChart(data.daily),
      ),
      h(
        'section',
        { class: 'card stack', 'aria-labelledby': 'dept-h' },
        h('h2', { class: 'card__title', id: 'dept-h' }, 'By department'),
        barList(
          data.departments
            .map((d) => ({
              label: `${state.meta.departments[d.department] ?? d.department}`,
              value: d.utilization,
            }))
            .sort((a, b) => b.value - a.value),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card stack', 'aria-labelledby': 'heat-h' },
      h('h2', { class: 'card__title', id: 'heat-h' }, 'When is the lab busiest?'),
      heatmap(data.heatmap),
    ),
  );
}
