import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../server/lib/time.js';
import { planSessions } from '../server/services/planner.js';
import { buildResolution, similarity } from '../server/services/resolver.js';
import { searchEquipment } from '../server/services/search.js';
import { NOW, TUESDAY, createSeededStore } from './helpers.js';

const store = createSeededStore();
const arjun = store.get('users', 'u-arjun');
const request = { equipmentId: 'eq-sa', projectId: 'p-5g', date: TUESDAY, startHour: 11, endHour: 13 };

describe('conflict resolver', () => {
  const resolution = buildResolution(store, arjun, request, NOW);
  const types = resolution.options.map((o) => o.type);

  it('explains the conflict and the requester priority', () => {
    assert.equal(resolution.errors[0].code, 'CONFLICT');
    assert.equal(resolution.conflicts.length, 1);
    assert.ok(resolution.requester.score > 50);
  });

  it('offers nearby slots on the same equipment, sorted by rank', () => {
    assert.ok(types.includes('alt_slot'));
    const ranks = resolution.options.map((o) => o.rank);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
  });

  it('offers a fair-share swap when the holder is lower priority and flexible', () => {
    const swap = resolution.options.find((o) => o.type === 'swap');
    assert.ok(swap, 'swap option expected');
    assert.equal(swap.action.kind, 'swap');
    assert.ok(swap.action.holderScore < resolution.requester.score);
  });

  it('suggests equivalent equipment and an access path for restricted ones', () => {
    const alts = resolution.options.filter((o) => o.type === 'alt_equipment');
    assert.ok(alts.length >= 1);
    assert.ok(alts.some((o) => o.action.kind === 'request_access' || o.action.sessions[0].equipmentId !== 'eq-sa'));
  });

  it('always includes a waitlist fallback', () => {
    assert.ok(types.includes('waitlist'));
  });

  it('never proposes a slot that is itself in conflict', () => {
    for (const opt of resolution.options.filter((o) => o.action.kind === 'book')) {
      for (const s of opt.action.sessions) {
        const check = buildResolution(store, arjun, s, NOW);
        assert.ok(!check.errors.some((e) => e.code === 'CONFLICT'), `${opt.title} conflicts`);
      }
    }
  });

  it('hides holder identity from students but not from faculty', () => {
    assert.equal(resolution.conflicts[0].holder, undefined);
    const asFaculty = buildResolution(store, store.get('users', 'u-rao'), request, NOW);
    assert.equal(asFaculty.conflicts[0].holder, 'Vikram Singh');
  });

  it('does not offer a swap against a higher-priority holder', () => {
    const vikram = store.get('users', 'u-vikram');
    const reverse = buildResolution(store, vikram, { ...request, projectId: 'p-drone' }, NOW);
    assert.ok(!reverse.options.some((o) => o.type === 'swap'));
  });
});

describe('similarity', () => {
  it('rates same-family instruments higher than unrelated ones', () => {
    const get = (id) => store.get('equipment', id);
    assert.ok(similarity(get('eq-sa'), get('eq-vna')) > similarity(get('eq-sa'), get('eq-utm')));
    assert.equal(similarity(get('eq-sa'), get('eq-utm')), 0);
  });
});

describe('planner', () => {
  it('spreads sessions before the deadline within quota', () => {
    const { sessions, shortfall } = planSessions(store, arjun, { equipmentId: 'eq-rpi', projectId: 'p-5g', hours: 6, deadline: addDays(NOW.date, 4), sessionHours: 2, preferred: 'any' }, NOW);
    assert.equal(shortfall, 0);
    assert.ok(sessions.length >= 3);
    assert.ok(sessions.every((s) => s.date <= addDays(NOW.date, 4)));
    assert.equal(new Set(sessions.map((s) => s.date)).size, sessions.length, 'one session per day');
  });

  it('reports a shortfall when the deadline is too tight', () => {
    const plan = planSessions(store, arjun, { equipmentId: 'eq-dso', projectId: 'p-5g', hours: 40, deadline: addDays(NOW.date, 2), sessionHours: 2, preferred: 'any' }, NOW);
    assert.ok(plan.shortfall > 0);
    assert.ok(plan.notes.length > 0);
  });

  it('honours time-of-day preferences when possible', () => {
    const { sessions } = planSessions(store, arjun, { equipmentId: 'eq-rpi', projectId: 'p-5g', hours: 2, deadline: addDays(NOW.date, 6), sessionHours: 2, preferred: 'afternoon' }, NOW);
    assert.ok(sessions[0].startHour >= 12);
  });
});

describe('semantic search', () => {
  const all = store.data.equipment;
  const top = (q) => searchEquipment(all, q)[0]?.equipment.id;

  it('matches natural-language needs to equipment', () => {
    assert.equal(top('I want to 3D print a prototype enclosure'), 'eq-fdm');
    assert.equal(top('measure absorbance of nanoparticle solution'), 'eq-uvvis');
    assert.equal(top('train a deep learning model on a GPU'), 'eq-gpu');
    assert.ok(['eq-pcr', 'eq-gel'].includes(top('amplify DNA for CRISPR')));
  });

  it('uses concept expansion for indirect wording', () => {
    const ids = searchEquipment(all, 'debug my embedded firmware signals').map((r) => r.equipment.id);
    assert.ok(ids.includes('eq-dso') && ids.includes('eq-stm32'));
  });

  it('returns nothing for gibberish', () => {
    assert.deepEqual(searchEquipment(all, 'zzzz qqqq'), []);
  });
});
