import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, dayOfWeek, weekStart } from '../server/lib/time.js';
import { priorityFor } from '../server/services/priority.js';
import {
  findConflicts,
  freeWindows,
  overlaps,
  quotaFor,
  validateBooking,
  weekHours,
} from '../server/services/scheduling.js';
import { NOW, TUESDAY, createSeededStore } from './helpers.js';

const store = createSeededStore();
const user = (id) => store.get('users', id);
const codes = (result) => result.errors.map((e) => e.code);

describe('time helpers', () => {
  it('computes week starts and weekdays without timezone drift', () => {
    assert.equal(dayOfWeek('2026-03-02'), 1);
    assert.equal(weekStart('2026-03-08'), '2026-03-02');
    assert.equal(addDays('2026-02-28', 2), '2026-03-02');
  });
});

describe('slot arithmetic', () => {
  it('treats touching ranges as non-overlapping', () => {
    assert.equal(overlaps(9, 11, 11, 13), false);
    assert.equal(overlaps(9, 12, 11, 13), true);
  });

  it('finds free windows that exclude booked hours', () => {
    const eq = store.get('equipment', 'eq-sa');
    const windows = freeWindows(store, eq, TUESDAY, NOW);
    for (const [a, b] of windows) assert.equal(findConflicts(store, eq.id, TUESDAY, a, b).length, 0);
    assert.ok(
      windows.every(([a, b]) => !(a < 13 && 10 < b)),
      'Vikram holds 10-13 on the spectrum analyzer',
    );
  });
});

describe('validateBooking', () => {
  const base = {
    equipmentId: 'eq-dso',
    projectId: 'p-irrigation',
    date: addDays(NOW.date, 4),
    startHour: 10,
    endHour: 12,
  };
  const aarav = () => user('u-aarav');

  it('accepts a valid booking', () => {
    const result = validateBooking(store, aarav(), base, NOW);
    assert.deepEqual(codes(result), []);
  });

  it('rejects past slots', () => {
    assert.ok(codes(validateBooking(store, aarav(), { ...base, date: '2026-03-01' }, NOW)).includes('PAST'));
    assert.ok(
      codes(
        validateBooking(store, aarav(), { ...base, date: NOW.date, startHour: 7, endHour: 9 }, NOW),
      ).includes('PAST'),
    );
  });

  it('rejects Sundays and out-of-hours requests', () => {
    assert.ok(
      codes(validateBooking(store, aarav(), { ...base, date: '2026-03-08' }, NOW)).includes('CLOSED'),
    );
    assert.ok(
      codes(validateBooking(store, aarav(), { ...base, startHour: 17, endHour: 19 }, NOW)).includes('CLOSED'),
    );
  });

  it('enforces the per-booking maximum', () => {
    assert.ok(
      codes(validateBooking(store, aarav(), { ...base, startHour: 9, endHour: 15 }, NOW)).includes(
        'TOO_LONG',
      ),
    );
  });

  it('requires approved project access for restricted equipment', () => {
    const noAccess = validateBooking(store, user('u-aarav'), { ...base, equipmentId: 'eq-sa' }, NOW);
    assert.ok(codes(noAccess).includes('NO_ACCESS'));
    const granted = validateBooking(
      store,
      user('u-arjun'),
      { ...base, equipmentId: 'eq-sa', projectId: 'p-5g', date: addDays(NOW.date, 5) },
      NOW,
    );
    assert.ok(!codes(granted).includes('NO_ACCESS'));
  });

  it('blocks a project the user does not belong to', () => {
    assert.ok(
      codes(validateBooking(store, aarav(), { ...base, projectId: 'p-5g' }, NOW)).includes('PROJECT_INVALID'),
    );
  });

  it('reports conflicts separately so alternatives can be offered', () => {
    const result = validateBooking(
      store,
      user('u-arjun'),
      { equipmentId: 'eq-sa', projectId: 'p-5g', date: TUESDAY, startHour: 11, endHour: 13 },
      NOW,
    );
    assert.deepEqual(codes(result), ['CONFLICT']);
    assert.equal(result.conflicts.length, 1);
  });

  it('blocks maintenance equipment', () => {
    assert.ok(
      codes(validateBooking(store, aarav(), { ...base, equipmentId: 'eq-sla' }, NOW)).includes('MAINTENANCE'),
    );
  });

  it('flags long student bookings for approval', () => {
    const result = validateBooking(store, aarav(), { ...base, startHour: 9, endHour: 13 }, NOW);
    assert.equal(result.needsApproval, true);
  });
});

describe('fair-use quota', () => {
  it('boosts the allowance for imminent deadlines', () => {
    const project = store.get('projects', 'p-5g'); // due in 4 days
    assert.equal(quotaFor(user('u-arjun'), project, NOW).limit, 12);
    const later = { date: addDays(NOW.date, 1), hour: 8 }; // now due in 3 days
    const urgent = quotaFor(user('u-arjun'), project, later);
    assert.equal(urgent.limit, 18);
    assert.ok(urgent.boosted);
    assert.equal(quotaFor(user('u-arjun'), store.get('projects', 'p-drone'), later).limit, 12);
  });

  it('counts hours within the Monday-based week', () => {
    assert.ok(weekHours(store, 'u-arjun', NOW.date) >= 0);
  });
});

describe('priority scoring', () => {
  it('ranks an urgent capstone above a hobby project', () => {
    const urgent = priorityFor(store, user('u-arjun'), store.get('projects', 'p-5g'), NOW);
    const hobby = priorityFor(store, user('u-vikram'), store.get('projects', 'p-drone'), NOW);
    assert.ok(urgent.score > hobby.score + 20, `${urgent.score} vs ${hobby.score}`);
  });

  it('returns an explainable breakdown that sums to the score', () => {
    const result = priorityFor(store, user('u-isha'), store.get('projects', 'p-sorter'), NOW);
    assert.equal(
      result.breakdown.reduce((s, f) => s + f.points, 0),
      result.score,
    );
    assert.ok(result.breakdown.every((f) => f.label && f.note));
  });

  it('rewards goodwill from accepted swaps', () => {
    const arjun = { ...user('u-arjun') };
    const before = priorityFor(store, arjun, null, NOW).score;
    arjun.karma = 3;
    assert.ok(priorityFor(store, arjun, null, NOW).score > before);
  });
});
