// Server-authoritative buff clock: buffs count down on the injected wall clock, expire with `buffEnd`, re-derive the
// stat panel, persist through checkpoints and expire across offline away time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame } from './game.js';
import { attachOffline } from './offline.js';
import { mulberry32 } from './rules/engine.js';
import { seedCapture } from './seed.js';
import { startServer } from './index.js';

const lines = readFileSync(new URL('../tests/fixtures/server/capture-72397.jsonl', import.meta.url), 'utf8').trim().split('\n');
const ID = 72397, T0 = 1_800_000_000_000;
// captured view: Angelus 40455 ms, Blessing Lv10 93045 ms, Inc AGI Lv3 37236 ms; total agi 81 dex 31 str 19 int 11
const isView = (l) => { const p = JSON.parse(l).path; return p === '/api/characters/72397' || p.startsWith('/api/characters/72397?'); };
const captured = JSON.parse(JSON.parse(lines.find(isView)).resp).snapshot;

function world() {
  const clock = { now: T0 };
  const g = attachOffline(createGame({ now: () => clock.now, rng: mulberry32(7) }));
  seedCapture(g, lines, { account: 'mike', token: 'tok' });
  g.online('mike');
  return { g, clock, C: g.chars.get(ID) };
}
const remaining = (snap) => Object.fromEntries(snap.buffs.map((b) => [b.id, b.remainingMs]));
const ends = (C) => C.log.filter((x) => x.body.type === 'buffEnd');

test('buffs count down on the wall clock and expire with buffEnd; the panel loses their stats', () => {
  const { g, clock, C } = world();
  assert.deepEqual(remaining(g.view(C).snapshot), { AL_ANGELUS: 40455, AL_BLESSING: 93045, AL_INCAGI: 37236 });
  clock.now += 10_000;
  assert.deepEqual(remaining(g.view(C).snapshot), { AL_ANGELUS: 30455, AL_BLESSING: 83045, AL_INCAGI: 27236 });
  clock.now = T0 + 38_000;
  g.tick();
  const s = g.view(C).snapshot;
  assert.deepEqual(remaining(s), { AL_ANGELUS: 2455, AL_BLESSING: 55045 });
  assert.deepEqual(ends(C).map((x) => [x.body, x.wallMs]), [[{ type: 'buffEnd', buffId: 'AL_INCAGI' }, T0 + 37236]]);
  // Inc AGI Lv3 is "AGI +5" (skill desc): every other total stays as captured
  assert.deepEqual(s.derived.total, { ...captured.derived.total, agi: captured.derived.total.agi - 5 });
  assert.ok(s.derived.attackIntervalMs > captured.derived.attackIntervalMs, `${s.derived.attackIntervalMs}`);
  assert.ok(s.derived.flee < captured.derived.flee);
  clock.now = T0 + 100_000;
  g.tick();
  assert.deepEqual(g.view(C).snapshot.buffs, []);
  assert.deepEqual(ends(C).map((x) => x.body.buffId), ['AL_INCAGI', 'AL_ANGELUS', 'AL_BLESSING']);
  const t = g.view(C).snapshot.derived.total; // Blessing Lv10: STR/INT/DEX −10
  assert.deepEqual([t.str, t.int, t.dex], [captured.derived.total.str - 10, captured.derived.total.int - 10, captured.derived.total.dex - 10]);
});

test('a view between ticks already hides an expired buff (no tick needed)', () => {
  const { g, clock, C } = world();
  clock.now = T0 + 38_000;
  assert.equal(g.view(C).snapshot.buffs.some((b) => b.id === 'AL_INCAGI'), false);
  assert.equal(ends(C).length, 1);
});

test('a buff cast in a fight persists to the character with its expiry and live fight stats follow it', () => {
  const { g, clock, C } = world();
  clock.now = T0 + 38_000; // Inc AGI has expired
  g.tick();
  C.snapshot.character.skills.AL_INCAGI = 3;
  const { uid } = g.act(ID, { type: 'search' });
  clock.now += 5_000; // met and in range; Blessing (93 s) still up
  const slow = C.fight.s.char.attackIntervalMs;
  assert.equal(g.act(ID, { type: 'cast', uid, skill: 'AL_INCAGI', lv: 3 }).ok, true);
  clock.now += 1_000; // 1 s cast (DEX-reduced), then the buff lands
  g.tick();
  const b = g.view(C).snapshot.buffs.find((x) => x.id === 'AL_INCAGI');
  assert.equal(b.lv, 3);
  assert.ok(b.remainingMs > 99_000 && b.remainingMs <= 100_000, `${b.remainingMs}`); // Lv3 lasts 100 s
  assert.equal(g.view(C).snapshot.derived.total.agi, captured.derived.total.agi);
  assert.equal(g.view(C).snapshot.derived.attackIntervalMs, captured.derived.attackIntervalMs);
  assert.ok(C.fight.s.char.attackIntervalMs < slow);
  // the fight ending does not drop it; it still expires on the character's clock
  g.act(ID, { type: 'skip', uid });
  clock.now += 100_000;
  g.tick();
  assert.equal(g.view(C).snapshot.buffs.some((x) => x.id === 'AL_INCAGI'), false);
});

test('checkpoint: buff expiry is absolute and survives a restart (down time counts)', async () => {
  const clock = { now: T0 };
  const db = join(mkdtempSync(join(tmpdir(), 'ro-buffs-')), 'data.sqlite');
  const boot = () => startServer({ port: 0, db, now: () => clock.now, seed: 7, tickMs: 0 });
  const first = await boot();
  seedCapture(first.game, lines, { account: 'mike', token: 'tok' });
  clock.now += 5_000;
  await first.close();
  clock.now += 20_000; // server down 20 s
  const second = await boot();
  const r = await fetch(`http://127.0.0.1:${second.port}/api/characters/${ID}`, { headers: { authorization: 'Bearer tok' } });
  assert.deepEqual(remaining((await r.json()).snapshot), { AL_ANGELUS: 15455, AL_BLESSING: 68045, AL_INCAGI: 12236 });
  await second.close();
});

test('offline checkout: buffs expire across the away time', () => {
  const { g, clock, C } = world();
  clock.now += 2 * 3600e3;
  g.checkout(C);
  const s = g.view(C).snapshot;
  assert.deepEqual(s.buffs, []);
  assert.deepEqual(ends(C).map((x) => [x.body.buffId, x.wallMs - T0]), [['AL_INCAGI', 37236], ['AL_ANGELUS', 40455], ['AL_BLESSING', 93045]]);
  assert.equal(s.derived.total.agi, captured.derived.total.agi - 5);
});
