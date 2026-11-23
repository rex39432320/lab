// Conflict resolution: when a requested slot is taken, produce ranked, explainable
// options - nearby slots, equivalent equipment, split sessions, fair-share swaps,
// or a waitlist entry. Everything here is deterministic and testable.
import { addDays, diffDays, hourLabel, prettyDate } from '../lib/time.js';
import { SWAP_MARGIN, priorityFor } from './priority.js';
import { freeWindows, validateBooking } from './scheduling.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const DAY_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, 5, 6, 7];
const MIN_NOTICE_HOURS_FOR_SWAP = 12;
const MAX_OPTIONS = 7;

const slotLabel = (date, s, e) => `${prettyDate(date)}, ${hourLabel(s)}–${hourLabel(e)}`;

/** Free slots of the same length close to a desired time, best first. */
export function findSlotCandidates(
  store,
  user,
  eq,
  desired,
  now,
  { ignoreBookingId, avoid, limit = 3, maxDayOffset = 7 } = {},
) {
  const hours = desired.endHour - desired.startHour;
  const project = desired.projectId ? store.get('projects', desired.projectId) : null;
  const found = [];
  for (const offset of DAY_OFFSETS) {
    if (Math.abs(offset) > maxDayOffset) continue;
    const date = addDays(desired.date, offset);
    if (project && date > project.deadline) continue;
    let best = null;
    for (const [w0, w1] of freeWindows(store, eq, date, now, ignoreBookingId)) {
      if (w1 - w0 < hours) continue;
      const startHour = clamp(desired.startHour, w0, w1 - hours);
      const cand = {
        equipmentId: eq.id,
        projectId: desired.projectId,
        date,
        startHour,
        endHour: startHour + hours,
      };
      if (avoid && avoid.date === date && startHour < avoid.endHour && avoid.startHour < cand.endHour)
        continue;
      const fit = Math.round(100 - 5 * Math.abs(startHour - desired.startHour) - 14 * Math.abs(offset));
      if (!best || fit > best.fit) best = { ...cand, fit };
    }
    if (best && !validateBooking(store, user, best, now, { ignoreBookingId }).errors.length) found.push(best);
  }
  return found.sort((a, b) => b.fit - a.fit).slice(0, limit);
}

/** Tag/category similarity in [0, 1]; 0 when nothing meaningful is shared. */
export function similarity(a, b) {
  const tb = new Set(b.tags);
  const shared = a.tags.filter((t) => tb.has(t)).length;
  if (!shared) return 0;
  return 0.35 * (a.category === b.category ? 1 : 0) + 0.65 * Math.min(1, shared / 3);
}

function splitOption(store, user, eq, input, now) {
  const hours = input.endHour - input.startHour;
  if (hours < 2) return null;
  const windows = freeWindows(store, eq, input.date, now).filter(([a, b]) => b - a >= 1);
  const total = windows.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (total < hours || windows.length < 2) return null;
  const ranked = [...windows].sort(
    (x, y) => Math.abs(x[0] - input.startHour) - Math.abs(y[0] - input.startHour),
  );
  const sessions = [];
  let remaining = hours;
  for (const [a, b] of ranked) {
    if (remaining <= 0 || sessions.length === 2) break;
    const take = Math.min(remaining, b - a);
    const start = clamp(input.startHour, a, b - take);
    sessions.push({
      equipmentId: eq.id,
      projectId: input.projectId,
      date: input.date,
      startHour: start,
      endHour: start + take,
    });
    remaining -= take;
  }
  if (remaining > 0) return null;
  sessions.sort((x, y) => x.startHour - y.startHour);
  const valid = sessions.every((s) => !validateBooking(store, user, s, now).errors.length);
  return valid ? sessions : null;
}

function swapOption(store, user, requester, conflicts, input, now) {
  if (conflicts.length !== 1) return null;
  const [held] = conflicts;
  const holder = store.get('users', held.userId);
  if (!holder || holder.id === user.id || held.status !== 'confirmed' || (held.bumpCount ?? 0) >= 1)
    return null;
  const hoursAway = diffDays(held.date, now.date) * 24 + (held.startHour - now.hour);
  if (hoursAway < MIN_NOTICE_HOURS_FOR_SWAP) return null;
  const holderProject = store.get('projects', held.projectId);
  const holderPriority = priorityFor(store, holder, holderProject, now, { ignoreBookingId: held.id });
  const gap = requester.score - holderPriority.score;
  if (!(held.flexible && gap >= 0) && gap < SWAP_MARGIN) return null;

  const eq = store.get('equipment', held.equipmentId);
  const [alt] = findSlotCandidates(store, holder, eq, held, now, {
    ignoreBookingId: held.id,
    avoid: input,
    limit: 1,
  });
  if (!alt) return null;
  return { held, holder, holderPriority, gap, alt };
}

/**
 * Build the full resolution for a request that failed validation (or any
 * request the user wants analysed). `viewer` controls how much holder detail is shown.
 */
export function buildResolution(store, user, input, now) {
  const check = validateBooking(store, user, input, now);
  const eq = check.equipment;
  const requester = priorityFor(store, user, check.project, now);
  const privileged = user.role !== 'student';
  const result = {
    requested: { ...input, label: eq ? slotLabel(input.date, input.startHour, input.endHour) : '' },
    errors: check.errors,
    warnings: check.warnings,
    requester,
    conflicts: [],
    options: [],
  };
  if (!eq) return result;

  result.conflicts = check.conflicts.map((b) => {
    const holder = store.get('users', b.userId);
    return {
      bookingId: privileged ? b.id : undefined,
      label: slotLabel(b.date, b.startHour, b.endHour),
      flexible: b.flexible,
      holder: privileged ? holder?.name : undefined,
    };
  });

  const blockingOther = check.errors.filter((e) => e.code !== 'CONFLICT');
  const hours = input.endHour - input.startHour;
  const options = [];
  const push = (opt) => options.push({ id: `opt${options.length + 1}`, ...opt });

  // Only suggest alternatives when the sole obstacle is the conflict (or access to a substitute).
  if (!blockingOther.length) {
    for (const c of findSlotCandidates(store, user, eq, input, now, { avoid: input })) {
      const dayDelta = diffDays(c.date, input.date);
      const where =
        dayDelta === 0
          ? 'same day'
          : dayDelta === 1
            ? 'next day'
            : dayDelta === -1
              ? 'day before'
              : `${Math.abs(dayDelta)} days ${dayDelta > 0 ? 'later' : 'earlier'}`;
      push({
        type: 'alt_slot',
        rank: Math.round(c.fit * 0.95),
        title: `Same ${eq.name}, ${slotLabel(c.date, c.startHour, c.endHour)}`,
        detail: `Closest free ${hours} h window (${where}); keeps your equipment choice.`,
        action: {
          kind: 'book',
          sessions: [
            {
              equipmentId: c.equipmentId,
              projectId: c.projectId,
              date: c.date,
              startHour: c.startHour,
              endHour: c.endHour,
            },
          ],
        },
      });
    }

    const split = splitOption(store, user, eq, input, now);
    if (split) {
      push({
        type: 'split',
        rank: 52,
        title: `Split into ${split.length} sessions on ${prettyDate(input.date)}`,
        detail:
          split.map((s) => `${hourLabel(s.startHour)}–${hourLabel(s.endHour)}`).join(' + ') +
          ' - no single free block, but enough free time overall.',
        action: { kind: 'book', sessions: split },
      });
    }

    const swap = swapOption(store, user, requester, check.conflicts, input, now);
    if (swap) {
      push({
        type: 'swap',
        rank: Math.min(90, 60 + Math.round(swap.gap / 2)),
        title: 'Ask the current holder to move (fair-share swap)',
        detail: `Your priority is ${requester.score} vs ${swap.holderPriority.score}. They would be moved to ${slotLabel(swap.alt.date, swap.alt.startHour, swap.alt.endHour)} and earn goodwill credit.`,
        action: {
          kind: 'swap',
          targetBookingId: swap.held.id,
          holderScore: swap.holderPriority.score,
          holderAlt: { date: swap.alt.date, startHour: swap.alt.startHour, endHour: swap.alt.endHour },
          request: {
            equipmentId: input.equipmentId,
            projectId: input.projectId,
            date: input.date,
            startHour: input.startHour,
            endHour: input.endHour,
          },
        },
      });
    }
  }

  // Equivalent equipment (also useful when the original is under maintenance).
  const accessProblem = check.errors.some((e) =>
    ['PAST', 'TOO_FAR', 'PROJECT_INVALID', 'SELF_OVERLAP', 'TOO_LONG', 'QUOTA'].includes(e.code),
  );
  if (!accessProblem) {
    const alternatives = store.data.equipment
      .filter((other) => other.id !== eq.id && other.status === 'available')
      .map((other) => ({ other, sim: similarity(eq, other) }))
      .filter((x) => x.sim >= 0.5)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 6);
    for (const { other, sim } of alternatives) {
      const candidate = findSlotCandidates(store, user, other, { ...input, equipmentId: other.id }, now, {
        limit: 1,
        maxDayOffset: 1,
      })[0];
      const otherErrors = candidate
        ? []
        : validateBooking(store, user, { ...input, equipmentId: other.id }, now, { skipConflict: true })
            .errors;
      const needsAccess = otherErrors.length > 0 && otherErrors.every((e) => e.code === 'NO_ACCESS');
      const free = needsAccess
        ? freeWindows(store, other, input.date, now).some(
            ([a, b]) => a <= input.startHour && b >= input.endHour,
          )
        : false;
      if (candidate) {
        push({
          type: 'alt_equipment',
          rank: Math.round(40 * sim + 0.5 * candidate.fit + (other.department === eq.department ? 5 : 0)),
          title: `${other.name}, ${slotLabel(candidate.date, candidate.startHour, candidate.endHour)}`,
          detail: `${Math.round(sim * 100)}% similar to ${eq.name} (${other.location}).`,
          action: {
            kind: 'book',
            sessions: [
              {
                equipmentId: other.id,
                projectId: candidate.projectId,
                date: candidate.date,
                startHour: candidate.startHour,
                endHour: candidate.endHour,
              },
            ],
          },
        });
      } else if (free && check.project) {
        push({
          type: 'alt_equipment',
          rank: Math.round(25 * sim + 10),
          title: `${other.name} is free then - needs access`,
          detail: `${Math.round(sim * 100)}% similar. Request faculty approval for your project to use it.`,
          action: { kind: 'request_access', equipmentId: other.id, projectId: input.projectId },
        });
      }
    }
  }

  if (check.conflicts.length || eq.status !== 'available') {
    push({
      type: 'waitlist',
      rank: 20,
      title: 'Join the smart waitlist',
      detail: 'If this slot frees up (cancellation or no-show), you are auto-booked by priority.',
      action: {
        kind: 'waitlist',
        request: {
          equipmentId: input.equipmentId,
          projectId: input.projectId,
          date: input.date,
          startHour: input.startHour,
          endHour: input.endHour,
        },
      },
    });
  }

  const ranked = options.sort((a, b) => b.rank - a.rank);
  const waitlist = ranked.filter((o) => o.type === 'waitlist');
  result.options = [
    ...ranked.filter((o) => o.type !== 'waitlist').slice(0, MAX_OPTIONS - waitlist.length),
    ...waitlist,
  ];
  return result;
}

/** Plain-language summary used when no LLM is configured (or it fails). */
export function localSummary(resolution, equipmentName) {
  const { requested, conflicts, options, requester } = resolution;
  const lead = conflicts.length
    ? `${equipmentName} is already booked for part of ${requested.label}.`
    : `${equipmentName} cannot be booked for ${requested.label}.`;
  const best = options.find((o) => o.type !== 'waitlist');
  if (!best) return `${lead} No close alternatives were found, so joining the waitlist is your best option.`;
  const why =
    best.type === 'swap'
      ? `Your request outranks the current booking on fair-share priority (${requester.score}).`
      : 'It is the closest feasible match to what you asked for.';
  return `${lead} Best option: ${best.title}. ${why}`;
}
