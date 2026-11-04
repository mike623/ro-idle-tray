// HTTP + WebSocket integration tests: real server on port 0, injected clock, seeded RNG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from './index.js';
import { seedCapture } from './seed.js';

const lines = readFileSync(new URL('../tests/fixtures/server/capture-72397.jsonl', import.meta.url), 'utf8').trim().split('\n');
const captured = JSON.parse(JSON.parse(lines.find((l) => JSON.parse(l).path.startsWith('/api/characters/72397?') || JSON.parse(l).path === '/api/characters/72397')).resp);
const ID = 72397;

async function boot(o = {}) {
  const clock = { now: 1_800_000_000_000 };
  const db = o.db ?? join(mkdtempSync(join(tmpdir(), 'ro-srv-')), 'data.sqlite');
  const srv = await startServer({ port: 0, db, now: () => clock.now, seed: 7, tickMs: 0, ...o });
  if (!o.noSeed) srv.token = seedCapture(srv.game, lines, { account: 'mike', token: 'tok' });
  const base = `http://127.0.0.1:${srv.port}`;
  const H = { authorization: 'Bearer tok' };
  const get = async (p, h = H) => { const r = await fetch(base + p, { headers: h }); return { status: r.status, body: await r.json(), headers: r.headers }; };
  const cmd = async (command, commandId = crypto.randomUUID()) => {
    const r = await fetch(`${base}/api/characters/${ID}/commands`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, command }) });
    return { status: r.status, body: await r.json() };
  };
  return { srv, clock, db, base, get, cmd, H };
}

function connect(base, id = ID, token = 'tok') {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?character=${id}&token=${token}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (m) => { const x = JSON.parse(m); inbox.push(x); waiters.splice(0).forEach((w) => w()); });
  const next = (pred) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('timeout waiting for ws message')), 2000);
    const check = () => { const i = inbox.findIndex(pred); if (i >= 0) { clearTimeout(timer); res(inbox.splice(i, 1)[0]); } else waiters.push(check); };
    check();
  });
  let n = 0;
  const send = (msg) => { const id = ++n; ws.send(JSON.stringify({ id, ...msg })); return next((x) => x.type === 'result' && x.id === id); };
  return { ws, inbox, next, send, open: new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    closed: new Promise((res) => ws.once('close', (code) => res(code))) };
}

test('seeded twin serves the captured character view and boot reads', async (t) => {
  const { srv, get } = await boot();
  t.after(() => srv.close());
  const v = await get(`/api/characters/${ID}?deferCatchup=1`);
  assert.equal(v.status, 200);
  assert.deepEqual(v.body.snapshot, captured.snapshot);
  for (const k of ['characterId', 'name', 'revision', 'commandRevision', 'lastSeq', 'running', 'clockFrozen', 'deleteAfterMs'])
    assert.deepEqual(v.body[k], captured[k], k);
  assert.equal(typeof v.body.settledAtMs, 'number');
  assert.equal(v.body.backlogMs, 0);

  assert.deepEqual((await get('/api/auth/config')).body, { authMode: 'dev', google: false });
  assert.equal((await get('/api/auth/me')).body.provider, 'dev');
  const list = (await get('/api/characters')).body.characters;
  assert.deepEqual(list, [{ id: ID, name: captured.name, running: captured.running, deleteAfterMs: null, frozen: false,
    job: captured.snapshot.character.job, baseLv: captured.snapshot.character.baseLv, jobLv: captured.snapshot.character.jobLv,
    mapId: captured.snapshot.mapId }]);
  const party = (await get(`/api/characters/${ID}/party`)).body;
  assert.equal(party.party.members.length, 1); // only seeded characters are members
  assert.deepEqual(Object.keys(party.party.members[0]).sort(), ['baseLv', 'buffs', 'id', 'job', 'look', 'mapId', 'name', 'running', 'vitals']);
  assert.deepEqual(party.own, []);
  const pop = (await get('/api/maps/population')).body;
  assert.deepEqual(pop.maps[captured.snapshot.mapId], [1, 0]);
  assert.equal(typeof pop.at, 'number');
  const ke = (await get('/api/kill-event')).body;
  assert.equal(ke.event.monsterId, 1002);
  assert.equal(typeof ke.nowMs, 'number');
  assert.ok(Array.isArray((await get('/api/storage')).body.storage.items));
  assert.deepEqual((await get(`/api/characters/${ID}/events?after=${captured.lastSeq}&limit=1000`)).body,
    { events: [], gap: false, retainedFrom: captured.lastSeq + 1 });
  assert.equal((await get(`/api/characters/${ID}/summary?after=${captured.lastSeq}`)).body.summary.kills, 0);
  assert.deepEqual((await get(`/api/characters/${ID}/guild`)).body, { guild: null, invites: [], skills: {}, directory: [] });
  assert.deepEqual((await get(`/api/characters/${ID}/trade`)).body, { trade: null });
  assert.deepEqual((await get('/api/shared-configs')).body, { rows: [] });
});

test('auth: no token is UNAUTHENTICATED; dev-login sets a cookie that works', async (t) => {
  const { srv, get, base } = await boot();
  t.after(() => srv.close());
  const r = await get(`/api/characters/${ID}`, {});
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHENTICATED');
  assert.equal((await get('/api/characters/99999')).status, 404);
  const login = await fetch(`${base}/api/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username":"mike"}' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await get(`/api/characters/${ID}`, { cookie })).status, 200);
  const bad = await fetch(`${base}/api/auth/dev-login`, { method: 'POST', body: '{"username":"nobody"}' });
  assert.equal(bad.status, 401);
});

test('commands: allocateStats/equip/selectMap/updateConfig/start/stop reply {ok, view} and bump commandRevision', async (t) => {
  const { srv, cmd, get } = await boot();
  t.after(() => srv.close());
  // seeded char has 0 stat points: rule error carries the view
  let r = await cmd({ type: 'allocateStats', stats: { agi: 1 } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'GAME_RULE');
  assert.equal(r.body.view.characterId, ID);
  srv.game.chars.get(ID).snapshot.character.statPoints = 10;
  const before = (await get(`/api/characters/${ID}`)).body;
  r = await cmd({ type: 'allocateStats', stats: { agi: 1 } }, 'same-id');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const v = r.body.view;
  assert.equal(v.commandRevision, before.commandRevision + 1);
  assert.equal(v.snapshot.character.stats.agi, before.snapshot.character.stats.agi + 1);
  assert.equal(v.snapshot.character.statPoints, 10 - 9); // agi 73 → 74 costs floor(73/10)+2 = 9
  assert.equal(v.snapshot.derived.flee, before.snapshot.derived.flee + 1);
  // retry with the same commandId is idempotent
  assert.equal((await cmd({ type: 'allocateStats', stats: { agi: 1 } }, 'same-id')).body.view.commandRevision, v.commandRevision);

  r = await cmd({ type: 'unequip', slot: 'armor' });
  assert.equal(r.body.view.snapshot.equipment.armor, undefined);
  assert.equal(r.body.view.snapshot.derived.hardDef < before.snapshot.derived.hardDef, true);
  r = await cmd({ type: 'equip', uid: before.snapshot.equipment.armor });
  assert.equal(r.body.view.snapshot.equipment.armor, before.snapshot.equipment.armor);
  assert.equal(r.body.view.snapshot.derived.hardDef, before.snapshot.derived.hardDef);

  assert.equal((await cmd({ type: 'selectMap', mapId: 'nowhere' })).status, 422);
  r = await cmd({ type: 'selectMap', mapId: 'prontera' });
  assert.equal(r.body.view.snapshot.mapId, 'prontera');
  r = await cmd({ type: 'updateConfig', config: { ...before.snapshot.config, lureCount: 3 } });
  assert.equal(r.body.view.snapshot.config.lureCount, 3);
  r = await cmd({ type: 'stop' });
  assert.equal(r.body.view.running, false);
  r = await cmd({ type: 'start' });
  assert.equal(r.body.view.running, true);
  const evs = (await get(`/api/characters/${ID}/events?after=0`)).body.events.map((e) => e.body.type);
  assert.deepEqual(evs, ['unequip', 'equip', 'mapChange', 'config', 'stop', 'start']);
  r = await cmd({ type: 'guildCreate' });
  assert.equal(r.status, 422);
});

test('commands: buy/sell in town and useItem change zeny and inventory', async (t) => {
  const { srv, cmd } = await boot();
  t.after(() => srv.close());
  assert.equal((await cmd({ type: 'buy', itemId: 501, qty: 1 })).status, 422); // not in a town
  let v = (await cmd({ type: 'selectMap', mapId: 'prontera' })).body.view;
  const zeny = v.snapshot.character.zeny;
  const pots = (s) => s.inventory.filter((x) => x.itemId === 501).reduce((n, x) => n + x.qty, 0);
  const n = pots(v.snapshot);
  v = (await cmd({ type: 'buy', itemId: 501, qty: 2 })).body.view;
  assert.equal(pots(v.snapshot), n + 2);
  assert.equal(v.snapshot.character.zeny, zeny - 100);
  const uid = v.snapshot.inventory.find((x) => x.itemId === 501).uid;
  v = (await cmd({ type: 'sell', uid, qty: 1 })).body.view;
  assert.equal(v.snapshot.character.zeny, zeny - 100 + 25);
  srv.game.chars.get(ID).snapshot.character.hp = 100;
  v = (await cmd({ type: 'useItem', uid })).body.view;
  assert.equal(pots(v.snapshot), n);
  assert.ok(v.snapshot.character.hp >= 145 && v.snapshot.character.hp <= 165);
  assert.equal(v.snapshot.weight, v.snapshot.inventory.reduce((w, x) => w + srv.game.data.items[x.itemId].weight * x.qty, 0));
});

test('scripted session: connect → search → fight → kill → loot; SSE and events/summary see it', async (t) => {
  const { srv, clock, base, get } = await boot();
  t.after(() => srv.close());
  const sse = await fetch(`${base}/api/characters/${ID}/stream?after=${captured.lastSeq}&chatAfter=now`, { headers: { authorization: 'Bearer tok' } });
  const reader = sse.body.getReader();
  let sseText = '';
  (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; sseText += new TextDecoder().decode(value); } })().catch(() => {});

  const c = connect(base);
  await c.open;
  const hello = await c.next((x) => x.type === 'snapshot');
  assert.equal(hello.lastSeq, captured.lastSeq);

  const found = await c.send({ type: 'search' });
  assert.equal(found.ok, true);
  const uid = found.uid;
  assert.equal(typeof uid, 'number');
  // the brain cannot hit before the server-rolled search + approach time
  const early = await c.send({ type: 'attack', uid });
  assert.equal(early.ok, false);
  assert.equal(early.error, 'TOO_EARLY');
  assert.ok(early.retryAt > clock.now);
  assert.equal((await c.send({ type: 'attack', uid: uid + 999 })).error, 'NO_TARGET');

  let killed = false, swings = 0;
  for (let i = 0; i < 200 && !killed; i++) {
    const r = await c.send({ type: 'attack', uid });
    if (!r.ok) { assert.equal(r.error, 'TOO_EARLY'); clock.now = r.retryAt; continue; }
    swings++;
    killed = r.events.some((e) => e.body.type === 'kill');
  }
  assert.ok(killed, 'mob died');
  assert.ok(swings > 1);
  assert.equal((await c.send({ type: 'attack', uid })).error, 'NO_TARGET');

  const log = (await get(`/api/characters/${ID}/events?after=${captured.lastSeq}`)).body;
  const types = log.events.map((e) => e.body.type);
  assert.deepEqual(types.slice(0, 2), ['searching', 'found']);
  assert.ok(types.includes('playerAttack') && types.includes('kill') && types.includes('exp'));
  const seqs = log.events.map((e) => e.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => captured.lastSeq + 1 + i));
  for (const e of log.events) assert.deepEqual(Object.keys(e).sort(), ['body', 'seq', 'simTime', 'wallMs']);
  const kill = log.events.find((e) => e.body.type === 'kill');
  for (const e of log.events) assert.ok(e.wallMs >= 1_800_000_000_000 && e.simTime >= captured.snapshot.time, JSON.stringify(e));
  assert.equal(log.events.find((e) => e.body.type === 'exp').wallMs, kill.wallMs);

  const drops = log.events.filter((e) => e.body.type === 'drop');
  if (drops.length) {
    const p = await c.send({ type: 'pickup', itemId: drops[0].body.itemId });
    assert.equal(p.ok, true);
    assert.equal(p.events[0].body.type, 'pickup');
  }
  assert.equal((await c.send({ type: 'pickup', itemId: 999999 })).error, 'NO_LOOT');

  const sum = (await get(`/api/characters/${ID}/summary?after=${captured.lastSeq}`)).body.summary;
  assert.equal(sum.kills, 1);
  assert.ok(sum.baseExp > 0);
  assert.equal(sum.fromSeq, captured.lastSeq + 1);

  const v = (await get(`/api/characters/${ID}`)).body;
  assert.ok(v.lastSeq > captured.lastSeq);
  assert.ok(v.snapshot.character.baseExp !== captured.snapshot.character.baseExp || v.snapshot.character.baseLv > captured.snapshot.character.baseLv);
  assert.equal(Object.values(v.snapshot.stats.kills).reduce((a, b) => a + b, 0),
    Object.values(captured.snapshot.stats.kills).reduce((a, b) => a + b, 0) + 1);

  await new Promise((r) => setTimeout(r, 50));
  assert.match(sseText, /^event: snapshot\ndata: \{"snapshot":/);
  assert.match(sseText, /event: events\ndata: \[\{"seq":/);
  assert.match(sseText, /"type":"kill"/);
  reader.cancel();
  c.ws.close();
});

test('cheat: attacking faster than ASPD is rejected with the interval', async (t) => {
  const { srv, clock, base } = await boot();
  t.after(() => srv.close());
  const c = connect(base);
  await c.open;
  const { uid } = await c.send({ type: 'search' });
  let r = await c.send({ type: 'attack', uid });
  clock.now = r.retryAt;
  r = await c.send({ type: 'attack', uid });
  assert.equal(r.ok, true);
  clock.now += 100; // ASPD interval is 646 ms for this character
  r = await c.send({ type: 'attack', uid });
  assert.deepEqual({ ok: r.ok, error: r.error, retryAt: r.retryAt }, { ok: false, error: 'TOO_EARLY', retryAt: clock.now - 100 + 646 });
  // no damage was rolled for the rejected swing
  assert.equal(r.events, undefined);
  c.ws.close();
});

test('cheat: SP, items and unlearned skills are validated', async (t) => {
  const { srv, clock, base } = await boot();
  t.after(() => srv.close());
  const c = connect(base);
  await c.open;
  const { uid } = await c.send({ type: 'search' });
  clock.now += 60_000;
  assert.equal((await c.send({ type: 'cast', uid, skill: 'MG_FIREBOLT', lv: 1 })).error, 'NOT_LEARNED');
  Object.assign(srv.game.chars.get(ID).fight.s.char, { sp: 0, skills: { MG_FIREBOLT: 1 } });
  assert.equal((await c.send({ type: 'cast', uid, skill: 'MG_FIREBOLT', lv: 1 })).error, 'NO_SP');
  assert.equal((await c.send({ type: 'useItem', uid: 999999 })).error, 'NO_ITEM');
  assert.equal((await c.send({ type: 'teleport' })).error, 'NO_ITEM');
  assert.equal((await c.send({ type: 'search' })).error, 'IN_FIGHT');
  assert.equal((await c.send({ type: 'fly' })).error, 'UNKNOWN_ACTION');
  c.ws.close();
});

test('one driver per character (second connection supersedes) and per-account cap', async (t) => {
  const { srv, base } = await boot({ maxDrivers: 1 });
  t.after(() => srv.close());
  srv.game.addCharacter({ ...captured, characterId: 1, name: 'twin' }, 'mike');
  const a = connect(base);
  await a.open;
  await a.next((x) => x.type === 'snapshot');
  const b = connect(base);
  await b.open;
  await a.next((x) => x.type === 'superseded');
  assert.equal(await a.closed, 4000);
  await b.next((x) => x.type === 'snapshot');
  const other = connect(base, 1);
  await other.next((x) => x.type === 'error' && x.error === 'DRIVER_LIMIT');
  assert.equal(await other.closed, 4001);
  const stranger = connect(base, ID, 'bad');
  assert.equal(await stranger.closed, 4401);
  b.ws.close();
});

test('party: one world per party; a kill shares EXP with members on the same map; others cannot hit your mob', async (t) => {
  const { srv, clock, base, get } = await boot();
  t.after(() => srv.close());
  const g = srv.game;
  g.addCharacter({ ...captured, characterId: 2, name: 'mate' }, 'mike');
  g.chars.get(2).partyId = g.chars.get(ID).partyId;
  const a = connect(base), b = connect(base, 2);
  await Promise.all([a.open, b.open]);
  const { uid } = await a.send({ type: 'search' });
  assert.equal((await b.send({ type: 'attack', uid })).error, 'NOT_YOURS');
  const mateExp = g.chars.get(2).snapshot.character.baseExp;
  for (let i = 0; i < 200; i++) {
    const r = await a.send({ type: 'attack', uid });
    if (!r.ok) { clock.now = r.retryAt; continue; }
    if (r.events.some((e) => e.body.type === 'kill')) break;
  }
  const exp = (await get(`/api/characters/2/events?after=0`)).body.events.find((e) => e.body.type === 'exp');
  assert.equal(exp.body.party, true);
  assert.equal(exp.body.by, captured.name);
  assert.ok(g.chars.get(2).snapshot.character.baseExp > mateExp || g.chars.get(2).snapshot.character.baseLv > captured.snapshot.character.baseLv);
  assert.equal((await get(`/api/characters/${ID}/party`)).body.party.members.length, 2);
  a.ws.close(); b.ws.close();
});

test('checkpoint: state survives a restart from the same SQLite file', async () => {
  const first = await boot();
  first.srv.game.chars.get(ID).snapshot.character.statPoints = 10;
  await first.cmd({ type: 'allocateStats', stats: { luk: 1 } });
  const c = connect(first.base);
  await c.open;
  await c.send({ type: 'search' });
  c.ws.close();
  await c.closed;
  await first.srv.close(); // checkpoints on close
  const second = await boot({ db: first.db, noSeed: true });
  const v = (await second.get(`/api/characters/${ID}`)).body;
  assert.equal(v.snapshot.character.stats.luk, captured.snapshot.character.stats.luk + 1);
  assert.ok(v.lastSeq > captured.lastSeq);
  assert.equal((await second.get(`/api/characters/${ID}/events?after=${captured.lastSeq}`)).body.events[0].body.type, 'searching');
  await second.srv.close();
});
