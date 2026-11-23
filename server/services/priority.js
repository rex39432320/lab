// Transparent fairness-aware priority scoring used to rank competing requests.
import { diffDays } from '../lib/time.js';
import { isActive, quotaFor, weekHours } from './scheduling.js';

const KIND_IMPORTANCE = { capstone: 1, research: 0.9, course: 0.7, personal: 0.35 };
export const SWAP_MARGIN = 10;
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

const WEIGHTS = {
  urgency: 0.4,
  fairness: 0.25,
  importance: 0.2,
  starvation: 0.1,
  goodwill: 0.05,
};

function daysSinceLastUse(store, userId, now) {
  const dates = store.data.bookings
    .filter((b) => b.userId === userId && isActive(b) && b.date <= now.date)
    .map((b) => b.date)
    .sort();
  return dates.length ? diffDays(now.date, dates.at(-1)) : 14;
}

/**
 * Score 0-100 plus a breakdown the UI can explain to the user.
 * urgency: deadline proximity; fairness: unused weekly quota; importance:
 * project kind; starvation: days since last access; goodwill: accepted swaps.
 */
export function priorityFor(store, user, project, now, { ignoreBookingId } = {}) {
  const isStudent = user.role === 'student';
  const daysLeft = project ? diffDays(project.deadline, now.date) : 30;
  const quota = quotaFor(user, project, now);
  const used = weekHours(store, user.id, now.date, ignoreBookingId);

  const factors = {
    urgency: clamp(1 - Math.max(daysLeft, 0) / 21),
    fairness: isStudent ? clamp(1 - used / quota.limit) : 0.5,
    importance: project ? (KIND_IMPORTANCE[project.kind] ?? 0.5) : isStudent ? 0.35 : 0.9,
    starvation: clamp(daysSinceLastUse(store, user.id, now) / 14),
    goodwill: clamp((user.karma ?? 0) / 5),
  };

  const notes = {
    urgency: project
      ? daysLeft < 0
        ? 'Deadline passed'
        : `Deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
      : 'No project deadline',
    fairness: isStudent ? `${used}/${quota.limit} h of weekly allowance used` : 'Faculty usage',
    importance: project
      ? `${project.kind[0].toUpperCase()}${project.kind.slice(1)} project`
      : 'No project linked',
    starvation: `${daysSinceLastUse(store, user.id, now)} day(s) since last lab use`,
    goodwill: `${user.karma ?? 0} slot(s) generously released to others`,
  };
  const labels = {
    urgency: 'Deadline urgency',
    fairness: 'Fair-share remaining',
    importance: 'Project importance',
    starvation: 'Time since last access',
    goodwill: 'Goodwill credit',
  };

  const breakdown = Object.keys(WEIGHTS).map((key) => ({
    key,
    label: labels[key],
    note: notes[key],
    value: Math.round(factors[key] * 100) / 100,
    weight: WEIGHTS[key],
    points: Math.round(factors[key] * WEIGHTS[key] * 100),
  }));
  return { score: breakdown.reduce((sum, f) => sum + f.points, 0), breakdown };
}
