import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realSessions, compareRate, tally, l3Table } from '../scripts/twin-diff.mjs';

const view = (id, lastSeq, time) => JSON.stringify({ kind: 'http', method: 'GET', status: 200, path: `/api/characters/${id}`,
  resp: { characterId: id, name: 'x', lastSeq, running: true, snapshot: { time, mapId: 'prt_fild08', character: { job: 'thief' } } } });
const sse = (id, events) => JSON.stringify({ kind: 'sse', name: 'events', path: `/api/characters/${id}/stream?after=0`, data: events });
const ev = (seq, simTime, body) => ({ seq, simTime, wallMs: simTime, body });

test('realSessions: T0 = first view; counts events after its lastSeq; active time skips gaps ≥ 60 s; dedupes seq', () => {
  const lines = [
    view(7, 10, 1000),
    view(7, 50, 999999), // later view: not T0
    sse(7, [ev(9, 900, { type: 'kill', monsterId: 1 }), ev(11, 1000, { type: 'searching' }), ev(12, 31000, { type: 'kill', monsterId: 1 }),
      ev(13, 31000, { type: 'exp', base: 10, job: 5 }), ev(14, 41000, { type: 'pickup', itemId: 2, qty: 3 })]),
    sse(7, [ev(14, 41000, { type: 'pickup', itemId: 2, qty: 3 }), ev(15, 300000, { type: 'useItem', itemId: 501 }), // 259 s gap: not active
      ev(16, 310000, { type: 'death', monsterId: 1 }), ev(17, 320000, { type: 'shopSell', zeny: 40 }), ev(18, 330000, { type: 'autoBuy', zeny: 15 })]),
  ];
  const [s] = realSessions(lines);
  assert.equal(s.id, 7);
  assert.equal(s.t0.lastSeq, 10);
  assert.equal(s.activeMs, 30000 + 10000 + 10000 + 10000 + 10000);
  assert.deepEqual(s.counts, { kills: 1, baseExp: 10, zeny: 25, deaths: 1, potions: 1, drops: 3 });
});

test('tally: party EXP shares count as EXP, not kills; auto/shop sells add zeny, buys subtract', () => {
  const t = tally([{ type: 'exp', base: 5, job: 1, party: true }, { type: 'kill' }, { type: 'autoSell', zeny: 7 }, { type: 'shopBuy', zeny: 2 }]);
  assert.deepEqual(t, { kills: 1, baseExp: 5, zeny: 5, deaths: 0, potions: 0, drops: 0 });
  assert.deepEqual(t.n, { baseExp: 1, zeny: 2 });
});

test('compareRate: same rate passes; Poisson-significant gap beyond ±10% fails; ±10% passes even when significant', () => {
  assert.equal(compareRate({ real: 100, realH: 1, twin: 200, twinH: 2 }).ok, true);
  assert.equal(compareRate({ real: 1000, realH: 1, twin: 500, twinH: 1 }).ok, false);
  assert.equal(compareRate({ real: 100000, realH: 1, twin: 95000, twinH: 1 }).ok, true); // −5%: within ±10%
  assert.equal(compareRate({ real: 3, realH: 1, twin: 5, twinH: 1 }).ok, true); // small counts: inside the Poisson CI
  assert.equal(compareRate({ real: 0, realH: 1, twin: 0, twinH: 1 }).ok, true);
  // non-count metric (EXP) judged with the relative error of the exp events behind it
  assert.equal(compareRate({ real: 1000, realH: 1, twin: 1300, twinH: 1, relErrFrom: { real: 4, twin: 4 } }).ok, true);
  assert.equal(compareRate({ real: 1000, realH: 1, twin: 1300, twinH: 1, relErrFrom: { real: 4000, twin: 4000 } }).ok, false);
  // a twin that earned nothing fails against a real rate built from many events (review: twin 0 used to pass)
  assert.equal(compareRate({ real: 4733, realH: 1, twin: 0, twinH: 1, relErrFrom: { real: 120, twin: 0 } }).ok, false);
  assert.equal(compareRate({ real: 0, realH: 1, twin: 0, twinH: 1, relErrFrom: { real: 0, twin: 0 } }).ok, true);
});

test('l3Table: each twin is judged over its own real farming time; one ✅/❌ per metric', () => {
  const counts = (o) => Object.defineProperty({ kills: 0, baseExp: 0, zeny: 0, deaths: 0, potions: 0, drops: 0, ...o }, 'n', { value: { baseExp: o.kills ?? 0, zeny: 0 } });
  const sessions = [{ id: 1, job: 'thief', baseLv: 50, mapId: 'm', activeMs: 2 * 3600e3, counts: counts({ kills: 200, baseExp: 2000 }) }];
  const run = { simMs: 3 * 3600e3, twins: [{ id: 1, simMs: 2 * 3600e3, counts: counts({ kills: 202, baseExp: 2020 }) }] };
  const t = l3Table(sessions, run);
  assert.equal(t.total, 6);
  assert.equal(t.pass, 6);
  assert.match(t.rows[0], /✅ 100 → 101/);
});
