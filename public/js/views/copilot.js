// AI Copilot: conversational equipment discovery, availability and planning.
import { api } from '../api.js';
import { accessBadge } from '../components/equipmentCard.js';
import { h } from '../dom.js';
import { range, relativeDay, shortDate } from '../format.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { state } from '../state.js';
import { announce, guarded, tile } from '../ui.js';

const STARTERS = [
  'I am building an IoT weather station',
  'Which equipment helps me test a 5G antenna?',
  'What is free tomorrow afternoon on the 3D printer?',
  'Plan 6 hours on the oscilloscope before Friday',
  'Show my bookings',
];

function slotButton(eq, s) {
  const label = `${relativeDay(s.date, state.meta.now.date)} ${range(s.startHour, s.endHour)}`;
  return h('button', { class: 'chip', 'aria-label': `Book ${eq.name} ${label}`, onclick: () => go(`/equipment/${eq.id}?date=${s.date}&start=${s.startHour}&end=${s.endHour}`) }, icon('calendar-check', { size: 14 }), label);
}

function renderCard(card) {
  if (card.type === 'equipment') {
    const eq = card.equipment;
    return h('div', { class: 'mini-card' },
      h('div', { class: 'row row--nowrap' }, tile(eq, 'sm'), h('div', { class: 'item__body' }, h('a', { href: `#/equipment/${eq.id}`, class: 'strong' }, eq.name), h('div', { class: 'xs faint' }, eq.location)), accessBadge(eq.requiresApproval ? 'required' : 'open')),
      card.matched?.length > 0 && h('div', { class: 'why' }, icon('sparkles', { size: 13 }), card.matched.slice(0, 4).map((m) => h('mark', null, m))),
      card.note && h('div', { class: 'small muted' }, card.note),
      card.slots && (card.slots.length ? h('div', { class: 'chips' }, card.slots.map((s) => slotButton(eq, s))) : h('div', { class: 'small muted' }, 'No matching free slots.')),
      card.nextFree && h('div', { class: 'chips' }, slotButton(eq, card.nextFree)));
  }
  if (card.type === 'plan') {
    return h('div', { class: 'mini-card' },
      h('div', { class: 'strong' }, `${card.equipment.name} — proposed plan`),
      h('ul', { class: 'stack stack--sm' }, card.sessions.map((s) => h('li', { class: 'row small' }, icon('calendar-check', { size: 15 }), `${shortDate(s.date)} · ${range(s.startHour, s.endHour)}`))),
      card.notes.map((n) => h('div', { class: 'xs faint' }, n)),
      h('div', { class: 'row' }, h('button', { class: 'btn btn--primary btn--sm', onclick: (e) => guarded(async () => { await api.post('/api/bookings/commit', { sessions: card.sessions, purpose: 'Planned with Copilot' }); go('/bookings'); }, { success: `Booked ${card.sessions.length} sessions.`, button: e.currentTarget, busy: 'Booking…' }) }, `Book all ${card.sessions.length}`),
        h('a', { class: 'btn btn--sm', href: `#/planner?equipment=${card.equipment.id}${card.projectId ? `&project=${card.projectId}` : ''}` }, 'Adjust in Planner')));
  }
  if (card.type === 'booking') {
    return h('a', { class: 'mini-card', href: '#/bookings' }, h('div', { class: 'strong' }, card.equipment), h('div', { class: 'small muted' }, `${shortDate(card.booking.date)} · ${range(card.booking.startHour, card.booking.endHour)} · ${card.booking.status}`));
  }
  return null;
}

export async function copilotView({ query }) {
  const log = h('div', { class: 'chat__log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with LabLink Copilot', tabindex: '0' });
  const input = h('input', { class: 'input', id: 'chat-input', maxlength: '400', placeholder: 'Ask about equipment, slots or a plan…', autocomplete: 'off', 'aria-label': 'Your message' });
  const send = h('button', { class: 'btn btn--primary', type: 'submit' }, icon('send', { size: 16 }), 'Send');
  const suggestions = h('div', { class: 'chips' });
  let busy = false;

  const botBubble = (content) => h('div', { class: 'msg msg--bot' }, h('span', { class: 'bot-avatar', 'aria-hidden': 'true' }, icon('sparkles', { size: 18 })), h('div', null, h('div', { class: 'bubble' }, content)));
  const scroll = () => { log.scrollTop = log.scrollHeight; };

  function say(text, who = 'user') {
    log.append(h('div', { class: `msg msg--${who}` }, h('div', { class: 'bubble' }, text)));
    scroll();
  }

  function setSuggestions(list) {
    suggestions.replaceChildren(...list.map((t) => h('button', { type: 'button', class: 'chip', onclick: () => ask(t) }, t)));
  }

  async function ask(text) {
    const message = text.trim();
    if (!message || busy) return;
    busy = true;
    send.disabled = true;
    input.value = '';
    say(message);
    const typing = h('div', { class: 'msg msg--bot' }, h('span', { class: 'bot-avatar' }, icon('sparkles', { size: 18 })), h('div', { class: 'bubble', 'aria-label': 'Copilot is thinking' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i'))));
    log.append(typing);
    scroll();
    try {
      const res = await api.post('/api/ai/chat', { message });
      typing.remove();
      const cards = res.cards.map(renderCard).filter(Boolean);
      log.append(h('div', { class: 'msg msg--bot' }, h('span', { class: 'bot-avatar', 'aria-hidden': 'true' }, icon('sparkles', { size: 18 })),
        h('div', null, h('div', { class: 'bubble' }, res.reply), cards.length > 0 && h('div', { class: 'msg__cards' }, cards))));
      announce(res.reply);
      setSuggestions(res.suggestions ?? STARTERS);
    } catch (err) {
      typing.remove();
      log.append(botBubble(h('span', { class: 'error-text' }, err.message)));
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
      scroll();
    }
  }

  log.append(botBubble(h('div', { class: 'stack stack--sm' }, h('strong', null, `Hi ${state.user.name.split(' ')[0]}! I’m LabLink Copilot.`),
    h('span', null, 'Describe what you are working on and I’ll find the right equipment, check free slots, or plan your lab hours around a deadline.'))));
  setSuggestions(STARTERS);
  if (query.q) setTimeout(() => ask(query.q), 150);

  return h('div', { class: 'page' },
    h('header', { class: 'page__header' }, h('div', null, h('p', { class: 'eyebrow' }, 'AI assistant'), h('h1', { class: 'page__title', tabindex: '-1' }, 'LabLink Copilot'),
      h('p', { class: 'page__sub' }, state.mode === 'gemini' ? 'Powered by Gemini for understanding requests, with LabLink’s scheduling engine doing the booking math.' : 'Running on LabLink’s local language engine. Add a Gemini API key on the server to enable LLM understanding.'))),
    h('div', { class: 'grid grid--split' },
      h('section', { class: 'card chat', 'aria-label': 'Chat' }, log,
        h('div', { class: 'card--tight' }, suggestions),
        h('form', { class: 'chat__input', onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, h('label', { class: 'sr-only', for: 'chat-input' }, 'Your message'), input, send)),
      h('aside', { class: 'stack' },
        h('section', { class: 'card stack stack--sm' }, h('h2', { class: 'card__title' }, 'What I can do'),
          ['Find equipment from a description', 'Show free slots by day and time of day', 'Build a booking plan before a deadline', 'Summarise your upcoming bookings'].map((t) => h('div', { class: 'row row--nowrap small' }, icon('check-circle', { size: 16 }), t))),
        h('section', { class: 'card stack stack--sm' }, h('h2', { class: 'card__title' }, 'Good to know'),
          h('p', { class: 'small muted' }, 'Every action opens the real booking flow, so fair-use quotas, access approvals and conflict resolution always apply.'),
          h('p', { class: 'small muted' }, `Try phrases like “tomorrow morning”, “for 3 hours” or “before ${shortDate(state.meta.now.date)}”.`)))));
}
