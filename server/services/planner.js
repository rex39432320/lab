// Smart planner: spreads the hours a project needs across free slots before a
// deadline while respecting weekly fair-use quotas and time-of-day preferences.
import { addDays, diffDays, prettyDate, weekStart } from '../lib/time.js';
import { BOOKING_WINDOW_DAYS, freeWindows, quotaFor, validateBooking, weekHours } from './scheduling.js';

const PREFERRED_RANGES = { morning: [8, 13], afternoon: [12, 18], any: [0, 24] };

function pickWindow(windows, hours, preferred) {
  const [lo, hi] = PREFERRED_RANGES[preferred] ?? PREFERRED_RANGES.any;
  let best = null;
  for (const [w0, w1] of windows) {
    if (w1 - w0 < hours) continue;
    for (let s = w0; s + hours <= w1; s++) {
      const inside = s >= lo && s + hours <= hi ? 0 : 1;
      const score = inside * 100 + s;
      if (!best || score < best.score) best = { startHour: s, score };
    }
  }
  return best?.startHour ?? null;
}

/** @returns {{sessions: object[], plannedHours: number, shortfall: number, notes: string[]}} */
export function planSessions(store, user, params, now) {
  const eq = store.get('equipment', params.equipmentId);
  const project = params.projectId ? store.get('projects', params.projectId) : null;
  const notes = [];
  const horizonEnd = [params.deadline, addDays(now.date, BOOKING_WINDOW_DAYS), project?.deadline]
    .filter(Boolean)
    .sort()[0];
  const sessionHours = Math.min(params.sessionHours, eq.maxHoursPerBooking);
  const targetSessions = Math.ceil(params.hours / sessionHours);
  const horizonDays = Math.max(1, diffDays(horizonEnd, now.date) + 1);
  const spacing = Math.max(1, Math.min(2, Math.floor(horizonDays / targetSessions)));

  const sessions = [];
  const plannedByWeek = new Map();
  const dates = [];
  for (let d = now.date; d <= horizonEnd; d = addDays(d, 1)) dates.push(d);

  const tryDate = (date) => {
    const remaining = params.hours - sessions.reduce((sum, s) => sum + (s.endHour - s.startHour), 0);
    if (remaining <= 0 || sessions.some((s) => s.date === date)) return;
    const hours = Math.min(sessionHours, remaining);
    const ws = weekStart(date);
    const quota = quotaFor(user, project, now);
    const used = user.role === 'student' ? weekHours(store, user.id, date) + (plannedByWeek.get(ws) ?? 0) : 0;
    if (user.role === 'student' && used + hours > quota.limit) return;
    const startHour = pickWindow(freeWindows(store, eq, date, now), hours, params.preferred);
    if (startHour === null) return;
    const slot = {
      equipmentId: eq.id,
      projectId: params.projectId,
      date,
      startHour,
      endHour: startHour + hours,
    };
    if (validateBooking(store, user, slot, now).errors.length) return;
    sessions.push(slot);
    plannedByWeek.set(ws, (plannedByWeek.get(ws) ?? 0) + hours);
  };

  dates.forEach((date, i) => i % spacing === 0 && tryDate(date)); // spread out first
  dates.forEach(tryDate); // then fill any remaining gaps
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);

  const plannedHours = sessions.reduce((sum, s) => sum + (s.endHour - s.startHour), 0);
  const shortfall = params.hours - plannedHours;
  if (shortfall > 0)
    notes.push(
      `Only ${plannedHours} of ${params.hours} h fit before ${prettyDate(horizonEnd)}. Consider a later deadline, similar equipment, or the waitlist.`,
    );
  if (sessions.length) {
    const buffer = diffDays(params.deadline, sessions.at(-1).date);
    if (buffer >= 0) notes.push(`Your last session leaves a ${buffer}-day buffer before the deadline.`);
  }
  return { sessions, plannedHours, shortfall, notes };
}
