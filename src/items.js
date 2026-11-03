// Item settings = the game's 道具設定 sections "items" + "recovery" (its 含藥水與回復 box),
// i.e. the config keys its own copy/paste moves. cureItems is left out: the game drops it.
// Shared by the game-page hook (collect / fan out) and src/items.html (the editor).
const RO_IDLE_ITEM_KEYS = ['autoLoot', 'lootFilter', 'lootPriority', 'autoStorage', 'restock', 'townBuy',
  'autoSell', 'supplyWeightPercent', 'autoRepair', 'autoBuy', 'autoIdentify',
  'hpPotion', 'spPotion', 'buffPotion', 'recovery', 'sit'];
// Editor columns: plain item-id lists, and {itemId, below, qty} rule lists.
const RO_IDLE_ITEM_LISTS = {
  loot: ['lootPriority', 'items'], store: ['autoStorage', 'items'], sell: ['autoSell'],
  hp: ['hpPotion', 'items'], sp: ['spPotion', 'items'], buff: ['buffPotion', 'items'],
};
const RO_IDLE_ITEM_RULES = {restock: 'restock', town: 'townBuy'};

function roIdlePickItems(config) {
  return Object.fromEntries(RO_IDLE_ITEM_KEYS.filter(k => config?.[k] !== undefined).map(k => [k, config[k]]));
}

function roIdleItemList(config, [k, sub], make) {
  if (!sub) return config[k] ?? (make ? (config[k] = []) : []);
  const o = config[k] ?? (make ? (config[k] = {}) : {});
  return o[sub] ?? (make ? (o[sub] = []) : []);
}

// One item's settings as a row: {loot, store, sell, hp, sp, buff, restock, town, below, qty}.
function roIdleItemRow(config, id) {
  const row = {};
  for (const [col, path] of Object.entries(RO_IDLE_ITEM_LISTS)) row[col] = roIdleItemList(config, path).includes(id);
  for (const [col, k] of Object.entries(RO_IDLE_ITEM_RULES)) {
    const r = (config[k] ?? []).find(x => x.itemId === id);
    row[col] = !!r;
    if (r) Object.assign(row, {below: r.below, qty: r.qty});
  }
  row.below ??= 1; row.qty ??= 10;
  return row;
}

// Write a row back: adds/removes the id in each list, keeping list order otherwise.
function roIdleSetItemRow(config, id, row) {
  for (const [col, path] of Object.entries(RO_IDLE_ITEM_LISTS)) {
    const l = roIdleItemList(config, path, row[col]), i = l.indexOf(id);
    if (row[col] && i < 0) l.push(id);
    if (!row[col] && i >= 0) l.splice(i, 1);
  }
  for (const [col, k] of Object.entries(RO_IDLE_ITEM_RULES)) {
    const l = config[k] ?? (row[col] ? (config[k] = []) : []), i = l.findIndex(x => x.itemId === id);
    if (row[col] && i < 0) l.push({itemId: id, below: row.below, qty: row.qty});
    if (row[col] && i >= 0) Object.assign(l[i], {below: row.below, qty: row.qty});
    if (!row[col] && i >= 0) l.splice(i, 1);
  }
}

// overrides {itemId: {characterName: row}}: what `name` gets instead of the shared row.
function roIdleItemsFor(items, overrides, name) {
  const config = JSON.parse(JSON.stringify(roIdlePickItems(items)));
  for (const [id, byName] of Object.entries(overrides ?? {})) if (byName?.[name]) roIdleSetItemRow(config, Number(id), byName[name]);
  return config;
}

// Merge input: a character's settings minus its overridden items, so re-merging never
// folds one character's override back into the shared rows.
function roIdleSharedItems(config, overrides, name) {
  const items = JSON.parse(JSON.stringify(roIdlePickItems(config)));
  const off = {loot: false, store: false, sell: false, hp: false, sp: false, buff: false, restock: false, town: false};
  for (const [id, byName] of Object.entries(overrides ?? {})) if (byName?.[name]) roIdleSetItemRow(items, Number(id), off);
  return items;
}

// Same updateConfig command as the game's 套用設定: its current config with only the item keys replaced.
async function roIdleApplyItems(characterId, snapshot, items, overrides = {}) {
  if (!characterId || !snapshot?.config) throw new Error('No character currently in play');
  const config = {...snapshot.config, ...roIdleItemsFor(items, overrides, snapshot.character?.name)};
  const response = await fetch(`/api/characters/${characterId}/commands`, {
    method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
    headers: {'content-type': 'application/json', 'x-ro-client': '1'},
    body: JSON.stringify({commandId: crypto.randomUUID(), command: {type: 'updateConfig', config}}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
  return data.view?.snapshot;
}
