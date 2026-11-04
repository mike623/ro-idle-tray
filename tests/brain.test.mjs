// Brain unit tests: synthetic snapshots/configs, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, observe, tick, condOk } from '../brain/brain.js';

const T = 1_000_000;
function snap(o = {}) {
  const { character, config, derived, ...rest } = o;
  return {
    mapId: 'pay_fild01', saveMap: 'payon', restSit: false, engaged: false, target: null, weightPercent: 10, buffs: [],
    character: { hp: 1000, sp: 100, baseLv: 50, zeny: 10000, statPoints: 0, skills: { TF_DOUBLE: 10 }, stats: { agi: 50, str: 10 }, ...character },
    derived: { maxHp: 1000, maxSp: 100, attackIntervalMs: 600, ...derived },
    equipment: { weapon: 1 },
    inventory: [{ uid: 1, itemId: 1201, qty: 1 }, { uid: 2, itemId: 501, qty: 5 }, { uid: 3, itemId: 601, qty: 2 }, { uid: 4, itemId: 909, qty: 30 }],
    config: { autoLoot: true, skills: [], targets: { blacklist: [], whitelist: [] }, monsterRules: [], escape: {}, ...config },
    ...rest,
  };
}
function brainWith(s, running = true) {
  const b = createBrain();
  observe(b, { type: 'snapshot', snapshot: s, running }, T);
  return b;
}
const ok = (b, extra = {}, at = T) => observe(b, { type: 'result', ok: true, ...extra }, at);
const fail = (b, error, extra = {}, at = T) => observe(b, { type: 'result', ok: false, error, ...extra }, at);
const ev = (b, body, wallMs = T) => observe(b, { type: 'events', events: [{ seq: 1, body, wallMs }] }, wallMs);
/** search → result uid → found */
function inFight(b, monsterId = 1002, uid = 7) {
  assert.deepEqual(tick(b, T), [{ type: 'search' }]);
  ok(b, { uid });
  ev(b, { type: 'searching' });
  ev(b, { type: 'found', uid, monsterId, approachMs: 0 });
}

test('idle until a snapshot says running; then searches; one action in flight', () => {
  assert.deepEqual(tick(brainWith(snap(), false), T), []);
  const b = brainWith(snap());
  assert.deepEqual(tick(b, T), [{ type: 'search' }]);
  assert.deepEqual(tick(b, T + 10), [], 'waits for the result');
});

test('search → found → attack, paced by ASPD and server retryAt', () => {
  const b = brainWith(snap());
  tick(b, T); ok(b, { uid: 7 });
  assert.deepEqual(tick(b, T), [], 'no target until found');
  ev(b, { type: 'found', uid: 7, monsterId: 1002, approachMs: 500 });
  assert.deepEqual(tick(b, T + 100), [], 'still approaching');
  assert.deepEqual(tick(b, T + 500), [{ type: 'attack', uid: 7 }]);
  fail(b, 'TOO_EARLY', { retryAt: T + 800 }, T + 500);
  assert.deepEqual(tick(b, T + 700), []);
  assert.deepEqual(tick(b, T + 800), [{ type: 'attack', uid: 7 }]);
  ok(b, {}, T + 800);
  assert.deepEqual(tick(b, T + 1000), [], 'ASPD interval 600 ms');
  assert.deepEqual(tick(b, T + 1400), [{ type: 'attack', uid: 7 }]);
});

test('kill → pickup each drop (autoLoot), then search again', () => {
  const b = brainWith(snap());
  inFight(b);
  ev(b, { type: 'kill', uid: 7, monsterId: 1002 });
  ev(b, { type: 'drop', itemId: 909, qty: 1 });
  ev(b, { type: 'drop', itemId: 4001, qty: 1 });
  assert.deepEqual(tick(b, T), [{ type: 'pickup', itemId: 909 }]);
  ok(b); ev(b, { type: 'pickup', itemId: 909, qty: 1 });
  assert.deepEqual(tick(b, T), [{ type: 'pickup', itemId: 4001 }]);
  fail(b, 'NO_LOOT');
  assert.deepEqual(tick(b, T), [{ type: 'search' }]);
});

test('autoLoot off leaves drops on the ground', () => {
  const b = brainWith(snap({ config: { autoLoot: false } }));
  inFight(b);
  ev(b, { type: 'kill', uid: 7 }); ev(b, { type: 'drop', itemId: 909, qty: 1 });
  assert.deepEqual(tick(b, T), [{ type: 'search' }]);
});

test('targets: blacklist / whitelist / monsterRules defend skip the target; ENGAGED commits', () => {
  for (const [config, reason] of [[{ targets: { blacklist: [1002], whitelist: [] } }, 'blacklist'],
    [{ targets: { blacklist: [], whitelist: [1113] } }, 'whitelist'],
    [{ monsterRules: [{ action: 'defend', monsterId: 1002 }] }, 'defend']]) {
    const b = brainWith(snap({ config }));
    inFight(b);
    assert.deepEqual(tick(b, T), [{ type: 'skip', uid: 7, reason }]);
    fail(b, 'ENGAGED');
    assert.deepEqual(tick(b, T), [{ type: 'attack', uid: 7 }], 'an aggressive mob is fought back');
  }
  const b = brainWith(snap({ config: { monsterRules: [{ action: 'attack', monsterId: 1002 }] } }));
  inFight(b);
  assert.deepEqual(tick(b, T), [{ type: 'attack', uid: 7 }]);
});

test('defend: a monster that hit us is fought back; targetSkip ends the fight', () => {
  const b = brainWith(snap({ config: { monsterRules: [{ action: 'defend', monsterId: 1002 }] } }));
  inFight(b);
  ev(b, { type: 'monsterAttack', uid: 7, damage: 5 });
  assert.deepEqual(tick(b, T), [{ type: 'attack', uid: 7 }]);
  const c = brainWith(snap({ config: { targets: { blacklist: [1002], whitelist: [] } } }));
  inFight(c);
  tick(c, T); ok(c); ev(c, { type: 'targetSkip', reason: 'blacklist', monsterId: 1002 });
  assert.deepEqual(tick(c, T), [{ type: 'search' }]);
});

test('level filters use monster data when given', () => {
  const b = createBrain({ monsters: { 1002: { lv: 1 } } });
  observe(b, { type: 'snapshot', snapshot: snap({ config: { targets: { minLv: 5, maxLv: 0, blacklist: [], whitelist: [] } } }), running: true }, T);
  inFight(b);
  assert.deepEqual(tick(b, T), [{ type: 'skip', uid: 7, reason: 'level' }]);
});

test('buffs: cast in fight before attacking when missing or about to expire (refreshBeforeSec); learned only', () => {
  const skills = [{ use: 'buff', skill: 'AL_INCAGI', lv: 3, percent: 0, cond: { refreshBeforeSec: 5 } },
    { use: 'buff', skill: 'AL_BLESSING', lv: 10, percent: 0, enabled: false },
    { use: 'buff', skill: 'KN_TWOHANDQUICKEN', lv: 10, percent: 0 }];
  const b = brainWith(snap({ config: { skills }, character: { skills: { AL_INCAGI: 3, AL_BLESSING: 10 } },
    buffs: [{ id: 'AL_INCAGI', remainingMs: 4000, lv: 3 }] }));
  inFight(b);
  assert.deepEqual(tick(b, T), [{ type: 'cast', uid: 7, skill: 'AL_INCAGI', lv: 3 }]);
  ok(b);
  assert.deepEqual(tick(b, T + 600), [{ type: 'attack', uid: 7 }], 'not recast right away; disabled/unlearned skipped');
  const c = brainWith(snap({ config: { skills }, character: { skills: { AL_INCAGI: 3 } }, buffs: [{ id: 'AL_INCAGI', remainingMs: 60000 }] }));
  inFight(c);
  assert.deepEqual(tick(c, T), [{ type: 'attack', uid: 7 }], 'buff still up');
});

test('attack skills: SP floor (percent), repeat once per target, conditions, NO_SP backs off', () => {
  const skills = [{ use: 'attack', skill: 'TF_STEAL', lv: 9, percent: 10, repeat: 'once' },
    { use: 'attack', skill: 'MG_LIGHTNINGBOLT', lv: 4, percent: 10, cond: { targetAggro: false } }];
  const b = brainWith(snap({ config: { skills }, character: { skills: { TF_STEAL: 9, MG_LIGHTNINGBOLT: 4 } } }));
  inFight(b);
  assert.deepEqual(tick(b, T), [{ type: 'cast', uid: 7, skill: 'TF_STEAL', lv: 9 }]);
  ok(b);
  assert.deepEqual(tick(b, T + 600), [{ type: 'cast', uid: 7, skill: 'MG_LIGHTNINGBOLT', lv: 4 }], 'steal only once');
  fail(b, 'NO_SP', {}, T + 600);
  assert.deepEqual(tick(b, T + 600), [{ type: 'attack', uid: 7 }]);
  const c = brainWith(snap({ config: { skills }, character: { sp: 5, skills: { MG_LIGHTNINGBOLT: 4 } } }));
  inFight(c);
  assert.deepEqual(tick(c, T), [{ type: 'attack', uid: 7 }], 'SP 5% is under the 10% floor');
  const d = brainWith(snap({ config: { skills }, character: { skills: { MG_LIGHTNINGBOLT: 4 } } }));
  inFight(d); ev(d, { type: 'monsterAttack', uid: 7 });
  assert.deepEqual(tick(d, T), [{ type: 'attack', uid: 7 }], 'targetAggro:false fails once the mob hits');
});

test('skillOnly never melees', () => {
  const b = brainWith(snap({ config: { combat: { skillOnly: true }, skills: [] } }));
  inFight(b);
  assert.deepEqual(tick(b, T), []);
});

test('conditions: hp/sp bounds, selfLacks, allyLacks, or', () => {
  const x = { hp: 60, sp: 30, buffs: new Set(['AC_CONCENTRATION']), aggro: false, allies: [{ buffs: [] }] };
  assert.ok(condOk({ spAbove: 20, hpBelow: 70 }, x));
  assert.ok(!condOk({ spAbove: 40 }, x));
  assert.ok(!condOk({ selfLacks: ['AC_CONCENTRATION'] }, x));
  assert.ok(condOk({ or: [{ hpAbove: 90 }, { spBelow: 50 }] }, x));
  assert.ok(!condOk({ or: [{ hpAbove: 90 }, { spBelow: 10 }] }, x));
  assert.ok(condOk({ allyLacks: ['AL_BLESSING'] }, x));
  assert.ok(!condOk({ allyLacks: ['AL_BLESSING'] }, { ...x, allies: [] }));
});

test('recovery: HP potion under belowPercent (itemFirst), heal skill in fight, SP potion', () => {
  const config = { hpPotion: { enabled: true, items: [501], belowPercent: 30 }, recovery: { order: 'itemFirst' },
    skills: [{ use: 'heal', skill: 'NV_FIRSTAID', lv: 1, percent: 50 }] };
  const b = brainWith(snap({ config, character: { hp: 200, skills: { NV_FIRSTAID: 1 } } }));
  assert.deepEqual(tick(b, T), [{ type: 'useItem', uid: 2 }]);
  const c = brainWith(snap({ config: { ...config, recovery: { order: 'skillFirst' } }, character: { hp: 200, skills: { NV_FIRSTAID: 1 } } }));
  inFightAfter(c, 200);
  assert.deepEqual(tick(c, T), [{ type: 'cast', uid: 7, skill: 'NV_FIRSTAID', lv: 1 }]);
  const d = brainWith(snap({ config: { spPotion: { enabled: true, items: [505], belowPercent: 20 } }, character: { sp: 5 },
    inventory: [{ uid: 9, itemId: 505, qty: 1 }] }));
  assert.deepEqual(tick(d, T), [{ type: 'useItem', uid: 9 }]);
  fail(d, 'NO_ITEM');
  assert.deepEqual(tick(d, T), [{ type: 'search' }], 'a failing potion backs off');
});
function inFightAfter(b) { // like inFight but the brain may first want a potion; here none is configured to win
  b.fight = { uid: 7, monsterId: 1002, found: true, readyAt: T, aggro: false, committed: false, casts: new Set() };
}

test('escape: lowHp fly teleports in a fight when a Fly Wing is held', () => {
  const b = brainWith(snap({ config: { escape: { lowHp: { action: 'fly', belowPercent: 20 } } }, character: { hp: 100 } }));
  inFightAfter(b);
  assert.deepEqual(tick(b, T), [{ type: 'teleport' }]);
  ok(b); ev(b, { type: 'teleport', mapId: 'pay_fild01' });
  assert.equal(b.fight, null);
});

test('sit below hpBelow, stay sitting until hpUntil, then search', () => {
  const sit = { enabled: true, hpBelow: 40, hpUntil: 90, spBelow: 0, spUntil: 0 };
  const b = brainWith(snap({ config: { sit }, character: { hp: 300 } }));
  assert.deepEqual(tick(b, T), [{ type: 'sit' }]);
  ok(b);
  observe(b, { type: 'snapshot', snapshot: snap({ config: { sit }, restSit: true, character: { hp: 600 } }), running: true }, T);
  assert.deepEqual(tick(b, T + 2000), []);
  observe(b, { type: 'snapshot', snapshot: snap({ config: { sit }, restSit: true, character: { hp: 950 } }), running: true }, T);
  assert.deepEqual(tick(b, T + 4000), [{ type: 'search' }]);
});

test('lockMap: off-map character goes back; death without autoResumeAfterDeath stops', () => {
  const b = brainWith(snap({ mapId: 'payon', config: { lockMap: 'pay_fild01' } }));
  assert.deepEqual(tick(b, T), [{ type: 'command', command: { type: 'selectMap', mapId: 'pay_fild01' } }]);
  const c = brainWith(snap({ config: { lockMap: 'pay_fild01', autoResumeAfterDeath: false } }));
  ev(c, { type: 'mapChange', from: 'pay_fild01', to: 'payon', cause: 'return' });
  assert.deepEqual(tick(c, T), [{ type: 'command', command: { type: 'stop' } }]);
});

test('stopAtLv and statsAddAuto', () => {
  assert.deepEqual(tick(brainWith(snap({ config: { stopAtLv: { base: 50 } } })), T), [{ type: 'command', command: { type: 'stop' } }]);
  const b = brainWith(snap({ character: { statPoints: 6 }, config: { statsAddAuto: { enabled: true, list: [{ stat: 'agi', target: 50 }, { stat: 'str', target: 20 }] } } }));
  assert.deepEqual(tick(b, T), [{ type: 'command', command: { type: 'allocateStats', stats: { str: 1 } } }]);
});

test('town supply: low potions → save map → sell, store, buy → back to lockMap', () => {
  const config = { lockMap: 'pay_fild01', townBuy: [{ itemId: 501, qty: 10, below: 6 }], autoSell: [909],
    autoStorage: { enabled: true, onReturn: true, items: [1201, 601], keep: { 601: 1 }, abovePercent: 50 } };
  const b = brainWith(snap({ config, equipment: { weapon: 1 } }));
  const cmd = (command) => [{ type: 'command', command }];
  assert.deepEqual(tick(b, T), cmd({ type: 'selectMap', mapId: 'payon' }));
  ok(b, { view: { running: true, snapshot: snap({ config, mapId: 'payon' }) } });
  assert.deepEqual(tick(b, T), cmd({ type: 'sell', uid: 4, qty: 30 }));
  ok(b);
  assert.deepEqual(tick(b, T), cmd({ type: 'storageDeposit', items: [{ uid: 3, qty: 1 }] }), 'equipped weapon kept, keep:1 Fly Wing');
  fail(b, 'GAME_RULE');
  assert.deepEqual(tick(b, T), cmd({ type: 'buy', itemId: 501, qty: 5 }), 'a failed step is skipped');
  ok(b, { view: { running: true, snapshot: snap({ config, mapId: 'payon', inventory: [{ uid: 2, itemId: 501, qty: 10 }] }) } });
  assert.deepEqual(tick(b, T), cmd({ type: 'selectMap', mapId: 'pay_fild01' }));
  ok(b, { view: { running: true, snapshot: snap({ config }) } });
  assert.deepEqual(tick(b, T), [{ type: 'search' }]);
});

test('overweight goes to town; resumes a fight seen in the snapshot after reconnect', () => {
  const b = brainWith(snap({ weightPercent: 92, config: { stopOnOverweight: true } }));
  assert.deepEqual(tick(b, T), [{ type: 'command', command: { type: 'selectMap', mapId: 'payon' } }]);
  const c = brainWith(snap({ engaged: true, target: { uid: 42, name: 'x', lv: 1, hp: 5, maxHp: 50 } }));
  assert.deepEqual(tick(c, T), [{ type: 'attack', uid: 42 }]);
});

test('a lost result does not wedge the brain', () => {
  const b = brainWith(snap());
  tick(b, T);
  assert.deepEqual(tick(b, T + 5000), []);
  assert.deepEqual(tick(b, T + 10001), [{ type: 'search' }]);
});

test('still overweight after a town trip: stopOnOverweight stops; a refused trip falls back to hunting', () => {
  const b = brainWith(snap({ weightPercent: 95, saveMap: 'payon', mapId: 'payon', config: { stopOnOverweight: true } }));
  assert.deepEqual(tick(b, T), [{ type: 'search' }], 'nothing to sell or store: trip ends');
  ok(b, { uid: 7 }); ev(b, { type: 'targetSkip' });
  assert.deepEqual(tick(b, T + 1), [{ type: 'command', command: { type: 'stop' } }]);
  const c = brainWith(snap({ config: { townBuy: [{ itemId: 501, qty: 10, below: 6 }] } }));
  assert.deepEqual(tick(c, T), [{ type: 'command', command: { type: 'selectMap', mapId: 'payon' } }]);
  fail(c, 'GAME_RULE');
  assert.deepEqual(tick(c, T), [{ type: 'search' }]);
});
