// Inline icon set (24x24, stroke based). The markup is static and trusted.
const P = (d) => `<path d="${d}"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const R = (x, y, w, h, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

const ICONS = {
  home: P('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'),
  search: C(11, 11, 7) + P('m20 20-3.5-3.5'),
  calendar: R(3, 4.5, 18, 16.5, 3) + P('M3 9.5h18M8 3v3M16 3v3'),
  'calendar-check': R(3, 4.5, 18, 16.5, 3) + P('M3 9.5h18M8 3v3M16 3v3m-7 12 2 2 4-4'),
  clock: C(12, 12, 9) + P('M12 7v5l3 2'),
  bell: P('M6 9a6 6 0 0 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9zM10 20a2 2 0 0 0 4 0'),
  user: C(12, 8, 4) + P('M4 21a8 8 0 0 1 16 0'),
  users: C(9, 8, 3.5) + P('M2.5 20a6.5 6.5 0 0 1 13 0') + C(17.5, 9, 2.8) + P('M17 14.3a5.5 5.5 0 0 1 4.5 5.7'),
  folder: P('M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  check: P('m5 12.5 4.5 4.5L19 7.5'),
  'check-circle': C(12, 12, 9) + P('m8 12.5 3 3 5-6'),
  x: P('M6 6l12 12M18 6 6 18'),
  'x-circle': C(12, 12, 9) + P('m9 9 6 6M15 9l-6 6'),
  plus: P('M12 5v14M5 12h14'),
  'chevron-left': P('m15 5-7 7 7 7'),
  'chevron-right': P('m9 5 7 7-7 7'),
  'chevron-down': P('m6 9 6 6 6-6'),
  'arrow-right': P('M5 12h14m-6-6 6 6-6 6'),
  sparkles: P('M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z') + P('M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'),
  chart: P('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  trend: P('m3 17 6-6 4 4 8-9M15 6h6v6'),
  shield: P('M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z') + P('m9 12 2.2 2.2L15 10.5'),
  lock: R(5, 11, 14, 10, 3) + P('M8 11V8a4 4 0 0 1 8 0v3'),
  unlock: R(5, 11, 14, 10, 3) + P('M8 11V8a4 4 0 0 1 7.5-2'),
  logout: P('M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11'),
  sun: C(12, 12, 4) + P('M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'),
  moon: P('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'),
  menu: P('M4 6h16M4 12h16M4 18h16'),
  alert: P('M12 3.5 2.5 20h19z') + P('M12 10v4.5M12 17.5v.01'),
  info: C(12, 12, 9) + P('M12 11v5M12 8v.01'),
  download: P('M12 4v11m-5-4 5 5 5-5M4 20h16'),
  filter: P('M3 5h18l-7 8v6l-4-2v-4z'),
  swap: P('M7 7h13l-3-3M17 17H4l3 3'),
  inbox: P('M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z') + P('M3 13h5l1 2h6l1-2h5'),
  play: P('M7 4.5v15l12-7.5z'),
  stop: R(6, 6, 12, 12, 2),
  trash: P('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  edit: P('M4 20h4L19 9l-4-4L4 16zM14 6l4 4'),
  send: P('M21 3 10 14M21 3l-7 18-4-8-8-4z'),
  map: P('M12 21s7-5.7 7-11a7 7 0 0 0-14 0c0 5.3 7 11 7 11z') + C(12, 10, 2.5),
  link: P('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'),
  target: C(12, 12, 9) + C(12, 12, 5) + C(12, 12, 1),
  bolt: P('M13 2 4 14h7l-1 8 9-12h-7z'),
  star: P('m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'),
  heart: P('M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z'),
  hourglass: P('M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9'),
  gauge: P('M4 18a9 9 0 1 1 16 0') + P('m12 14 4-5'),
  settings: C(12, 12, 3) + P('M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
  // equipment glyphs
  oscilloscope: R(3, 4, 18, 13, 2.5) + P('M6 12c1.5-4 3-4 4.5 0s3 4 4.5 0 1.5-2.5 3-2.5M8 21h8M12 17v4'),
  wave: P('M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0'),
  radio: C(12, 13, 2) + P('M7.5 8.5a6.4 6.4 0 0 0 0 9M16.5 8.5a6.4 6.4 0 0 1 0 9M4.5 5.5a10.5 10.5 0 0 0 0 15M19.5 5.5a10.5 10.5 0 0 1 0 15'),
  wrench: P('M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'),
  chip: R(6, 6, 12, 12, 2) + R(9.5, 9.5, 5, 5, 1) + P('M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3'),
  server: R(3, 4, 18, 7, 2) + R(3, 13, 18, 7, 2) + P('M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6'),
  vr: P('M3 8h18a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4.5l-2-3h-5l-2 3H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'),
  printer: P('M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2') + R(7, 14, 10, 7, 1),
  laser: C(16, 12, 2.5) + P('M2 12h11.5M18 8l2-2M18 16l2 2M21 12h1.5'),
  scale: P('M12 3v18M5 21h14M5 7h14M7 7l-3 7h6zM17 7l-3 7h6z'),
  robot: P('M4 21h8M8 21v-5.5l4.5-6.5 5-3') + C(8, 15, 1.6) + C(12.5, 9, 1.6) + C(18, 6, 2),
  drone: P('m7 7 10 10M17 7 7 17') + C(5.5, 5.5, 2.5) + C(18.5, 5.5, 2.5) + C(5.5, 18.5, 2.5) + C(18.5, 18.5, 2.5) + R(10, 10, 4, 4, 1),
  flask: P('M9 3h6M10 3v6l-5.5 10a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3M7.5 15h9'),
  dna: P('M7 3c0 6 10 6 10 12v6M17 3c0 6-10 6-10 12v6M8.5 7.5h7M8.5 16.5h7'),
  microscope: P('M8 3h4l1 6-5 1zM10 10v3M6 21h12M9 21a5 5 0 0 1 0-10M14 14a4 4 0 0 1 4 4v3'),
};

/** @returns {SVGElement} */
export function icon(name, { size = 20, cls = '', label } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `icon ${cls}`.trim());
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  svg.innerHTML = ICONS[name] ?? ICONS.sparkles; // static, trusted markup
  return svg;
}
