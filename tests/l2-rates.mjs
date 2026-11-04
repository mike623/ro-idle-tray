// Kill/EXP-per-hour check: each fixture character farms its map alone for N simulated hours
// (encounter → simulateFight → EXP), compared with the capture rates in docs/offline-backend/formulas.md.
// ponytail: HP/SP reset per fight (no regen, looting, sitting, town trips or party assist modelled).
import { readFileSync } from 'node:fs';
import { encounter, simulateFight, mulberry32 } from '../server/rules/engine.js';
import { fights, charOf, brainOf } from './l2-fights.mjs';

const game = JSON.parse(readFileSync(new URL('../src/game-data.json', import.meta.url)));
const monsters = Object.fromEntries(game.monsters.map((m) => [m.id, m]));
const skills = Object.fromEntries(game.skills.map((s) => [s.id, s]));
const maps = Object.fromEntries(game.maps.map((m) => [m.id, m]));

export function farm(fight, hours = 1, seed = 1) {
  const rng = mulberry32(seed), char = charOf(fight), brainChoices = brainOf(fight.charId), map = maps[fight.mapId];
  let t = 0, kills = 0, deaths = 0, baseExp = 0, jobExp = 0;
  while (t < hours * 3600e3) {
    const enc = encounter({ map, monsters, char, uid: kills, rng, brainChoices, skills });
    const r = simulateFight({ char, mob: enc.mob, rng, brainChoices, skills, buffs: [] });
    t += enc.searchMs + r.durationMs;
    if (r.outcome === 'kill') { kills++; baseExp += enc.mob.baseExp; jobExp += enc.mob.jobExp; } else deaths++;
  }
  return { kills: kills / hours, deaths: deaths / hours, baseExp: baseExp / hours, jobExp: jobExp / hours };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const latest = {};
  for (const f of fights) if (f.mapId === 'mjolnir_09' && (!latest[f.charId] || f.startSimTime > latest[f.charId].startSimTime)) latest[f.charId] = f;
  let party = { kills: 0, baseExp: 0 };
  console.log('| char | job | sim kills/h | sim deaths/h | sim solo base EXP/h | sim solo job EXP/h |');
  console.log('|---|---|---|---|---|---|');
  for (const f of Object.values(latest)) {
    const r = farm(f, 3);
    party.kills += r.kills; party.baseExp += r.baseExp;
    console.log(`| ${f.charId} | ${f.charSnapshot.character.job} | ${r.kills.toFixed(0)} | ${r.deaths.toFixed(1)} | ${r.baseExp.toFixed(0)} | ${r.jobExp.toFixed(0)} |`);
  }
  const n = Object.keys(latest).length;
  console.log(`party of ${n} farming independently: ${party.kills.toFixed(0)} kills/h, even-share base EXP/h per member ${(party.baseExp * Math.min(200, 100 + 20 * (n - 1)) / 100 / n).toFixed(0)}`);
}
