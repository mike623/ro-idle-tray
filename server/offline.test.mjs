// Offline checkout (#18): characters with no driving client get a rate-based delta on return.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame } from './game.js';
import { attachOffline } from './offline.js';
import { mulberry32 } from './rules/engine.js';
import { seedCapture } from './seed.js';
import { startServer } from './index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lines = readFileSync(new URL('../tests/fixtures/server/capture-72397.jsonl', import.meta.url), 'utf8').trim().split('\n');
const ID = 72397, H = 3600e3, MIN = 60e3;

function world(seed = 7) {
  const clock = { now: 1_800_000_000_000 };
  const g = attachOffline(createGame({ now: () => clock.now, rng: mulberry32(seed) }));
  seedCapture(g, lines, { account: 'mike', token: 'tok' });
  g.online('mike');
  const C = g.chars.get(ID);
  return { g, clock, C };
}
// one hour of driven history on mjolnir_09: 60 kills of 1128, 100 base / 60 job each, 30 jellopy, 4 red potions
function history(g, clock, C) {
  g.driverOn(ID);
  g.recordActive(C, H);
  const evs = [];
  for (let i = 0; i < 60; i++) evs.push({ body: { type: 'kill', uid: i, monsterId: 1128 } }, { body: { type: 'exp', base: 100, job: 60 } });
  evs.push({ body: { type: 'pickup', itemId: 909, qty: 30, rare: false } });
  for (let i = 0; i < 4; i++) evs.push({ body: { type: 'useItem', itemId: 501, hp: 40, sp: 0, auto: true } });
  g.emit(C, evs);
  g.driverOff(ID);
}

test('view: settled character has no backlog; an undriven one freezes and accrues backlog', () => {
  const { g, clock, C } = world();
  let v = g.view(C);
  assert.equal(v.backlogMs, 0);
  assert.equal(v.clockFrozen, false);
  assert.equal(v.settledAtMs, clock.now);
  clock.now += 2 * H;
  v = g.view(C);
  assert.equal(v.backlogMs, 2 * H);
  assert.equal(v.clockFrozen, true);
  assert.equal(v.settledAtMs, clock.now - 2 * H);
});

test('checkout: away time × driven-history rates, then the summary reports it', () => {
  const { g, clock, C } = world();
  history(g, clock, C);
  const c = C.snapshot.character, before = { lv: c.baseLv, exp: c.baseExp, seq: C.lastSeq };
  const jellopy = C.snapshot.inventory.find((x) => x.itemId === 909)?.qty ?? 0;
  clock.now += 2 * H;
  const r = g.checkout(C);
  assert.equal(r.ms, 2 * H);
  assert.equal(r.kills, 120);
  assert.deepEqual(r.killsByMonster, { 1128: 120 });
  assert.equal(r.baseExp, 12000);
  assert.equal(r.jobExp, 7200);
  assert.equal(C.snapshot.inventory.find((x) => x.itemId === 909).qty, jellopy + 60);
  assert.ok(c.baseLv > before.lv || c.baseExp === before.exp + 12000);
  assert.equal(g.view(C).backlogMs, 0);
  const sm = g.summary(C, before.seq).summary;
  assert.equal(sm.estimatedMs, 2 * H);
  assert.equal(sm.kills, 120);
  assert.equal(sm.baseExp, 12000);
  assert.equal(sm.looted[909], 60);
  assert.equal(sm.used[501], 8);
  assert.equal(g.events(C, before.seq).gap, true); // the log has a hole where the away time was settled
  assert.equal(g.checkout(C), null); // nothing left to settle
});

test('checkout without history samples engine fights on the map', () => {
  const { g, clock, C } = world();
  const exp = C.snapshot.character.baseExp, lv = C.snapshot.character.baseLv;
  clock.now += H;
  const r = g.checkout(C);
  assert.equal(r.source, 'engine');
  assert.ok(r.kills > 50, `kills ${r.kills}`); // captured mjolnir_09 thief: ~100+ kills/h
  assert.ok(r.baseExp > 0);
  assert.ok(Object.keys(r.killsByMonster).every((id) => g.data.maps.mjolnir_09.spawns.some((sp) => sp.monsterId === +id)));
  assert.ok(C.snapshot.character.baseLv > lv || C.snapshot.character.baseExp > exp);
});

test('party keeps advancing while any member is live; away time starts when the last one leaves', () => {
  const { g, clock, C } = world();
  history(g, clock, C);
  g.addCharacter({ ...g.view(C), characterId: 2, name: 'mate' }, 'mike');
  g.chars.get(2).partyId = C.partyId;
  g.driverOn(2);
  for (let i = 0; i < 6; i++) { clock.now += 10 * MIN; g.act(2, { type: 'sit' }); } // mate drives for an hour
  assert.equal(g.view(C).backlogMs, 0);
  assert.equal(g.checkout(C), null);
  g.driverOff(2);
  clock.now += H;
  assert.equal(g.view(C).backlogMs, H);
  assert.equal(g.checkout(C).ms, H);
});

test('a driver silent for 20 min counts as offline; its next action settles the gap first', () => {
  const { g, clock, C } = world();
  history(g, clock, C);
  g.driverOn(ID);
  clock.now += 50 * MIN;
  assert.equal(g.view(C).backlogMs, 30 * MIN);
  const seq = C.lastSeq;
  g.act(ID, { type: 'sit' });
  assert.equal(g.summary(C, seq).summary.estimatedMs, 30 * MIN);
  assert.equal(g.view(C).backlogMs, 0);
});

test('7 days after the account was last online the character stops; later time only regenerates', () => {
  const { g, clock, C } = world();
  history(g, clock, C);
  C.snapshot.inventory.find((x) => x.itemId === 501).qty = 10000; // enough potions for the week
  const seq = C.lastSeq;
  clock.now += 10 * 24 * H;
  g.online('mike'); // returning settles everything past the cap before the clock resets
  const sm = g.summary(C, seq).summary;
  assert.equal(sm.estimatedMs, 7 * 24 * H);
  assert.equal(sm.stopped, 'OFFLINE_7D');
  assert.equal(C.running, false);
  assert.equal(sm.kills, 7 * 24 * 60);
});

test('running out of potions stops the farm at that point (CRITICAL_SUPPLY)', () => {
  const { g, clock, C } = world();
  history(g, clock, C); // 4 potions/h, 10 in stock → 2.5 h
  clock.now += 5 * H;
  const r = g.checkout(C);
  assert.equal(r.ms, 2.5 * H);
  assert.equal(r.stopped, 'CRITICAL_SUPPLY');
  assert.equal(r.used[501], 10);
  assert.equal(C.snapshot.inventory.some((x) => x.itemId === 501), false);
  assert.equal(C.running, false);
  assert.equal(g.summary(C, 0).summary.noPotion, 1);
});

test('death risk: a deadly map ends the farm with a death and a return to the save map', () => {
  const { g, clock, C } = world();
  history(g, clock, C);
  C.off.rates.mjolnir_09.deaths = 20; // 20 deaths/h → first death within the 4 h away for any sane draw
  clock.now += 4 * H;
  const r = g.checkout(C);
  assert.equal(r.deaths, 1);
  assert.ok(r.ms < 4 * H);
  assert.equal(C.snapshot.mapId, 'prontera');
  assert.equal(g.summary(C, 0).summary.deaths, 1);
});

test('benchmark: 24 h checkout p99 < 20 ms', () => {
  const { g, clock, C } = world();
  history(g, clock, C);
  C.snapshot.inventory.find((x) => x.itemId === 501).qty = 1e6;
  const ms = [];
  for (let i = 0; i < 500; i++) {
    g.online('mike'); // stay inside the 7-day cap so every run settles a full day
    clock.now += 24 * H;
    const t0 = performance.now();
    assert.equal(g.checkout(C).ms, 24 * H);
    ms.push(performance.now() - t0);
    C.snapshot.inventory = C.snapshot.inventory.filter((x) => x.itemId !== 909); // keep loot fitting under the weight cap
  }
  ms.sort((a, b) => a - b);
  const p50 = ms[250], p99 = ms[Math.floor(ms.length * 0.99)];
  const s = world(), t0 = performance.now();
  s.clock.now += 24 * H;
  assert.equal(s.g.checkout(s.C).source, 'engine'); // first checkout with no history: includes engine sampling
  const sampled = performance.now() - t0;
  console.log(`# 24h checkout (history): p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms; first engine-sampled checkout ${sampled.toFixed(1)} ms`);
  assert.ok(p99 < 20, `p99 ${p99} ms`);
  assert.ok(sampled < 20, `sampled ${sampled} ms`);
});

test('http: deferCatchup GET shows the backlog, the stream settles it and sends gap; summary reports; idle closes the stream', async (t) => {
  const clock = { now: 1_800_000_000_000 };
  const srv = await startServer({ port: 0, db: join(mkdtempSync(join(tmpdir(), 'ro-off-')), 'd.sqlite'), now: () => clock.now, seed: 7, tickMs: 0, checkpointMs: 0 });
  t.after(() => srv.close());
  seedCapture(srv.game, lines, { account: 'mike', token: 'tok' });
  srv.game.online('mike');
  const base = `http://127.0.0.1:${srv.port}/api/characters/${ID}`, headers = { authorization: 'Bearer tok' };
  const seq = srv.game.chars.get(ID).lastSeq;
  clock.now += 3 * H;
  const v = await (await fetch(`${base}?deferCatchup=1`, { headers })).json();
  assert.deepEqual([v.backlogMs, v.clockFrozen, v.settledAtMs], [3 * H, true, clock.now - 3 * H]);

  const res = await fetch(`${base}/stream?after=${seq}`, { headers });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let text = '';
  const until = async (s) => { while (!text.includes(s)) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); } };
  await until('event: events');
  const hello = JSON.parse(text.match(/event: snapshot\ndata: (.*)\n/)[1]);
  assert.equal(hello.backlogMs, 0);
  assert.ok(text.includes('event: gap'));
  const sm = (await (await fetch(`${base}/summary?after=${seq}`, { headers })).json()).summary;
  assert.equal(sm.estimatedMs, 3 * H);
  assert.equal(sm.gap, true);
  assert.ok(sm.kills > 0 && sm.baseExp > 0);
  console.log(`# example /summary after 3 h away (engine-sampled rates): ${JSON.stringify(sm)}`);

  clock.now += 21 * MIN;
  srv.sweep();
  await until('event: idle');
  assert.ok(text.includes('event: idle'));
});
