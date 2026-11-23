// Campus-local date/time helpers. Dates are 'YYYY-MM-DD' strings, hours are
// numbers (0-24). Working in plain strings avoids timezone bugs in scheduling.

const TZ = process.env.CAMPUS_TZ || 'Asia/Kolkata';
const DAY_MS = 86_400_000;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Current campus date and fractional hour, e.g. { date: '2026-11-23', hour: 14.5 }. */
export function campusNow(ms = Date.now()) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) + Number(parts.minute) / 60,
  };
}

export const parseDate = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const formatDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => formatDate(parseDate(d) + n * DAY_MS);
export const diffDays = (a, b) => Math.round((parseDate(a) - parseDate(b)) / DAY_MS);
/** 0 = Sunday ... 6 = Saturday */
export const dayOfWeek = (d) => new Date(parseDate(d)).getUTCDay();
/** Monday of the week containing `d`. */
export const weekStart = (d) => addDays(d, -((dayOfWeek(d) + 6) % 7));
export const isValidDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && formatDate(parseDate(s)) === s;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. 'Tue 24 Nov' */
export const prettyDate = (d) =>
  `${DAY_NAMES[dayOfWeek(d)].slice(0, 3)} ${+d.slice(8, 10)} ${MONTH_NAMES[+d.slice(5, 7) - 1]}`;

export function hourLabel(h) {
  const whole = Math.floor(h);
  const suffix = whole >= 12 ? 'PM' : 'AM';
  const h12 = whole % 12 === 0 ? 12 : whole % 12;
  return `${h12}${h % 1 ? ':30' : ''} ${suffix}`;
}
