// brain/client.js against the real server (#16): seeded own character, injected clock, seeded RNG.
// Also the server pieces the Beta tray needs: `skip`, target uid, /brain/*.js and the cached official client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { seedCapture } from '../server/seed.js';
import { drive } from '../brain/client.js';

const lines = readFileSync(new URL('./fixtures/server/capture-72397.jsonl', import.meta.url), 'utf8').trim().split('\n');
const ID = 72397;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(o = {}) {
  const clock = { now: 1_800_000_000_000 };
  const dir = mkdtempSync(join(tmpdir(), 'ro-brain-'));
  const srv = await startServer({ port: 0, db: join(dir, 'data.sqlite'), now: () => clock.now, seed: 11, tickMs: 0, clientCache: join(dir, 'cache'), ...o });
  seedCapture(srv.game, lines, { account: 'mike', token: 'tok' });
  return { srv, clock, dir, base: `http://127.0.0.1:${srv.port}` };
}

test('client drives a seeded character for 120 simulated seconds: searching → found → attack → kill → pickup', async (t) => {
  const { srv, clock, base } = await boot();
  t.after(() => srv.close());
  const C = srv.game.chars.get(ID);
  C.running = true;
  C.snapshot.config.autoStorage.enabled = false; // stay on the lock map: this test is about the fight loop
  C.snapshot.config.townBuy = [];
  const d = drive({ base, characterId: ID, token: 'tok', now: () => clock.now, intervalMs: 0 });
  t.after(() => d.stop());
  await d.ready;
  for (let ms = 0; ms < 120_000; ms += 50) {
    clock.now += 50;
    srv.game.tick();
    d.step();
    await sleep(1);
  }
  await sleep(20);
  const types = C.log.map((e) => e.body.type);
  const first = (x, from = 0) => types.indexOf(x, from);
  const s = first('searching'), f = first('found', s), a = first('playerAttack', f), k = first('kill', a), p = first('pickup', k);
  assert.ok(s >= 0 && f > s && a > f && k > a && p > k, `order: ${types.slice(0, 40).join(' ')}`);
  const kills = types.filter((x) => x === 'kill').length;
  assert.ok(kills >= 3, `kills ${kills}`);
  assert.equal(types.filter((x) => x === 'drop').length, types.filter((x) => x === 'pickup').length, 'every drop picked up');
  // each kill is preceded by its own searching → found
  const seq = types.filter((x) => ['searching', 'found', 'kill'].includes(x)).join(' ');
  assert.match(seq, /^(searching found (searching found )*kill ?)+(searching( found)?)?$/);
  assert.ok(C.snapshot.character.baseExp > 33412, 'EXP gained');
});

test('skip: targetSkip ends a not-yet-engaged encounter; ENGAGED for an aggressive one; target carries uid', async (t) => {
  const { srv, clock } = await boot();
  t.after(() => srv.close());
  const g = srv.game;
  const r = g.act(ID, { type: 'search' });
  assert.ok(r.ok);
  assert.equal(g.snapshot(g.chars.get(ID)).target.uid, r.uid);
  assert.equal(g.act(ID, { type: 'skip', uid: r.uid }).error, 'TOO_EARLY', 'not met yet');
  clock.now += 5000;
  const F = g.chars.get(ID).fight;
  assert.equal(F.s.mob.aggro, false, 'seed 11 meets a passive monster');
  F.s.mob.aggro = true;
  assert.equal(g.act(ID, { type: 'skip', uid: r.uid }).error, 'ENGAGED');
  F.s.mob.aggro = false;
  const s = g.act(ID, { type: 'skip', uid: r.uid, reason: 'defend' });
  {
    assert.ok(s.ok);
    assert.deepEqual(s.events.at(-1).body, { type: 'targetSkip', reason: 'defend', monsterId: g.chars.get(ID).log.findLast((e) => e.body.type === 'found').body.monsterId });
    assert.equal(g.chars.get(ID).fight, null);
  }
  assert.equal(g.act(ID, { type: 'skip', uid: 999 }).error, 'NO_TARGET');
});

test('serves /brain/*.js and the official client from the local cache (one upstream GET per file)', async (t) => {
  const hits = [];
  const up = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.headers.cookie || req.headers.authorization) throw new Error('credentials leaked upstream');
    if (req.url === '/' || req.url === '/info') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<html>${req.url}</html>`); }
    if (req.url === '/assets/a.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('1'); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  t.after(() => up.close());
  const { srv, base, dir } = await boot({ upstream: `http://127.0.0.1:${up.address().port}` });
  t.after(() => srv.close());
  const get = (p) => fetch(base + p, { headers: { cookie: 'ro_token=tok' } });
  const brain = await get('/brain/brain.js');
  assert.equal(brain.status, 200);
  assert.match(brain.headers.get('content-type'), /javascript/);
  assert.match(await brain.text(), /export function tick/);
  assert.equal((await get('/brain/brain.mjs')).status, 404);
  assert.equal((await get('/brain/nope.js')).status, 404);
  for (let i = 0; i < 2; i++) {
    const r = await get('/?x=1');
    assert.equal(await r.text(), '<html>/</html>');
    assert.match(r.headers.get('content-type'), /html/);
    assert.equal(await (await get('/assets/a.js')).text(), '1');
    assert.equal(await (await get('/info')).text(), '<html>/info</html>');
  }
  assert.deepEqual(hits, ['/', '/assets/a.js', '/info'], 'cached after the first GET, query not forwarded');
  assert.equal((await get('/nope.png')).status, 404);
  assert.equal((await get('/%2e%2e/%2e%2e/etc/passwd')).status, 404);
  assert.ok(existsSync(join(dir, 'cache', 'assets', 'a.js')));
});
