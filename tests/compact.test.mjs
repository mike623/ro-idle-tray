import assert from 'node:assert/strict';
import test from 'node:test';
const { attention, overview, shown } = await import('../src/compact.js');

const p = (info, extra = {}) => ({ n: 1, info: { name: 'A', running: true, hp: 100, maxHp: 100, weight: 10, weightMax: 100, ...info }, ...extra });

test('a character needs attention when stopped while others idle, nearly dead, or overweight', () => {
  assert.equal(attention(p({}), true), null);
  assert.equal(attention(p({ running: false }), true), '已停止，其他角色在掛機');
  assert.equal(attention(p({ running: false }), false), null);
  assert.equal(attention(p({ running: false, stopping: true }), true), null);
  assert.equal(attention(p({ hp: 20, maxHp: 100 }), true), 'HP 20 / 100，低於 25%');
  assert.equal(attention(p({ weight: 95, weightMax: 100 }), true), '負重 95%，無法攻擊');
  assert.equal(attention(p({ running: false }, { offline: true }), true), null);
  assert.equal(attention({ n: 2, roster: [] }, true), null);
});

const live = (n, info) => ({ n, info: { name: `C${n}`, running: true, hp: 100, maxHp: 100, map: '斐揚森林 01', ...info } });

test('overview counts attention, idling and offline, and names the map everyone shares', () => {
  const profiles = [
    live(1, {}), live(2, { running: false }), live(3, {}),
    { n: 4, offline: true, info: { name: 'C4', running: true, map: '普隆德拉' } },
    { n: 5, roster: [{ name: 'x' }] },
  ];
  const o = overview(profiles);
  assert.deepEqual(o.counts, { attention: 1, idle: 2, offline: 1 });
  assert.equal(o.reasons.get(2), '已停止，其他角色在掛機');
  assert.equal(o.map, '斐揚森林 01');
  assert.equal(overview([live(1, {}), live(2, { map: '吉芬' })]).map, null);
  assert.equal(overview([]).map, null);
});

test('status filter keeps only matching characters; all keeps everyone', () => {
  const profiles = [live(1, {}), live(2, { running: false }), live(3, {}), { n: 4, offline: true, info: { name: 'C4' } }];
  const { reasons } = overview(profiles);
  const ns = (f) => profiles.filter((p) => shown(p, f, reasons)).map((p) => p.n);
  assert.deepEqual(ns('all'), [1, 2, 3, 4]);
  assert.deepEqual(ns('attention'), [2]);
  assert.deepEqual(ns('idle'), [1, 3]);
  assert.deepEqual(ns('offline'), [4]);
});
