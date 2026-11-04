import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as e from './engine.js';

test('mulberry32 is deterministic per seed and in [0,1)', () => {
  const a = e.mulberry32(42), b = e.mulberry32(42), c = e.mulberry32(43);
  const xs = Array.from({ length: 5 }, a);
  assert.deepEqual(xs, Array.from({ length: 5 }, b));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, c));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

// Thief (capture profile-1, 2026-11-04 snapshot) and Spore (src/game-data.json, trimmed).
const thief = { job: 'thief', baseLv: 50, jobLv: 41, hp: 952, sp: 112, maxHp: 952, maxSp: 123, statusAtk: 18,
  weapon: { weaponType: 'dagger', weaponLevel: 1, atk: 17 }, refineAtk: 14, atkBonus: 0, dex: 22, vit: 2, vitDefRate: 0,
  int: 2, matkMin: 2, matkMax: 2, hit: 72, flee: 146, crit: 2, perfectDodge: 1, hardDef: 5, attackIntervalMs: 662,
  moveSpeedMs: 112, attackRange: 1, skills: { TF_DOUBLE: 10 } };
const spore = { id: 1014, lv: 16, hp: 510, atk: [24, 48], def: 0, mdef: 5, stats: { str: 0, agi: 12, vit: 12, int: 5, dex: 19, luk: 8 },
  range: 1, size: 'medium', element: 'water', elementLv: 1, behavior: 'passive', walkSpeed: 200, attackDelay: 1872,
  baseExp: 66, jobExp: 108, drops: [{ itemId: 7033, rate: 5500 }], card: { itemId: 4022, rate: 1 }, skills: [] };
const fixed = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };
const newFight = (o = {}) => e.startFight({ char: { ...thief }, mob: { ...spore }, uid: 7, ...o });

test('normal attack: hit rolls captured single-hit damage and reports mob HP left', () => {
  const s = newFight();
  const r = e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0.5));
  assert.equal(r.ok, true);
  assert.deepEqual(s.events.at(-1), { t: 0, body: { type: 'playerAttack', uid: 7, monsterId: 1014, me: [952, 112],
    damage: 32, hpLeft: 478, result: 'hit', elementMod: 100 } });
});

test('attacks faster than the ASPD interval are rejected', () => {
  const s = newFight();
  e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0.5));
  assert.deepEqual(e.resolveAction(s, { type: 'attack', at: 661 }, fixed(0.5)), { ok: false, error: 'TOO_EARLY', retryAt: 662 });
  assert.equal(e.resolveAction(s, { type: 'attack', at: 662 }, fixed(0.5)).ok, true);
});

test('the killing blow emits kill and ends the fight', () => {
  const s = newFight({ mobHp: 30 });
  e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0.5));
  assert.deepEqual(s.events.map((x) => x.body.type), ['playerAttack', 'kill']);
  assert.deepEqual(s.events[1], { t: 0, body: { type: 'kill', uid: 7, monsterId: 1014 } });
  assert.equal(s.over, 'kill');
  assert.equal(e.resolveAction(s, { type: 'attack', at: 5000 }, fixed(0.5)).error, 'FIGHT_OVER');
});

test('a passive mob swings back after the first hit, then every attackDelay; high FLEE makes it miss', () => {
  const s = newFight();
  e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0.5));
  e.mobTurn(s, 5000, fixed(0.5));
  const swings = s.events.filter((x) => x.body.type === 'monsterAttack');
  assert.deepEqual(swings.map((x) => x.t), [936, 2808, 4680]); // 0 + uniformInt(0,1872) at 0.5, then +1872
  assert.deepEqual(swings[0].body, { type: 'monsterAttack', uid: 7, monsterId: 1014, me: [952, 112], damage: 0,
    hpLeft: 952, maxHp: 952, result: 'miss' });
});

test('mob hits land monster damage through hard and soft DEF; 0 HP is death', () => {
  const s = newFight({ char: { ...thief, flee: 0, hp: 40 } });
  e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0.5));
  e.mobTurn(s, 5000, fixed(0.5));
  const swings = s.events.filter((x) => x.body.type === 'monsterAttack');
  // atk roll 36 → floor(36×95%)=34 − soft DEF 1 (VIT 2) = 33
  assert.deepEqual(swings.map((x) => [x.body.damage, x.body.hpLeft, x.body.result]), [[33, 7, 'hit'], [33, 0, 'hit']]);
  assert.deepEqual(s.events.at(-1), { t: 2808, body: { type: 'death', uid: 7, monsterId: 1014 } });
  assert.equal(s.over, 'death');
});

test('passive mobs never swing before being hit', () => {
  const s = newFight();
  e.mobTurn(s, 10000, fixed(0.5));
  assert.equal(s.events.length, 0);
});

test('mob attack skills fire by rate (per 10000) with their own cooldown, as mobSkill', () => {
  const horn = { ...spore, id: 1128, attackDelay: 1528, skills: [
    { state: 'attack', skill: 'NPC_GROUNDATTACK', lv: 1, rate: 2000, delayMs: 5000, cond: 'always', element: 'earth' },
    { state: 'idle', skill: 'NPC_EMOTION', lv: 1, rate: 2000, delayMs: 5000, cond: 'always' }] };
  const s = newFight({ mob: horn, char: { ...thief, flee: 0 } });
  e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0.5));
  e.mobTurn(s, 3000, fixed(0.5, 0.1));
  const mob = s.events.filter((x) => x.body.type !== 'playerAttack');
  assert.deepEqual(mob.map((x) => [x.t, x.body.type, x.body.skill]), [[764, 'mobSkill', 'NPC_GROUNDATTACK'], [2292, 'monsterAttack', undefined]]);
  assert.deepEqual(Object.keys(mob[0].body), ['type', 'uid', 'monsterId', 'skill', 'lv', 'damage', 'result']);
});

// Mage (capture profile-2 snapshot) casting Lightning Bolt Lv4 (game-data skill row, trimmed) on Horn.
const bolt = { id: 'MG_LIGHTNINGBOLT', kind: 'attack', attackType: 'magic', element: 'wind', sp: [12, 14, 16, 18],
  castMs: [700, 1400, 2100, 2800], delayMs: [1000, 1200, 1400, 1600], cooldownMs: [], hits: [1, 2, 3, 4] };
const mage = { ...thief, job: 'mage', sp: 481, maxSp: 501, dex: 44, int: 65, matkMin: 146, matkMax: 234, attackIntervalMs: 1104,
  weapon: { weaponType: 'dagger', weaponLevel: 1, atk: 17 }, skills: { MG_LIGHTNINGBOLT: 4 } };
const horn = { ...spore, id: 1128, lv: 18, hp: 659, mdef: 0, stats: { str: 22, agi: 18, vit: 28, int: 10, dex: 47, luk: 15 }, element: 'earth' };

test('skill cast: SP paid at cast, DEX cast time, bolt damage on completion, then max(delay, ASPD) wait', () => {
  const s = e.startFight({ char: mage, mob: horn, uid: 9, skills: { MG_LIGHTNINGBOLT: bolt } });
  assert.equal(e.resolveAction(s, { type: 'skill', skill: 'MG_LIGHTNINGBOLT', lv: 4, at: 0 }, fixed(0.5)).ok, true);
  assert.deepEqual(s.events[0], { t: 0, body: { type: 'skillCast', skill: 'MG_LIGHTNINGBOLT', lv: 4, castMs: 1978, delayMs: 1600, monsterId: 1128 } });
  assert.equal(e.resolveAction(s, { type: 'attack', at: 1000 }, fixed(0.5)).error, 'TOO_EARLY');
  e.finishCast(s, fixed(0.5));
  // MATK roll 190 − INT 10 − floor(VIT 28 / 2) = 166, wind→earth 50% = 83, ×4 hits
  assert.deepEqual(s.events[1], { t: 1978, body: { type: 'skillHit', uid: 9, monsterId: 1128, skill: 'MG_LIGHTNINGBOLT', lv: 4,
    me: [952, 463], damage: 332, hpLeft: 327, hits: 4, result: 'hit', elementMod: 50 } });
  assert.equal(s.char.nextActAt, 1978 + 1600);
});

test('skills are refused when not learned at that level or SP is short', () => {
  const s = e.startFight({ char: { ...mage, sp: 10 }, mob: horn, uid: 9, skills: { MG_LIGHTNINGBOLT: bolt } });
  assert.equal(e.resolveAction(s, { type: 'skill', skill: 'MG_LIGHTNINGBOLT', lv: 4, at: 0 }, fixed(0.5)).error, 'NO_SP');
  assert.equal(e.resolveAction(s, { type: 'skill', skill: 'MG_LIGHTNINGBOLT', lv: 5, at: 0 }, fixed(0.5)).error, 'NOT_LEARNED');
  assert.equal(s.events.length, 0);
});

test('useItem heals within the item range, uses a stack, and does not touch the attack timer', () => {
  const s = e.startFight({ char: { ...thief, hp: 100, inventory: { 501: 1 } }, mob: spore, uid: 7, items: { 501: { hp: [45, 65] } } });
  e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0.5));
  assert.equal(e.resolveAction(s, { type: 'item', itemId: 501, at: 10 }, fixed(0.5)).ok, true);
  assert.deepEqual(s.events.at(-1), { t: 10, body: { type: 'useItem', itemId: 501, hp: 55, sp: 0, auto: true } });
  assert.equal(s.char.hp, 155);
  assert.equal(s.char.nextActAt, 662);
  assert.equal(e.resolveAction(s, { type: 'item', itemId: 501, at: 20 }, fixed(0.5)).error, 'NO_ITEM');
});

test('approach: melee walks 10 cells; a ranged opener waits 500 ms at 9 cells', () => {
  assert.deepEqual(e.approach({ char: thief, mob: spore }), { approachMs: 1120 });
  const archer = { ...thief, weapon: { weaponType: 'bow', weaponLevel: 1, atk: 15 }, attackRange: 9 };
  assert.deepEqual(e.approach({ char: archer, mob: spore }), { approachMs: 500, distance: 9 });
  assert.deepEqual(e.approach({ char: { ...thief, skills: { SM_PROVOKE: 10 } }, mob: spore }), { approachMs: 500, distance: 9 });
});

test('simulateFight is seed-deterministic, time-ordered, and ends in a kill with the L2 observables', () => {
  const run = (seed) => e.simulateFight({ char: thief, mob: spore, buffs: [], brainChoices: {}, rng: e.mulberry32(seed) });
  const a = run(1), b = run(1);
  assert.deepEqual(a, b);
  assert.equal(a.outcome, 'kill');
  assert.equal(a.events[0].t, 1120); // first swing on arrival
  assert.ok(a.events.every((x, i) => i === 0 || x.t >= a.events[i - 1].t));
  assert.equal(a.durationMs, a.events.at(-1).t);
  const own = a.events.filter((x) => x.body.type === 'playerAttack');
  assert.equal(a.attacksMade, own.length);
  assert.equal(a.hitsLanded, own.filter((x) => x.body.damage > 0).length);
  assert.ok(own.reduce((n, x) => n + x.body.damage, 0) >= 510); // damage is reported unclipped on the killing blow
  assert.notDeepEqual(run(2).events, a.events);
});

test('simulateFight: the brain casts while SP allows, drinks below its HP threshold, buffs expire with buffEnd', () => {
  const r = e.simulateFight({ char: { ...mage, sp: 40, hp: 100, inventory: { 501: 3 } }, mob: horn, rng: e.mulberry32(3),
    skills: { MG_LIGHTNINGBOLT: bolt }, items: { 501: { hp: [45, 65] } },
    buffs: [{ id: 'AL_ANGELUS', lv: 10, remainingMs: 1500 }],
    brainChoices: { attackSkills: [{ skill: 'MG_LIGHTNINGBOLT', lv: 4 }], hpPotion: { itemId: 501, belowPct: 50 } } });
  const types = r.events.map((x) => x.body.type);
  assert.equal(types.filter((x) => x === 'skillCast').length, 2); // 40 SP → two Lv4 bolts
  assert.ok(types.includes('useItem'));
  assert.deepEqual(r.events.find((x) => x.body.type === 'buffEnd'), { t: 1500, body: { type: 'buffEnd', buffId: 'AL_ANGELUS' } });
});

test('immobile plants never attack; DEF 100 leaves only refine ATK (captured 14 per hit)', () => {
  const mushroom = { ...spore, id: 1085, hp: 15, atk: [1, 1], def: 100, stats: { ...spore.stats, vit: 0 }, attackDelay: 1,
    behavior: 'immobile', walkSpeed: 1000 };
  const r = e.simulateFight({ char: thief, mob: mushroom, rng: e.mulberry32(1) });
  assert.equal(r.attacksReceived, 0);
  assert.ok(r.events.filter((x) => x.body.result === 'hit').every((x) => x.body.damage === 14 * (x.body.hits ?? 1)));
  assert.equal(r.outcome, 'kill');
});

test('self-buff upkeep: a missing buff is recast (SP, cooldown) with buffStart and its level duration', () => {
  const endure = { id: 'SM_ENDURE', kind: 'self', sp: [10], castMs: [], delayMs: [], cooldownMs: [10000],
    durationMs: [10000, 13000, 16000, 19000, 22000, 25000, 28000, 31000, 34000, 37000] };
  const r = e.simulateFight({ char: { ...thief, skills: { SM_ENDURE: 10 } }, mob: spore, rng: e.mulberry32(1),
    skills: { SM_ENDURE: endure }, buffs: [{ id: 'SM_ENDURE', lv: 10, remainingMs: 2000 }],
    brainChoices: { selfBuffs: [{ skill: 'SM_ENDURE', lv: 10 }] } });
  const ev = r.events.filter((x) => /^(skillCast|buff)/.test(x.body.type)).slice(0, 3);
  assert.deepEqual(ev.map((x) => x.body.type), ['buffEnd', 'skillCast', 'buffStart']);
  assert.deepEqual(ev[2].body, { type: 'buffStart', buffId: 'SM_ENDURE', durationMs: 37000 });
  assert.equal(ev[1].t, ev[2].t);
  assert.equal(r.char.sp, thief.sp - 10);
  assert.ok(r.events.find((x) => x.t > ev[1].t && x.body.type === 'playerAttack').t >= ev[1].t + thief.attackIntervalMs);
});

test('encounter: searching then found; the monster is drawn by spawn count; search time floors at 300 ms', () => {
  const map = { id: 'mjolnir_09', spawns: [{ monsterId: 1014, count: 30 }, { monsterId: 1128, count: 70 }] };
  const monsters = { 1014: spore, 1128: horn };
  const r = e.encounter({ map, monsters, char: thief, uid: 11, rng: fixed(0.2, 0.0) });
  assert.equal(r.mob.id, 1014); // 0.2 × 100 falls in Spore's first 30
  assert.equal(r.searchMs, 300);
  assert.deepEqual(r.events, [{ t: 0, body: { type: 'searching' } },
    { t: 300, body: { type: 'found', uid: 11, monsterId: 1014, approachMs: 1120 } }]);
  assert.equal(e.encounter({ map, monsters, char: thief, uid: 11, rng: fixed(0.31, 0.5) }).mob.id, 1128);
  const n = 20000, rng = e.mulberry32(5);
  const mean = Array.from({ length: n }, () => e.encounter({ map, monsters, char: thief, uid: 1, rng }).searchMs).reduce((a, b) => a + b) / n;
  assert.ok(Math.abs(mean - 800) < 30, `mean search ${mean}`); // captured mean ~800 ms (profiles 1 and 5)
});

const tables = { baseExpTable: [100, 200, 300], jobExpTable: [50, 60, 70] };
const lowChar = { ...thief, job: 'thief', baseLv: 1, baseExp: 90, jobLv: 1, jobExp: 0, statPoints: 0, skillPoints: 0, weight: 0, weightMax: 100 };

test('kill rewards: solo EXP with pct of the level requirement, base and job level-ups with points', () => {
  const r = e.grantKill({ char: lowChar, mob: spore, rng: fixed(0.99), tables });
  assert.deepEqual(r.events.slice(0, 3).map((x) => x.body), [
    { type: 'exp', base: 66, job: 108, basePct: 0.66, jobPct: 2.16 },
    { type: 'baseLevelUp', lv: 2, statPoints: 3 },
    { type: 'jobLevelUp', lv: 2, skillPoints: 1 }]);
  assert.equal(r.events.filter((x) => x.body.type === 'jobLevelUp').length, 1); // 108 = 50 + 58; Lv2→3 needs 60
  assert.deepEqual([r.char.baseLv, r.char.baseExp, r.char.jobLv, r.char.jobExp, r.char.statPoints, r.char.skillPoints], [2, 56, 2, 58, 3, 1]);
  assert.equal(r.events.some((x) => x.body.type === 'drop'), false); // 0.99 rolls above every rate
});

test('party kill splits EXP evenly with the member bonus and marks party', () => {
  const r = e.grantKill({ char: lowChar, mob: { ...spore, baseExp: 1000, jobExp: 100 }, members: 8, rng: fixed(0.99), tables: { baseExpTable: [1e6], jobExpTable: [1e6] } });
  assert.deepEqual(r.events[0].body, { type: 'exp', base: 250, job: 25, basePct: 0.00025, jobPct: 0.000025, party: true });
});

test('drops roll each slot per 10000 (kill-event multiplier applies), card is rare, loot is weighed', () => {
  const mob = { ...spore, drops: [{ itemId: 7033, rate: 5500 }, { itemId: 507, rate: 800 }], card: { itemId: 4022, rate: 1 } };
  const r = e.grantKill({ char: { ...lowChar, weight: 48 }, mob, rng: fixed(0.5, 0.09, 0.0001), tables, dropMult: 1.5,
    itemWeights: { 7033: 1, 507: 3, 4022: 1 } });
  const loot = r.events.filter((x) => /drop|pickup|weight/.test(x.body.type)).map((x) => x.body);
  assert.deepEqual(loot, [
    { type: 'drop', itemId: 7033, qty: 1, monsterId: 1014, rare: false, isCard: false },
    { type: 'drop', itemId: 507, qty: 1, monsterId: 1014, rare: false, isCard: false }, // 900 < 800 × 1.5
    { type: 'drop', itemId: 4022, qty: 1, monsterId: 1014, rare: true, isCard: true },
    { type: 'pickup', itemId: 7033, qty: 1, rare: false }, { type: 'pickup', itemId: 507, qty: 1, rare: false },
    { type: 'weight', percent: 52, threshold: 50 }, // 48 + 1 + 3 crosses 50%
    { type: 'pickup', itemId: 4022, qty: 1, rare: true }]);
});

test('kill-event drop multiplier only for its monster inside its window; death penalty takes 1% of the level requirement', () => {
  const ev = { monsterId: 1002, startsMs: 100, endsMs: 200, dropMult: 1.5 };
  assert.equal(e.killEventDropMult(ev, 1002, 150), 1.5);
  assert.equal(e.killEventDropMult(ev, 1002, 200), 1);
  assert.equal(e.killEventDropMult(ev, 1014, 150), 1);
  assert.equal(e.killEventDropMult(null, 1002, 150), 1);
  assert.deepEqual(e.applyDeath({ ...lowChar, baseLv: 2, baseExp: 50 }, tables).baseExp, 48);
});

test('a crit never double-attacks; Angelus recast restores the soft-DEF bonus its expiry removed', () => {
  const s = newFight();
  e.resolveAction(s, { type: 'attack', at: 0 }, fixed(0)); // rng 0: crit, and would also roll double attack
  assert.equal(s.events[0].body.result, 'crit');
  assert.equal(s.events[0].body.hits, undefined);
  const angelus = { id: 'AL_ANGELUS', kind: 'self', sp: [50], castMs: [], delayMs: [], cooldownMs: [], durationMs: [1000] };
  const r = e.simulateFight({ char: { ...thief, vitDefRate: 50, skills: { AL_ANGELUS: 10 }, sp: 1000 }, mob: spore,
    rng: e.mulberry32(1), skills: { AL_ANGELUS: { ...angelus, durationMs: Array(10).fill(1000) } },
    buffs: [{ id: 'AL_ANGELUS', lv: 10, remainingMs: 500 }], brainChoices: { selfBuffs: [{ skill: 'AL_ANGELUS', lv: 10 }] } });
  assert.ok(r.events.filter((x) => x.body.type === 'buffEnd').length >= 2);
  assert.ok(r.char.vitDefRate === 0 || r.char.vitDefRate === 50, `vitDefRate ${r.char.vitDefRate}`);
});

test('a support skill cast in a fight buffs the caster; an attack skill with no element is neutral (twin run crash)', () => {
  const incagi = { id: 'AL_INCAGI', kind: 'support', attackType: 'magic', sp: [18, 21], castMs: [1000, 1000], delayMs: [1000, 1000],
    cooldownMs: [], durationMs: [60000, 80000] };
  const s = e.startFight({ char: { ...thief, skills: { AL_INCAGI: 2 } }, mob: { ...spore }, uid: 7, skills: { AL_INCAGI: incagi } });
  assert.equal(e.resolveAction(s, { type: 'skill', skill: 'AL_INCAGI', lv: 2, at: 0 }, fixed(0.5)).ok, true);
  e.finishCast(s, fixed(0.5));
  assert.deepEqual(s.events.at(-1).body, { type: 'buffStart', buffId: 'AL_INCAGI', durationMs: 80000 });
  assert.equal(s.mob.hpLeft, spore.hp);

  const steal = { id: 'TF_STEAL', kind: 'attack', attackType: 'weapon', sp: [10], castMs: [], delayMs: [], cooldownMs: [], hits: [1] };
  const t = e.startFight({ char: { ...thief, skills: { TF_STEAL: 1 } }, mob: { ...spore }, uid: 8, skills: { TF_STEAL: steal } });
  assert.equal(e.resolveAction(t, { type: 'skill', skill: 'TF_STEAL', lv: 1, at: 0 }, fixed(0.5)).ok, true);
  if (t.char.casting) e.finishCast(t, fixed(0.5));
  assert.equal(t.events.find((x) => x.body.type === 'skillHit').body.elementMod, 100);
});
