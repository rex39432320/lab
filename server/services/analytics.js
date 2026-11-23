// Utilisation analytics for faculty and lab coordinators.
import { addDays, dayOfWeek } from '../lib/time.js';
import { hoursOf, isOpenDay } from './scheduling.js';

const WINDOW_DAYS = 14;
const COUNTED = new Set(['confirmed', 'checked_in', 'completed']);

const round = (x, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits;

function windowDates(now) {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(now.date, i - (WINDOW_DAYS - 1)));
}

export function overview(store, now) {
  const dates = windowDates(now);
  const dateSet = new Set(dates);
  const inWindow = store.data.bookings.filter((b) => dateSet.has(b.date));
  const used = inWindow.filter((b) => COUNTED.has(b.status));

  const perEquipment = store.data.equipment.map((eq) => {
    const capacity = dates.filter((d) => isOpenDay(eq, d)).length * (eq.closeHour - eq.openHour);
    const booked = used.filter((b) => b.equipmentId === eq.id);
    const hours = booked.reduce((sum, b) => sum + hoursOf(b), 0);
    return {
      id: eq.id,
      name: eq.name,
      category: eq.category,
      department: eq.department,
      status: eq.status,
      icon: eq.icon,
      hours,
      bookings: booked.length,
      capacity,
      utilization: eq.status === 'maintenance' || !capacity ? 0 : round((hours / capacity) * 100),
    };
  });

  const departments = {};
  for (const e of perEquipment) {
    const d = (departments[e.department] ??= {
      department: e.department,
      hours: 0,
      capacity: 0,
      equipment: 0,
    });
    d.hours += e.hours;
    d.capacity += e.capacity;
    d.equipment += 1;
  }

  // Heatmap: share of equipment busy per weekday x hour (Mon..Sun, 8..19).
  const hourRange = Array.from({ length: 12 }, (_, i) => i + 8);
  const heat = Array.from({ length: 7 }, () => Array(hourRange.length).fill(0));
  const dayCounts = Array(7).fill(0);
  for (const d of dates) dayCounts[(dayOfWeek(d) + 6) % 7] += 1;
  for (const b of used) {
    const row = (dayOfWeek(b.date) + 6) % 7;
    for (let h = b.startHour; h < b.endHour; h++) {
      const col = hourRange.indexOf(h);
      if (col >= 0) heat[row][col] += 1;
    }
  }
  const active = Math.max(1, store.data.equipment.filter((e) => e.status === 'available').length);
  const heatmap = heat.map((row, r) =>
    row.map((n) => round(Math.min(1, n / (Math.max(1, dayCounts[r]) * active * 0.5)), 2)),
  );

  const daily = [...dates, ...Array.from({ length: 7 }, (_, i) => addDays(now.date, i + 1))].map((date) => ({
    date,
    hours: store.data.bookings
      .filter((b) => b.date === date && COUNTED.has(b.status))
      .reduce((s, b) => s + hoursOf(b), 0),
    future: date > now.date,
  }));

  const noShows = inWindow.filter((b) => b.status === 'no_show').length;
  const finished = inWindow.filter((b) => b.status === 'completed' || b.status === 'no_show').length;
  const totalCapacity = perEquipment.reduce((s, e) => s + (e.status === 'available' ? e.capacity : 0), 0);
  const totalHours = perEquipment.reduce((s, e) => s + e.hours, 0);
  const swaps = store.data.swaps.filter((s) => s.status === 'accepted').length;
  const promoted = store.data.audit.filter((a) => a.action === 'booking.promoted').length;

  const kpis = {
    equipment: store.data.equipment.length,
    available: store.data.equipment.filter((e) => e.status === 'available').length,
    utilization: totalCapacity ? round((totalHours / totalCapacity) * 100) : 0,
    bookings: inWindow.filter((b) => b.status !== 'cancelled').length,
    activeUsers: new Set(used.map((b) => b.userId)).size,
    pendingApprovals:
      store.data.accessRequests.filter((r) => r.status === 'pending').length +
      store.data.bookings.filter((b) => b.status === 'pending').length,
    noShowRate: finished ? round((noShows / finished) * 100) : 0,
    conflictsResolved:
      swaps + promoted + store.data.audit.filter((a) => a.action === 'conflict.resolved').length,
    hoursShared: totalHours,
  };

  return {
    kpis,
    perEquipment: perEquipment.sort((a, b) => b.utilization - a.utilization),
    departments: Object.values(departments).map((d) => ({
      ...d,
      utilization: d.capacity ? round((d.hours / d.capacity) * 100) : 0,
    })),
    heatmap: { hours: hourRange, rows: heatmap },
    daily,
    insights: insightsFor(perEquipment, kpis),
  };
}

function insightsFor(perEquipment, kpis) {
  const insights = [];
  const available = perEquipment.filter((e) => e.status === 'available');
  for (const e of available.filter((x) => x.utilization >= 40).slice(0, 3)) {
    const sameCategory = available.filter(
      (x) => x.category === e.category && x.id !== e.id && x.utilization < 40,
    );
    insights.push({
      type: 'hot',
      equipmentId: e.id,
      title: `${e.name} is in high demand (${e.utilization}% booked)`,
      detail: sameCategory.length
        ? `Steer overflow to ${sameCategory[0].name} (${sameCategory[0].utilization}% used) or extend opening hours.`
        : 'Consider extending opening hours or adding a second unit.',
    });
  }
  for (const e of available.filter((x) => x.utilization < 12).slice(0, 3)) {
    insights.push({
      type: 'idle',
      equipmentId: e.id,
      title: `${e.name} is under-used (${e.utilization}%)`,
      detail: 'Promote it as an alternative in conflict suggestions or run a short orientation session.',
    });
  }
  for (const e of perEquipment.filter((x) => x.status === 'maintenance')) {
    insights.push({
      type: 'maintenance',
      equipmentId: e.id,
      title: `${e.name} is out of service`,
      detail: 'Bookings are blocked and affected users were notified. Restore it once serviced.',
    });
  }
  if (kpis.noShowRate >= 8)
    insights.push({
      type: 'noshow',
      title: `No-show rate is ${kpis.noShowRate}%`,
      detail: 'Automatic release after 30 minutes without check-in returns this time to the waitlist.',
    });
  return insights;
}
