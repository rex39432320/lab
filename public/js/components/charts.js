// Lightweight, dependency-free SVG/HTML charts with text alternatives.
import { h, svgEl } from '../dom.js';
import { hourLabel, shortDate } from '../format.js';
import { progress } from '../ui.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function barList(rows, { href } = {}) {
  return h(
    'div',
    { class: 'bars', role: 'list' },
    rows.map((r) => {
      const variant = r.value >= 75 ? 'danger' : r.value >= 40 ? 'warn' : '';
      const name = href ? h('a', { href: href(r) }, r.label) : r.label;
      return h(
        'div',
        { class: 'bar-row', role: 'listitem' },
        h('div', { class: 'bar-row__name' }, r.lead, h('span', { class: 'truncate', title: r.label }, name)),
        progress(r.value, variant, `${r.label}: ${r.value} percent`),
        h('strong', { class: 'right' }, `${r.value}%`),
      );
    }),
  );
}

export function heatmap({ hours, rows }) {
  let peak = { v: -1, d: 0, h: 0 };
  rows.forEach((row, d) =>
    row.forEach((v, i) => {
      if (v > peak.v) peak = { v, d, h: hours[i] };
    }),
  );
  const summary = `Demand heatmap by weekday and hour. Busiest slot: ${DAY_NAMES[peak.d]} at ${hourLabel(peak.h)}.`;
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'heat', role: 'img', 'aria-label': summary },
      h('span'),
      hours.map((hr) => h('span', { class: 'heat__hour' }, hr % 12 === 0 ? 12 : hr % 12)),
      rows.map((row, d) => [
        h('span', null, DAY_NAMES[d]),
        row.map((v) =>
          h('span', { class: 'heat__cell', title: `${Math.round(v * 100)}% busy`, vars: { '--v': v } }),
        ),
      ]),
    ),
    h(
      'div',
      { class: 'row xs faint' },
      'Hours are AM/PM across the lab day. Darker means busier.',
      h('span', { class: 'spacer' }),
      'Quiet',
      h('span', { class: 'heat__cell', vars: { '--v': 0, width: '26px' } }),
      h('span', { class: 'heat__cell', vars: { '--v': 0.5, width: '26px' } }),
      h('span', { class: 'heat__cell', vars: { '--v': 1, width: '26px' } }),
      'Busy',
    ),
  );
}

/** Bar chart of booked hours per day (past = violet, upcoming = pink). */
export function dailyChart(daily) {
  const W = 760;
  const H = 220;
  const pad = { l: 34, r: 8, t: 14, b: 36 };
  const max = Math.max(10, ...daily.map((d) => d.hours));
  const bw = (W - pad.l - pad.r) / daily.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const total = daily.reduce((s, d) => s + d.hours, 0);
  const svg = svgEl(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `Booked lab hours per day over 3 weeks, ${total} hours in total.`,
    },
    svgEl('title', {}, 'Booked hours per day'),
  );
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((max / 4) * i);
    svg.append(
      svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'gridline' }),
      svgEl('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, v),
    );
  }
  daily.forEach((d, i) => {
    const x = pad.l + i * bw + bw * 0.18;
    svg.append(
      svgEl(
        'rect',
        {
          x,
          y: y(d.hours),
          width: bw * 0.64,
          height: Math.max(1, H - pad.b - y(d.hours)),
          rx: 4,
          class: d.future ? 'bar-future' : 'bar-past',
        },
        svgEl('title', {}, `${shortDate(d.date)}: ${d.hours} h`),
      ),
    );
    if (i % 3 === 0 || i === daily.length - 1)
      svg.append(svgEl('text', { x: x + bw * 0.32, y: H - 12, 'text-anchor': 'middle' }, d.date.slice(5)));
  });
  svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: 'axis' }));
  return h(
    'div',
    null,
    svg,
    h(
      'div',
      { class: 'legend' },
      h('span', null, h('i', { class: 'l-mine' }), 'Past 2 weeks'),
      h('span', null, h('i', { class: 'l-booked' }), 'Booked ahead'),
    ),
  );
}
