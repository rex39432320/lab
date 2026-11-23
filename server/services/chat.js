// "Lab Copilot": a conversational layer over the scheduling engine. Intent and
// slot parsing is local and deterministic; Gemini (when configured) only helps
// interpret equipment needs. All actions are returned as structured cards.
import { DAY_NAMES, addDays, dayOfWeek, hourLabel, isValidDate, prettyDate } from '../lib/time.js';
import { planSessions } from './planner.js';
import { freeWindows, isActive, nextFree } from './scheduling.js';
import { searchEquipment } from './search.js';

const TIME_RANGES = { morning: [8, 13], afternoon: [12, 18], evening: [15, 20] };

function parseDateWord(text, now) {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isValidDate(iso[1])) return iso[1];
  if (/\bday after tomorrow\b/.test(text)) return addDays(now.date, 2);
  if (/\btomorrow\b/.test(text)) return addDays(now.date, 1);
  if (/\btoday\b|\btonight\b/.test(text)) return now.date;
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${DAY_NAMES[i].toLowerCase()}\\b`).test(text) || new RegExp(`\\b${DAY_NAMES[i].slice(0, 3).toLowerCase()}\\b`).test(text)) {
      const ahead = (i - dayOfWeek(now.date) + 7) % 7 || 7;
      return addDays(now.date, ahead);
    }
  }
  return null;
}

/** Extract intent, date, time-of-day, duration and deadline from a message. */
export function parseMessage(raw, now) {
  const text = raw.toLowerCase();
  const hoursMatch = text.match(/(\d{1,2})\s*(?:h\b|hr|hrs|hour)/);
  const tod = Object.keys(TIME_RANGES).find((k) => text.includes(k)) ?? null;
  const deadlineMatch = text.match(/(?:before|by|until|due|deadline(?: is| on)?)\s+(.+)/);
  const deadline = deadlineMatch ? parseDateWord(deadlineMatch[1], now) : null;
  const date = parseDateWord(deadline ? text.replace(deadlineMatch[0], '') : text, now);
  const hours = hoursMatch ? Math.min(Number(hoursMatch[1]), 24) : null;

  let intent = 'find';
  if (/\b(help|what can you|how do you)\b/.test(text)) intent = 'help';
  else if (/\bmy (bookings?|schedule|slots?|sessions?|reservations?)\b|what do i have/.test(text)) intent = 'my_bookings';
  else if (/\b(pending|approvals?|approve)\b/.test(text)) intent = 'approvals';
  else if (/utili[sz]ation|idle|underused|under-used|busiest|most (used|booked)|demand/.test(text)) intent = 'insights';
  else if (/\bplan\b|\bschedule\b.*\bhours?\b|\d+\s*(h|hr|hrs|hours?)\b.*(before|by|deadline|due)/.test(text)) intent = 'plan';
  else if (/\b(free|available|availability|open|slots?|when can|book)\b/.test(text)) intent = 'availability';

  return { intent, date, tod, hours, deadline, text };
}

const cardFor = (eq, extra = {}) => ({
  type: 'equipment',
  equipment: { id: eq.id, name: eq.name, category: eq.category, location: eq.location, icon: eq.icon, status: eq.status, requiresApproval: eq.requiresApproval },
  ...extra,
});

async function findEquipment(store, ai, text) {
  const categories = [...new Set(store.data.equipment.map((e) => e.category))];
  const interpreted = await ai.interpretQuery(text, categories);
  let results = searchEquipment(store.data.equipment, text, { extraKeywords: interpreted?.keywords ?? [], limit: 4 });
  if (interpreted?.category && !results.length) {
    results = store.data.equipment.filter((e) => e.category === interpreted.category).slice(0, 4).map((equipment) => ({ equipment, score: 1, matched: [] }));
  }
  return { results, usedAi: Boolean(interpreted) };
}

function slotsFor(store, eq, parsed, now) {
  const [lo, hi] = TIME_RANGES[parsed.tod] ?? [0, 24];
  const need = parsed.hours ?? 1;
  const dates = parsed.date ? [parsed.date] : Array.from({ length: 7 }, (_, i) => addDays(now.date, i));
  const out = [];
  for (const date of dates) {
    for (const [a, b] of freeWindows(store, eq, date, now)) {
      const start = Math.max(a, lo);
      const end = Math.min(b, hi);
      if (end - start >= need) out.push({ date, startHour: start, endHour: Math.min(end, start + Math.max(need, 2)) });
    }
    if (out.length >= 4) break;
  }
  return out.slice(0, 4);
}

const myProjects = (store, user) =>
  store.data.projects.filter((p) => p.ownerId === user.id || p.memberIds.includes(user.id)).sort((a, b) => a.deadline.localeCompare(b.deadline));

export async function answerChat({ store, user, now, text, ai }) {
  const parsed = parseMessage(text, now);
  const suggestions = ['Find equipment for an IoT project', 'Plan 6 hours on the oscilloscope before Friday', 'What is free tomorrow afternoon?', 'Show my bookings'];

  switch (parsed.intent) {
    case 'help':
      return {
        reply: 'I can discover equipment from a plain-English description, check free slots, build a booking plan that fits your deadline, and explain conflicts. Try one of the prompts below.',
        cards: [], suggestions,
      };

    case 'my_bookings': {
      const upcoming = store.data.bookings
        .filter((b) => b.userId === user.id && isActive(b) && b.status !== 'completed' && (b.date > now.date || (b.date === now.date && b.endHour > now.hour)))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
        .slice(0, 6);
      return {
        reply: upcoming.length ? `You have ${upcoming.length} upcoming booking${upcoming.length > 1 ? 's' : ''}.` : 'You have no upcoming bookings. Tell me what you are working on and I will find equipment.',
        cards: upcoming.map((b) => ({ type: 'booking', booking: { id: b.id, date: b.date, startHour: b.startHour, endHour: b.endHour, status: b.status }, equipment: store.get('equipment', b.equipmentId)?.name })),
        suggestions,
      };
    }

    case 'approvals': {
      if (user.role === 'student') return { reply: 'Approvals are handled by faculty. You can track your own requests under Projects.', cards: [], suggestions };
      const pending = store.data.accessRequests.filter((r) => r.status === 'pending').length + store.data.bookings.filter((b) => b.status === 'pending').length;
      return { reply: `There ${pending === 1 ? 'is' : 'are'} ${pending} item${pending === 1 ? '' : 's'} awaiting a decision across the lab. Open the Approvals page to review them.`, cards: [], suggestions: ['Show utilisation insights'] };
    }

    case 'insights': {
      if (user.role === 'student') return { reply: 'Utilisation analytics are available to faculty and lab coordinators.', cards: [], suggestions };
      return { reply: 'The Analytics page shows utilisation, demand heatmaps and recommendations for balancing load across equipment.', cards: [], suggestions: ['Find equipment for an IoT project'] };
    }

    case 'plan': {
      const query = text.replace(/\d+\s*(h|hr|hrs|hours?)\b/gi, '');
      const { results } = await findEquipment(store, ai, query);
      const top = results[0]?.equipment;
      if (!top) return { reply: 'Which equipment should I plan around? For example: "Plan 6 hours on the oscilloscope before Friday".', cards: [], suggestions };
      const project = myProjects(store, user)[0] ?? null;
      const deadline = parsed.deadline ?? project?.deadline ?? addDays(now.date, 10);
      const hours = parsed.hours ?? 6;
      const plan = planSessions(store, user, { equipmentId: top.id, projectId: project?.id, hours, deadline, sessionHours: 2, preferred: parsed.tod ?? 'any' }, now);
      return {
        reply: plan.sessions.length
          ? `I found a plan for ${plan.plannedHours} of ${hours} h on ${top.name} before ${prettyDate(deadline)}${project ? ` for “${project.title}”` : ''}. Review it and confirm to book all sessions.`
          : `I couldn't fit sessions on ${top.name} before ${prettyDate(deadline)}. Try another deadline or similar equipment.`,
        cards: plan.sessions.length ? [{ type: 'plan', equipment: cardFor(top).equipment, sessions: plan.sessions, shortfall: plan.shortfall, notes: plan.notes, projectId: project?.id ?? null, deadline }] : [cardFor(top)],
        suggestions,
      };
    }

    case 'availability': {
      const { results } = await findEquipment(store, ai, text);
      if (!results.length) return { reply: 'Which equipment do you mean? Describe it (e.g. "oscilloscope" or "3D printer") and I will check.', cards: [], suggestions };
      const cards = results.slice(0, 3).map(({ equipment }) => ({ ...cardFor(equipment), slots: slotsFor(store, equipment, parsed, now) }));
      const withSlots = cards.filter((c) => c.slots.length).length;
      const when = parsed.date ? `on ${parsed.date}${parsed.tod ? ` (${parsed.tod})` : ''}` : 'this week';
      return { reply: withSlots ? `Here is what is free ${when}. Pick a slot to book it.` : `Nothing matching is free ${when}. Try a different day, or join a waitlist from the equipment page.`, cards, suggestions };
    }

    default: {
      const { results, usedAi } = await findEquipment(store, ai, text);
      if (!results.length) return { reply: 'I could not match that to any equipment. Try describing what you need to measure, build or analyse.', cards: [], suggestions };
      return {
        reply: `Based on ${usedAi ? 'an AI reading of your request' : 'your description'}, ${results.length === 1 ? 'this looks like the best fit' : `these ${results.length} look like the best fits`}.`,
        cards: results.map(({ equipment, matched }) => {
          const free = nextFree(store, equipment, now);
          return cardFor(equipment, { matched, nextFree: free, note: free ? `Next free: ${free.date} ${hourLabel(free.startHour)}` : 'No free slot in 2 weeks' });
        }),
        suggestions,
      };
    }
  }
}
