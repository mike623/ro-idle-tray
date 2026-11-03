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
