// Date/time presentation helpers. Dates are 'YYYY-MM-DD'; hours are numbers.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

const utc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const addDays = (d, n) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / DAY_MS);
export const dow = (d) => new Date(utc(d)).getUTCDay();
export const weekStart = (d) => addDays(d, -((dow(d) + 6) % 7));

export function hourLabel(h) {
  const whole = Math.floor(h);
  return `${whole % 12 === 0 ? 12 : whole % 12}${h % 1 ? ':30' : ''} ${whole >= 12 && whole < 24 ? 'PM' : 'AM'}`;
}
export const range = (s, e) => `${hourLabel(s)} – ${hourLabel(e)}`;
export const shortDate = (d) => `${DAYS[dow(d)]}, ${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
export const longDate = (d) => `${shortDate(d)} ${d.slice(0, 4)}`;

export function relativeDay(d, today) {
  const n = diffDays(d, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return shortDate(d);
}

export function daysLeftText(n) {
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`;
  if (n === 0) return 'Due today';
  return `${n} day${n === 1 ? '' : 's'} left`;
}

export function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const initials = (name) => name.split(/\s+/).filter((p) => /^[A-Za-z]/.test(p)).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const CATEGORY_CLASS = {
  'Test & Measurement': 'cat-test', 'Development Kits': 'cat-dev', Computing: 'cat-comp', Fabrication: 'cat-fab', Robotics: 'cat-robo',
  Chemistry: 'cat-chem', 'Life Sciences': 'cat-life', 'Microscopy & Imaging': 'cat-micro', 'Optics & Photonics': 'cat-optic',
};
export const STATUS_BADGE = {
  confirmed: ['success', 'Confirmed'], pending: ['warn', 'Awaiting approval'], checked_in: ['info', 'In progress'], completed: ['muted', 'Completed'],
  cancelled: ['muted', 'Cancelled'], no_show: ['danger', 'No-show'], rejected: ['danger', 'Declined'], expired: ['muted', 'Expired'],
};
