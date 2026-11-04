import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/items.js', import.meta.url), 'utf8');
const load = fetch => vm.runInNewContext(`${source}; ({roIdlePickItems, roIdleApplyItems, roIdleSharedItems, roIdleItemRow})`,
  {fetch, AbortSignal, crypto: {randomUUID: () => 'id'}});
const plain = v => JSON.parse(JSON.stringify(v));

test('fan out replaces only item keys in the current config', async () => {
  let sent;
  const {roIdleApplyItems} = load(async (url, o) => {
    assert.equal(url, '/api/characters/c1/commands');
    sent = JSON.parse(o.body).command;
    return {ok: true, json: async () => ({view: {snapshot: {ok: 1}}})};
  });
  const snapshot = {config: {lockMap: 'prontera', skills: [1], restock: [], autoLoot: false}};
  await roIdleApplyItems('c1', snapshot, {restock: [{itemId: 501}], autoLoot: true, lockMap: 'evil', skills: []});
  assert.equal(sent.type, 'updateConfig');
  assert.deepEqual(plain(sent.config), {lockMap: 'prontera', skills: [1], restock: [{itemId: 501}], autoLoot: true});
});

test('collect picks only item keys', () => {
  const {roIdlePickItems} = load();
  assert.deepEqual(Object.keys(roIdlePickItems({hpPotion: {}, lockMap: 'x', sit: {}})), ['hpPotion', 'sit']);
});

const arrows = {1750: {羅白仔: {store: true, restock: true, town: true, below: 10, qty: 1000}}};

test('an override row replaces the shared row for that character only', async () => {
  let sent;
  const {roIdleApplyItems} = load(async (url, o) => { sent = JSON.parse(o.body).command.config; return {ok: true, json: async () => ({})}; });
  const shared = {restock: [{itemId: 501, below: 1, qty: 10}], autoStorage: {items: [507]}, autoSell: [909]};
  await roIdleApplyItems('c', {character: {name: '牙暉'}, config: {}}, shared, arrows);
  assert.deepEqual(plain(sent), shared);
  await roIdleApplyItems('c', {character: {name: '羅白仔'}, config: {}}, shared, arrows);
  assert.deepEqual(plain(sent), {restock: [{itemId: 501, below: 1, qty: 10}, {itemId: 1750, below: 10, qty: 1000}],
    autoStorage: {items: [507, 1750]}, autoSell: [909], townBuy: [{itemId: 1750, below: 10, qty: 1000}]});
});

test('merge input leaves out a character\'s overridden items', () => {
  const {roIdleSharedItems, roIdleItemRow} = load();
  const mine = {restock: [{itemId: 1750, below: 10, qty: 1000}], autoStorage: {items: [1750, 507]}};
  const row = roIdleItemRow(roIdleSharedItems(mine, arrows, '羅白仔'), 1750);
  assert.equal(row.restock || row.store, false);
  assert.equal(roIdleItemRow(roIdleSharedItems(mine, arrows, '牙暉'), 1750).store, true);
});

test('assist mode sets map monsters to defend and folds the old lists in like the game', () => {
  const {roIdleAssistConfig} = vm.runInNewContext(`${source}; ({roIdleAssistConfig})`);
  const config = {mode: 'x', monsterRules: [{monsterId: 1, action: 'priority', weight: 2}],
    targets: {blacklist: [3], level: 1}, escape: {dangerMonsters: [4], danger: 'fly'}};
  assert.deepEqual(plain(roIdleAssistConfig(config, [1, 2])), {mode: 'x',
    monsterRules: [{monsterId: 1, action: 'defend', weight: 2}, {monsterId: 3, action: 'defend'},
      {monsterId: 4, action: 'attack', escape: 'sight'}, {monsterId: 2, action: 'defend'}],
    targets: {blacklist: [], level: 1}, escape: {dangerMonsters: [], danger: 'fly'}});
  assert.equal(config.monsterRules[0].action, 'priority');
});

const injected = await fs.readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const assistSource = injected.slice(injected.indexOf("  const ASSIST ="), injected.indexOf('  window.__roIdleApplySkills'));
function assistEnvironment(update) {
  const storage = new Map([['roIdleTray.assist', JSON.stringify({a: [1], b: [2, 3]})]]);
  const snapshot = {mapId: 'b', config: {monsterRules: [
    {monsterId: 1, action: 'defend'}, {monsterId: 2, action: 'defend', escape: 'sight'},
    {monsterId: 3, action: 'priority'}, {monsterId: 99, action: 'defend'}], autoLoot: true}};
  const ctx = {window: {}, streamId: 'c', cache: {c: snapshot}, last: null, send: () => {}, console,
    localStorage: {getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k)}};
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.roIdleUpdateConfig = update;
  vm.runInContext(assistSource, ctx);
  return {ctx, storage};
}
test('disabling assist removes current-map rows and preserves other maps', async () => {
  let config;
  const {ctx, storage} = assistEnvironment(async (id, c) => { config = plain(c); return {config: c}; });
  await ctx.window.__roIdleAssist(null);
  assert.deepEqual(config.monsterRules, [{monsterId: 1, action: 'defend'},
    {monsterId: 99, action: 'defend'}]);
  assert.equal(config.autoLoot, true);
  assert.equal(storage.size, 0);
});
test('failed assist cleanup stays enabled for retry', async () => {
  const {ctx, storage} = assistEnvironment(async () => { throw new Error('refused'); });
  await assert.rejects(ctx.window.__roIdleAssist(null), /refused/);
  assert.equal(storage.size, 1);
});
test('assist cleanup blocks concurrent toggles and automatic reapplication', async () => {
  let finish, calls = 0;
  const {ctx, storage} = assistEnvironment(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const pending = ctx.window.__roIdleAssist(null);
  await assert.rejects(ctx.window.__roIdleAssist({b: [2]}), /in progress/);
  vm.runInContext('autoAssist({mapId: "a", config: {monsterRules: []}})', ctx);
  assert.equal(calls, 1);
  assert.equal(storage.size, 1);
  finish();
  await pending;
  assert.equal(storage.size, 0);
});
