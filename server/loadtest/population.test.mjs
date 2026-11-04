import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, sharedConfigs, statPointsAt } from './population.mjs';
import { data } from '../game.js';

test('stat points: 48 at Lv1, + floor(lv/5)+3 per level up', () => {
  assert.equal(statPointsAt(1), 48);
  assert.equal(statPointsAt(2), 48 + 3);
  assert.equal(statPointsAt(6), 48 + 3 * 4 + 4);
});

test('generate: seeded, job mix by usage, parties of 1 / 2–4 / 8, levels fit the map, valid derived panels', () => {
  const a = generate({ bots: 400, seed: 3 }), b = generate({ bots: 400, seed: 3 });
  assert.deepEqual(a.chars.map((c) => [c.view.characterId, c.view.snapshot.mapId, c.view.snapshot.character.job]),
    b.chars.map((c) => [c.view.characterId, c.view.snapshot.mapId, c.view.snapshot.character.job]));
  assert.equal(a.chars.length, 400);
  const share = (j) => a.chars.filter((c) => c.view.snapshot.character.job === j).length / 400;
  assert.ok(share('novice') > 0.18 && share('novice') < 0.38, `novice ${share('novice')}`);
  const sizes = new Set(Object.values(Object.groupBy(a.chars, (c) => c.account)).map((x) => x.length));
  for (const n of sizes) assert.ok([1, 2, 3, 4, 8].includes(n), `party size ${n}`);
  assert.ok(sizes.has(1) && sizes.has(8));
  for (const c of a.chars) {
    const s = c.view.snapshot, map = data.maps[s.mapId], ch = s.character;
    assert.ok(map?.spawns?.length, s.mapId);
    assert.ok(data.maps[s.saveMap]?.type === 'town', s.saveMap);
    assert.ok(s.derived.maxHp > 0 && s.derived.attackIntervalMs > 0 && ch.hp === s.derived.maxHp, `${ch.job} panel`);
    const lvs = map.spawns.map((x) => data.monsters[x.monsterId].lv).sort((x, y) => x - y);
    assert.ok(lvs[0] <= ch.baseLv + 10, `${ch.job} Lv${ch.baseLv} on ${s.mapId} (${lvs[0]}+)`);
    assert.equal(s.config.lockMap, s.mapId);
    assert.ok(Object.values(ch.stats).every((x) => x >= 1 && x <= 99));
  }
  const cheats = a.chars.filter((c) => c.cheat).length;
  assert.ok(cheats === 0, 'no cheaters unless asked');
  assert.equal(generate({ bots: 200, seed: 1, cheatPct: 5 }).chars.filter((c) => c.cheat).length, 10);
});

test('shared configs from capture lines: weighted by `using`, own job only, used when present', () => {
  const line = (id, job, using) => JSON.stringify({ kind: 'http', method: 'GET', status: 200, path: `/api/shared-configs/${id}`,
    resp: { shared: { id, job, baseLv: 10, using, config: { config: { lockMap: 'x', sit: { enabled: true, hpBelow: 33 } } } } } });
  const cfgs = sharedConfigs([line(1, 'novice', 5), line(2, 'thief', 1), 'garbage']);
  assert.deepEqual(Object.keys(cfgs).sort(), ['novice', 'thief']);
  const p = generate({ bots: 60, seed: 2, configs: cfgs });
  const nov = p.chars.filter((c) => c.view.snapshot.character.job === 'novice');
  assert.ok(nov.length && nov.every((c) => c.view.snapshot.config.sit.hpBelow === 33 && c.configSource === 'shared'));
  assert.ok(nov.every((c) => c.view.snapshot.config.lockMap === c.view.snapshot.mapId));
  assert.ok(p.chars.some((c) => c.configSource === 'archetype'));
});
