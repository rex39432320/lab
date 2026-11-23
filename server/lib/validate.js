// Small, dependency-free input validation. Every function throws a 400
// HttpError naming the offending field, and returns a normalised value.
import { badRequest } from './errors.js';
import { isValidDate } from './time.js';

const fail = (field, message) => {
  throw badRequest(`${field}: ${message}`, { field });
};

const missing = (value) => value === undefined || value === null || value === '';

export const v = {
  string(value, field, { min = 1, max = 200, optional = false } = {}) {
    if (missing(value)) return optional ? undefined : fail(field, 'is required');
    if (typeof value !== 'string') return fail(field, 'must be text');
    const text = value.trim();
    if (text.length < min) return fail(field, `must be at least ${min} characters`);
    if (text.length > max) return fail(field, `must be at most ${max} characters`);
    return text;
  },

  int(value, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
    if (missing(value)) return optional ? undefined : fail(field, 'is required');
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!Number.isInteger(n)) return fail(field, 'must be a whole number');
    if (n < min || n > max) return fail(field, `must be between ${min} and ${max}`);
    return n;
  },

  date(value, field, { optional = false } = {}) {
    if (missing(value)) return optional ? undefined : fail(field, 'is required');
    if (!isValidDate(value)) return fail(field, 'must be a valid date (YYYY-MM-DD)');
    return value;
  },

  oneOf(value, field, allowed, { optional = false } = {}) {
    if (missing(value)) return optional ? undefined : fail(field, 'is required');
    if (!allowed.includes(value)) return fail(field, `must be one of: ${allowed.join(', ')}`);
    return value;
  },

  bool(value, field, { optional = false } = {}) {
    if (missing(value)) return optional ? undefined : fail(field, 'is required');
    if (typeof value !== 'boolean') return fail(field, 'must be true or false');
    return value;
  },

  email(value, field = 'email') {
    const email = v.string(value, field, { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(field, 'must be a valid email address');
    return email;
  },

  id(value, field, { optional = false } = {}) {
    if (missing(value)) return optional ? undefined : fail(field, 'is required');
    if (typeof value !== 'string' || !/^[\w-]{1,48}$/.test(value)) return fail(field, 'is not a valid id');
    return value;
  },

  array(value, field, { max = 50, optional = false, each = (x) => x } = {}) {
    if (missing(value)) return optional ? undefined : fail(field, 'is required');
    if (!Array.isArray(value)) return fail(field, 'must be a list');
    if (value.length > max) return fail(field, `can have at most ${max} items`);
    return value.map((item, i) => each(item, `${field}[${i}]`));
  },

  object(value, field = 'body') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(field, 'must be a JSON object');
    return value;
  },
};

/** Validate the common slot shape shared by bookings, waitlist and planner calls. */
export function slotInput(body) {
  const startHour = v.int(body.startHour, 'startHour', { min: 0, max: 23 });
  const endHour = v.int(body.endHour, 'endHour', { min: 1, max: 24 });
  if (endHour <= startHour) fail('endHour', 'must be after startHour');
  return {
    equipmentId: v.id(body.equipmentId, 'equipmentId'),
    projectId: v.id(body.projectId, 'projectId', { optional: true }),
    date: v.date(body.date, 'date'),
    startHour,
    endHour,
    purpose: v.string(body.purpose, 'purpose', { max: 280, optional: true }) ?? '',
  };
}
