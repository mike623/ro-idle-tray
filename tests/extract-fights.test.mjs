import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {extractFights, observe, stratify} from '../scripts/extract-fights.mjs';

const ev = (seq, simTime, body) => ({seq, simTime, wallMs: simTime, body});
const sse = (id, events) => ({t: 0, kind: 'sse', path: `/api/characters/${id}/stream?after=0`, name: 'events', data: JSON.stringify(events)});
const snap = (id, time, extra = {}) => ({t: 0, kind: 'sse', path: `/api/characters/${id}/stream`, name: 'snapshot', data: JSON.stringify({snapshot: {
  time, mapId: 'pay_fild01',
  character: {name: 'Me', job: 'swordman', baseLv: 20, hp: 300, skills: {SM_BASH: 5}},
  derived: {maxHp: 300, hit: 50},
  equipment: {weapon: 7},
  inventory: [{uid: 7, itemId: 1101, refine: 4, cards: []}, {uid: 8, itemId: 501, qty: 3}],
  buffs: [{id: 'AL_BLESSING', remainingMs: 5000, lv: 10}],
  config: {skills: [{allyNames: ['Other Player']}]},
  ...extra,
}})});

test('one found→kill fight carries snapshot, mob, map, trimmed events', () => {
  const records = [snap(1, 1000), sse(1, [
    ev(10, 2000, {type: 'found', uid: 99, monsterId: 1002, approachMs: 300}),
    ev(11, 2500, {type: 'playerAttack', uid: 99, monsterId: 1002, damage: 40, hits: 1, result: 'crit', hpLeft: 10, me: [300, 5], elementMod: 100}),
    ev(12, 2600, {type: 'chat', text: 'secret'}),
    ev(13, 2700, {type: 'monsterAttack', uid: 99, monsterId: 1002, damage: 12, result: 'hit', hpLeft: 288, maxHp: 300, me: [288, 5]}),
    ev(14, 2900, {type: 'skillHit', uid: 99, skill: 'SM_BASH', damage: 30, result: 'hit', hpLeft: 0}),
    ev(15, 2900, {type: 'kill', uid: 99, monsterId: 1002}),
    ev(16, 3000, {type: 'exp', by: 'Other Player', base: 5}),
  ])];
  const {fights} = extractFights(records);
  assert.equal(fights.length, 1);
  const f = fights[0];
  assert.equal(f.id, '1:99');
  assert.equal(f.charId, 1);
  assert.equal(f.mobId, 1002);
  assert.equal(f.mapId, 'pay_fild01');
  assert.equal(f.outcome, 'kill');
  assert.equal(f.charSnapshot.character.job, 'swordman');
  assert.equal(f.charSnapshot.character.name, undefined);
  assert.equal(f.startSimTime, 2000);
  assert.equal(f.mobHpStart, 50);
  assert.deepEqual(f.charSnapshot.skills, {SM_BASH: 5});
  assert.deepEqual(f.charSnapshot.equipment, {weapon: {itemId: 1101, refine: 4, cards: []}});
  assert.equal(f.charSnapshot.derived.maxHp, 300);
  assert.equal(f.charSnapshot.snapshotAgeMs, 1000);
  assert.deepEqual(f.buffs, [{id: 'AL_BLESSING', lv: 10, remainingMs: 4000}]);
  assert.deepEqual(f.events, [
    {type: 'found', t: 0, approachMs: 300},
    {type: 'playerAttack', t: 500, damage: 40, result: 'crit', hits: 1, hpLeft: 10},
    {type: 'monsterAttack', t: 700, damage: 12, result: 'hit', hpLeft: 288},
    {type: 'skillHit', t: 900, damage: 30, result: 'hit', skill: 'SM_BASH', hpLeft: 0},
    {type: 'kill', t: 900},
  ]);
  assert.doesNotMatch(JSON.stringify(f), /Other Player|secret|"Me"/);
});

test('death ends a fight; abandoned fights are counted not emitted; replays dedupe; party = own chars on same map', () => {
  const fightA = [
    ev(20, 2000, {type: 'found', uid: 5, monsterId: 1010}),
    ev(21, 2100, {type: 'monsterAttack', uid: 5, monsterId: 1010, damage: 300, result: 'hit', hpLeft: 0, me: [0, 0]}),
  ];
  const records = [
    snap(1, 1000), snap(2, 1500), snap(3, 1500, {mapId: 'prontera'}),
    sse(1, fightA),
    {t: 0, kind: 'http', method: 'GET', status: 200, path: '/api/characters/1/events?after=0', resp: JSON.stringify({events: fightA})},
    sse(1, [
      ev(30, 4000, {type: 'found', uid: 6, monsterId: 1010}),
      ev(31, 4100, {type: 'mapChange', from: 'pay_fild01', to: 'prontera'}),
      ev(32, 5000, {type: 'found', uid: 7, monsterId: 1010}),
      ev(33, 5100, {type: 'found', uid: 8, monsterId: 1011}),
      ev(34, 5200, {type: 'kill', uid: 8, monsterId: 1011}),
    ]),
  ];
  const {fights, stats} = extractFights(records);
  assert.deepEqual(fights.map(f => [f.id, f.outcome]), [['1:5', 'death'], ['1:8', 'kill']]);
  assert.deepEqual(fights[0].partyIds, [2]);
  assert.equal(fights[1].mapId, 'prontera');
  assert.deepEqual(fights[1].partyIds, [3]);
  assert.deepEqual(stats, {opened: 4, kill: 1, death: 1, abandoned: 2, noSnapshot: 0});
  assert.equal(fights[0].start, 'found');
});

test('assist targetSwitch opens a fight tagged start=assist and drops the ally name', () => {
  const {fights} = extractFights([snap(1, 1000), sse(1, [
    ev(40, 2000, {type: 'targetSwitch', uid: 9, monsterId: 1085, ally: 'Other Player', assist: true}),
    ev(41, 2400, {type: 'playerAttack', uid: 9, monsterId: 1085, damage: 50, result: 'hit', hpLeft: 0}),
    ev(42, 2400, {type: 'kill', uid: 9, monsterId: 1085}),
  ])]);
  assert.deepEqual(fights.map(f => [f.id, f.start, f.outcome]), [['1:9', 'assist', 'kill']]);
  assert.deepEqual(fights[0].events[0], {type: 'targetSwitch', t: 0});
  assert.doesNotMatch(JSON.stringify(fights), /Other Player/);
});

test('observe: duration, damage taken, hits landed/received from trimmed events', () => {
  const [f] = extractFights([snap(1, 1000), sse(1, [
    ev(1, 2000, {type: 'found', uid: 9, monsterId: 1085}),
    ev(2, 2100, {type: 'playerAttack', uid: 9, damage: 0, result: 'miss'}),
    ev(3, 2200, {type: 'playerAttack', uid: 9, damage: 20, result: 'hit', hits: 2}),
    ev(4, 2300, {type: 'monsterAttack', uid: 9, damage: 7, result: 'hit'}),
    ev(5, 2350, {type: 'monsterAttack', uid: 4, monsterId: 1013, damage: 3, result: 'crit'}),
    ev(6, 2400, {type: 'mobSkill', uid: 9, skill: 'NPC_GROUNDATTACK', damage: 0, result: 'perfectDodge'}),
    ev(7, 2500, {type: 'skillHit', uid: 9, skill: 'MG_FIREBOLT', damage: 40, result: 'hit'}),
    ev(8, 2600, {type: 'kill', uid: 9}),
  ])]).fights;
  assert.deepEqual(observe(f), {id: '1:9', charId: 1, job: 'swordman', mapId: 'pay_fild01', mobId: 1085, start: 'found', outcome: 'kill',
    durationMs: 600, damageTaken: 10, hitsLanded: 2, attacksMade: 3, hitsReceived: 2, attacksReceived: 3, ownDamage: 60, mobHpStart: null});
});

test('stratify takes every char/job|map|mob|outcome stratum before a second fight from any', () => {
  const mk = (i, job, mobId, outcome, charId = 1) => ({id: `x:${i}`, charId, mobId, mapId: 'm', outcome, charSnapshot: {character: {job}}});
  const fights = [...Array(10)].map((_, i) => mk(i, 'mage', 1, 'kill')).concat([mk(20, 'thief', 1, 'kill'), mk(21, 'mage', 2, 'kill'), mk(22, 'mage', 1, 'death'), mk(23, 'mage', 1, 'kill', 2)]);
  const picked = stratify(fights, 6);
  assert.equal(picked.length, 6);
  assert.deepEqual(picked.filter(f => Number(f.id.slice(2)) >= 20).map(f => f.id).sort(), ['x:20', 'x:21', 'x:22', 'x:23']);
  assert.deepEqual(stratify(fights, 99).length, 14);
});

test('CLI writes fights.jsonl + summary.json from capture files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro-fights-'));
  try {
    const cap = path.join(dir, 'cap.jsonl');
    fs.writeFileSync(cap, [snap(1, 1000), sse(1, [ev(1, 2000, {type: 'found', uid: 9, monsterId: 1085}), ev(2, 2600, {type: 'kill', uid: 9})])].map(r => JSON.stringify(r)).join('\n') + '\n');
    const out = path.join(dir, 'out');
    const r = spawnSync(process.execPath, [new URL('../scripts/extract-fights.mjs', import.meta.url).pathname, cap, '--out', out], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    const lines = fs.readFileSync(path.join(out, 'fights.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(lines.map(f => f.id), ['1:9']);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.totals.kill, 1);
    assert.deepEqual(summary.fights.map(f => [f.id, f.durationMs]), [['1:9', 600]]);
    assert.match(r.stdout, /1 fights/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('buffs started after the snapshot take lv from the matching skillCast/support', () => {
  const [f] = extractFights([snap(1, 1000, {buffs: []}), sse(1, [
    ev(1, 1200, {type: 'support', from: 'Other Player', skill: 'AL_INCAGI', lv: 3}),
    ev(2, 1200, {type: 'buffStart', buffId: 'AL_INCAGI', durationMs: 60000}),
    ev(3, 1300, {type: 'skillCast', skill: 'SM_ENDURE', lv: 2}),
    ev(4, 1300, {type: 'buffStart', buffId: 'SM_ENDURE', durationMs: 10000}),
    ev(5, 2000, {type: 'found', uid: 9, monsterId: 1085}),
    ev(6, 2100, {type: 'kill', uid: 9}),
  ])]).fights;
  assert.deepEqual(f.buffs, [{id: 'AL_INCAGI', lv: 3, remainingMs: 59200}, {id: 'SM_ENDURE', lv: 2, remainingMs: 9300}]);
});

test('CLI rejects a --max without a number', () => {
  const r = spawnSync(process.execPath, [new URL('../scripts/extract-fights.mjs', import.meta.url).pathname, 'x.jsonl', '--out', 'o', '--max'], {encoding: 'utf8'});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage/);
});
