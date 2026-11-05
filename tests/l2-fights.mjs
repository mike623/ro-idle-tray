// L2 replay: every fixture fight (tests/fixtures/fights) through simulateFight with N seeds; a fight passes when
// the real duration, damage taken and hits landed each sit within the simulated p5–p95.
import { readFileSync } from 'node:fs';
import { simulateFight, mulberry32 } from '../server/rules/engine.js';
import { derive } from '../server/rules/formulas.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const game = read('../src/game-data.json');
const itemInfo = read('../src/item-info.json');
const monsters = Object.fromEntries(game.monsters.map((m) => [m.id, m]));
const skills = Object.fromEntries(game.skills.map((s) => [s.id, s]));
export const fights = readFileSync(new URL('./fixtures/fights/fights.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const rules = read('../server/data/rules.json');
const summary = Object.fromEntries(read('./fixtures/fights/summary.json').fights.map((x) => [x.id, x]));

// item-info has no weapon fields; the corpus only carries these weapon kinds (desc text from the bundle).
const WEAPON_WORDS = [['單手斧', '1hAxe'], ['短劍', 'dagger'], ['弓', 'bow']];
function weaponOf(itemId) {
  const desc = itemInfo[itemId]?.desc ?? '';
  const type = WEAPON_WORDS.find(([w]) => desc.startsWith(w))?.[1];
  if (!itemId) return { weaponType: 'fist', weaponLevel: 0, atk: 0 };
  if (!type) throw new Error(`unknown weapon ${itemId}: ${desc}`);
  return { weaponType: type, weaponLevel: +desc.match(/武器等級 (\d+)/)[1], atk: +desc.match(/攻擊力 (\d+)/)[1] };
}

// Buff level when the fixture lost it (buffStart carries none): the level that buff most often has in the corpus.
const lvCount = {};
for (const f of fights) for (const b of f.buffs) if (b.lv) (lvCount[b.id] ??= {})[b.lv] = (lvCount[b.id][b.lv] ?? 0) + 1;
const usualLv = Object.fromEntries(Object.entries(lvCount).map(([id, n]) => [id, +Object.entries(n).sort((a, b) => b[1] - a[1])[0][0]]));
export const buffsOf = (fight) => fight.buffs.map((b) => ({ ...b, lv: b.lv ?? usualLv[b.id] }));

/** Derived panel of a fixture character with the given buffs (the snapshot's own panel may predate them). */
function panelOf(fight, buffs) {
  const { character, equipment, skills } = fight.charSnapshot;
  const slots = Object.entries(equipment);
  return derive({ character: { ...character, skills }, inventory: slots.map(([, x], i) => ({ uid: i + 1, ...x })),
    equipment: Object.fromEntries(slots.map(([k], i) => [k, i + 1])), buffs },
  { job: rules.jobs[character.job], items: rules.items, refine: rules.refine });
}
const statsOf = (d) => ({ maxHp: d.maxHp, maxSp: d.maxSp, statusAtk: d.statusAtk, refineAtk: d.refineAtk, atkBonus: d.atkBonus,
  dex: d.total.dex, int: d.total.int, vit: d.total.vit, vitDefRate: d.vitDefRate, matkMin: d.matkMin, matkMax: d.matkMax,
  hit: d.hit, flee: d.flee, crit: d.crit, perfectDodge: d.perfectDodge, hardDef: d.hardDef, attackIntervalMs: d.attackIntervalMs });
/** restat for simulateFight: the fixture character re-derived with the buffs still active. */
export const restatOf = (fight) => (buffs) => statsOf(panelOf(fight, buffs));

/**
 * Combat view of a fixture character at fight start: the captured panel (the fixture's buff levels are reconstructed
 * from party casts and sometimes wrong; the panel is what the server used), with Angelus from the fight-start buffs.
 * In-fight buff starts/ends re-derive through restatOf.
 */
export function charOf(fight) {
  const { character: c, derived: d, equipment: eq, skills: sk } = fight.charSnapshot;
  const angelus = buffsOf(fight).find((b) => b.id === 'AL_ANGELUS');
  return { job: c.job, baseLv: c.baseLv, jobLv: c.jobLv, hp: c.hp, sp: c.sp, ...statsOf(d), vitDefRate: angelus ? 5 * angelus.lv : 0,
    weapon: weaponOf(eq.weapon?.itemId), arrowAtk: eq.ammo ? +(itemInfo[eq.ammo.itemId]?.desc.match(/攻擊力 (\d+)/)?.[1] ?? 0) : 0,
    moveSpeedMs: d.moveSpeedMs, attackRange: d.attackRange, skills: sk };
}

// Attack skills each character was seen landing in the corpus = its brain's attack rules.
// Self buffs each character was seen casting = its buff-upkeep rules.
const brainByChar = {};
const addRule = (charId, kind, ev) => {
  const rules = ((brainByChar[charId] ??= { attackSkills: [], selfBuffs: [] })[kind]);
  if (!rules.some((r) => r.skill === ev.skill)) rules.push({ skill: ev.skill, lv: ev.lv });
};
for (const f of fights) for (const ev of f.events) {
  if (ev.type === 'skillHit') addRule(f.charId, 'attackSkills', ev);
  if (ev.type === 'skillCast' && skills[ev.skill]?.kind === 'self') addRule(f.charId, 'selfBuffs', ev);
}

export const brainOf = (charId) => brainByChar[charId] ?? {};

const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
// Own-finish: we dealt all damage from mobHpStart on (no party hits after we engaged) — the fights a solo replay can judge.
export const ownFinish = (f) => summary[f.id].ownDamage >= (f.mobHpStart ?? monsters[f.mobId].hp);
export const isSolo = (f) => f.start === 'found' && f.mobHpStart === monsters[f.mobId].hp && ownFinish(f);
const METRICS = ['durationMs', 'damageTaken', 'hitsLanded'];

export function replay(f, n = 1000) {
  const mob = monsters[f.mobId], char = charOf(f);
  const runs = Array.from({ length: n }, (_, seed) => simulateFight({ char, mob, buffs: buffsOf(f), restat: restatOf(f), rng: mulberry32(seed + 1),
    brainChoices: brainOf(f.charId), skills, start: f.start === 'found' ? 'found' : 'assist',
    mobHp: f.mobHpStart ?? mob.hp }));
  const real = summary[f.id];
  const out = { id: f.id, solo: isSolo(f), own: ownFinish(f), mobId: f.mobId, job: char.job, pass: true, metrics: {} };
  for (const k of METRICS) {
    const xs = runs.map((r) => r[k]).sort((a, b) => a - b);
    const [lo, hi] = [q(xs, 0.05), q(xs, 0.95)];
    const ok = real[k] >= lo && real[k] <= hi;
    out.metrics[k] = { real: real[k], p5: lo, p50: q(xs, 0.5), p95: hi, ok };
    out.pass &&= ok;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = +(process.argv[2] ?? 1000);
  const rs = fights.map((f) => replay(f, n));
  for (const [name, sel] of [['solo found', rs.filter((r) => r.solo)], ['own-finish (all damage ours)', rs.filter((r) => r.own)],
    ['party-helped', rs.filter((r) => !r.own)], ['all', rs]]) {
    const pass = sel.filter((r) => r.pass).length;
    const per = METRICS.map((k) => `${k} ${sel.filter((r) => r.metrics[k].ok).length}`).join(', ');
    console.log(`${name}: ${pass}/${sel.length} = ${(100 * pass / sel.length).toFixed(1)}% (${per})`);
  }
  const worst = rs.filter((r) => !r.pass && r.own);
  for (const r of worst.slice(0, 30)) console.log(r.id, r.job, r.mobId, JSON.stringify(Object.fromEntries(Object.entries(r.metrics).filter(([, m]) => !m.ok))));
}
