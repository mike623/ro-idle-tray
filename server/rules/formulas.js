// Pre-renewal-style stat and combat formulas for the owned server.
// Ported from scripts/formula-check.py (the oracle, validated against captures; see
// docs/offline-backend/formulas.md). All integer steps floor like the live server.
// Game records (job, item, monster, skill, refine table) are passed in; this module holds no game data
// except the bundle's element (`of`) and weapon-size (`cf`) tables.

const fl = Math.floor;
export const STATS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
export const ELEMENTS = ['neutral', 'water', 'earth', 'fire', 'wind', 'poison', 'holy', 'dark', 'ghost', 'undead'];

// ELEMENT_TABLE[defenderLv-1][attackElement][defenseElement], percent. Bundle `of` (sha256 78788be2…).
export const ELEMENT_TABLE = [
  [[100,100,100,100,100,100,100,100,25,100],[100,25,100,150,50,100,75,100,100,100],[100,100,100,50,150,100,75,100,100,100],[100,50,150,25,100,100,75,100,100,125],[100,175,50,100,25,100,75,100,100,100],[100,100,125,125,125,0,75,50,100,-25],[100,100,100,100,100,100,0,125,100,150],[100,100,100,100,100,50,125,0,100,-25],[25,100,100,100,100,100,75,75,125,100],[100,100,100,100,100,50,100,0,100,0]],
  [[100,100,100,100,100,100,100,100,25,100],[100,0,100,175,25,100,50,75,100,100],[100,100,50,25,175,100,50,75,100,100],[100,25,175,0,100,100,50,75,100,150],[100,175,25,100,0,100,50,75,100,100],[100,75,125,125,125,0,50,25,75,-50],[100,100,100,100,100,100,-25,150,100,175],[100,100,100,100,100,25,150,-25,100,-50],[0,75,75,75,75,75,50,50,150,125],[100,75,75,75,75,25,125,0,100,0]],
  [[100,100,100,100,100,100,100,100,0,100],[100,-25,100,200,0,100,25,50,100,125],[100,100,0,0,200,100,25,50,100,75],[100,0,200,-25,100,100,25,50,100,175],[100,200,0,100,-25,100,25,50,100,100],[100,50,100,100,100,0,25,0,50,-75],[100,100,100,100,100,125,-50,175,100,200],[100,100,100,100,100,0,175,-50,100,-75],[0,50,50,50,50,50,25,25,175,150],[100,50,50,50,50,0,150,0,100,0]],
  [[100,100,100,100,100,100,100,100,0,100],[100,-50,100,200,0,75,0,25,100,150],[100,100,-25,0,200,75,0,25,100,50],[100,0,200,-50,100,75,0,25,100,200],[100,200,0,100,-50,75,0,25,100,100],[100,25,75,75,75,0,0,-25,25,-100],[100,75,75,75,75,125,-100,200,100,200],[100,75,75,75,75,-25,200,-100,100,-100],[0,25,25,25,25,25,0,0,200,175],[100,25,25,25,25,-25,175,0,100,0]],
];

// Weapon size modifier percent. Bundle `cf`.
export const SIZE_TABLE = {
  fist: { small: 100, medium: 100, large: 100 }, dagger: { small: 100, medium: 75, large: 50 },
  '1hSword': { small: 75, medium: 100, large: 75 }, '2hSword': { small: 75, medium: 75, large: 100 },
  '1hSpear': { small: 75, medium: 75, large: 100 }, '2hSpear': { small: 75, medium: 75, large: 100 },
  '1hAxe': { small: 50, medium: 75, large: 100 }, '2hAxe': { small: 50, medium: 75, large: 100 },
  mace: { small: 75, medium: 100, large: 100 }, '2hMace': { small: 100, medium: 100, large: 100 },
  staff: { small: 100, medium: 100, large: 100 }, '2hStaff': { small: 100, medium: 100, large: 100 },
  bow: { small: 100, medium: 100, large: 75 }, knuckle: { small: 100, medium: 75, large: 50 },
  instrument: { small: 75, medium: 100, large: 75 }, whip: { small: 75, medium: 100, large: 50 },
  book: { small: 100, medium: 100, large: 50 }, katar: { small: 75, medium: 100, large: 75 },
};

const REBORN = new Set(['lord_knight', 'high_wizard', 'high_priest', 'sniper', 'assassin_cross', 'whitesmith', 'paladin',
  'champion', 'stalker', 'professor', 'clown', 'gypsy', 'creator']);
// Bundle buff table Pe[] (formulas.md "Buff … Bundle Pe[]"), lv → bonus in the bundle's shape. Numeric fields, `stats`
// and `statRate` are summed into `bonuses`; derive reads the panel ones (stats, hit, flee, crit, mdef, aspdRate, atk,
// maxHpRate, vitDefRate, magicPowerRate, …). Unknown ids throw so callers never silently ignore a stat source.
// ponytail: atkRate/masteryAtk (Concentration, Berserk, True Sight, Overthrust, Call Spirits) are summed but no damage
// formula reads them yet, and maps/flags (attackElement, elementAtkRate incl. SA_VOLCANO's Ee[], subRace, unbreakable)
// are dropped; wire them into playerDamage when a captured character uses one. Second args (BS_ADRENALINE/BS_OVERTHRUST
// `t`) are taken as self-cast.
const NO_STATS = () => ({});
const BUFFS = {
  ...Object.fromEntries(('LK_AURABLADE LK_PARRYING LK_TENSIONRELAX HP_BASILICA WS_CARTBOOST PA_SACRIFICE WS_MELTDOWN ST_REJECTSWORD '
    + 'ST_CHASEWALK MG_SIGHT AL_RUWACH MG_ENERGYCOAT KN_AUTOCOUNTER AS_POISONREACT MG_SAFETYWALL AL_PNEUMA TF_HIDING AS_CLOAKING '
    + 'PR_SUFFRAGIUM PR_SANCTUARY PR_KYRIE HP_ASSUMPTIO PR_MAGNIFICAT PR_SLOWPOISON CR_FULLPROTECTION PF_DOUBLECASTING CR_AUTOGUARD '
    + 'CR_DEVOTION CG_MARIONETTE PF_FOGWALL PF_MEMORIZE SA_MAGICROD BA_WHISTLE BA_ASSASSINCROSS BA_POEMBRAGI BA_APPLEIDUN DC_HUMMING '
    + 'DC_FORTUNEKISS DC_SERVICEFORYOU BD_LULLABY BD_RICHMANKIM BD_ETERNALCHAOS BD_DRUMBATTLEFIELD BD_RINGNIBELUNGEN BD_ROKISWEIL '
    + 'BD_INTOABYSS BD_SIEGFRIED CG_MOONLIT CG_HERMODE SA_AUTOSPELL SA_LANDPROTECTOR MO_EXTREMITYFIST HW_GRAVITATION MO_BLADESTOP '
    + 'AM_CP_WEAPON AM_CP_SHIELD AM_CP_ARMOR AM_CP_HELM AS_ENCHANTPOISON PR_ASPERSIO PR_BENEDICTIO BS_WEAPONPERFECT BS_MAXIMIZE '
    + 'SA_FLAMELAUNCHER SA_FROSTWEAPON SA_LIGHTNINGLOADER SA_SEISMICWEAPON CR_PROVIDENCE CR_REFLECTSHIELD SM_MAGNUM ASC_EDP')
    .split(' ').map((id) => [id, NO_STATS])),
  LK_CONCENTRATION: (e) => ({ hit: 10 * e, atkRate: 5 * e, defRate: -5 * e, vitDefRate: -5 * e, mdef: 1 }),
  LK_BERSERK: () => ({ maxHpRate: 200, aspdRate: 30, atkRate: 100 }),
  HW_MAGICPOWER: (e) => ({ magicPowerRate: 5 * e }),
  SN_SIGHT: (e) => ({ stats: { str: 5, agi: 5, vit: 5, int: 5, dex: 5, luk: 5 }, atkRate: 2 * e, hit: 3 * e, crit: e }),
  SN_WINDWALK: (e) => ({ flee: Math.ceil(e / 2) }),
  AL_BLESSING: (e) => ({ stats: { str: e, int: e, dex: e } }),
  HAMI_DEFENCE: (e) => ({ stats: { vit: 2 * e } }),
  AL_INCAGI: (e) => ({ stats: { agi: 2 + e } }),
  AL_ANGELUS: (e) => ({ vitDefRate: 5 * e }),
  SM_ENDURE: (e) => ({ mdef: e }),
  AC_CONCENTRATION: (e) => ({ statRate: { agi: 2 + e, dex: 2 + e } }),
  MC_LOUD: () => ({ stats: { str: 4 } }),
  KN_TWOHANDQUICKEN: () => ({ aspdRate: 30 }),
  PR_IMPOSITIO: (e) => ({ atk: 5 * e }),
  PR_GLORIA: () => ({ stats: { luk: 30 } }),
  BS_ADRENALINE: () => ({ aspdRate: 30 }),
  BS_OVERTHRUST: (e) => ({ atkRate: 5 * e }),
  WS_OVERTHRUSTMAX: (e) => ({ atkRate: 20 * e }),
  CR_DEFENDER: (e) => ({ aspdRate: -(25 - 5 * e) }),
  CR_SPEARQUICKEN: (e) => ({ aspdRate: 20 + e }),
  MO_CALLSPIRITS: (e) => ({ masteryAtk: 3 * e }),
  MO_EXPLOSIONSPIRITS: (e) => ({ crit: (75 + 25 * e) / 10 }),
  SA_VOLCANO: (e) => ({ atk: 10 * e }),
  SA_DELUGE: (e) => ({ maxHpRate: [5, 9, 12, 14, 15][e - 1] ?? 15 }),
  SA_VIOLENTGALE: (e) => ({ flee: 3 * e }),
  MO_STEELBODY: () => ({ aspdRate: -25 }),
};

const counter = () => new Proxy({}, { get: (o, k) => (k in o || typeof k === 'symbol' ? o[k] : 0) });
const lookup = (arr, lv) => (arr?.length ? arr[Math.min(lv, arr.length) - 1] : 0);
export const uniformInt = (lo, hi, rng = Math.random) => lo + fl(rng() * (hi - lo + 1));

export function equipped(state, items) {
  const inv = new Map(state.inventory.map((x) => [x.uid, x]));
  return Object.entries(state.equipment).filter(([, uid]) => inv.has(uid))
    .map(([slot, uid]) => ({ slot, stack: inv.get(uid), item: items[inv.get(uid).itemId] }));
}

/** Summed numeric equipment/card/buff bonuses; `stat.<x>` keys for stats. Throws on unsupported sources. */
export function bonuses(state, items) {
  const out = counter();
  for (const { slot, stack, item } of equipped(state, items)) {
    if (slot === 'ammo') continue;
    for (const src of [item, ...(stack.cards ?? []).map((c) => items[c])]) {
      const b = src.byRefine?.[String(stack.refine ?? 0)] ?? src.bonuses ?? {};
      for (const [k, v] of Object.entries(b)) {
        if (typeof v === 'number' || typeof v === 'boolean') out[k] += +v; // bool counts as 1, like the oracle
        else if (k === 'stats') for (const [s, n] of Object.entries(v)) out['stat.' + s] += n;
        else throw new Error(`unsupported equipment bonus ${k}`);
      }
    }
  }
  for (const { id, lv } of state.buffs) {
    if (!BUFFS[id]) throw new Error(`unsupported buff ${id}`);
    for (const [k, v] of Object.entries(BUFFS[id](lv))) {
      if (typeof v === 'number') out[k] += v;
      else if (k === 'stats' || k === 'statRate') for (const [s, n] of Object.entries(v)) out[(k === 'stats' ? 'stat.' : 'statRate.') + s] += n;
    }
  }
  return out;
}

export function totalStats({ stats, jobLv, skills = {} }, job, bonus) {
  const t = { ...stats };
  for (const b of job.jobBonus) if (b.lv <= jobLv) for (const [k, v] of Object.entries(b.stats)) t[k] += v;
  const base = { ...t }; // statRate (Attention Concentrate) scales base + job stats, like the bundle
  for (const k of STATS) t[k] += bonus['stat.' + k] + fl(base[k] * bonus['statRate.' + k] / 100);
  t.dex += skills.AC_OWL ?? 0;
  return t;
}

export const isRangedStat = (wt) => wt === 'bow' || wt === 'instrument' || wt === 'whip';
export function statusAtk(t, ranged) {
  const [main, sub] = ranged ? ['dex', 'str'] : ['str', 'dex'];
  return t[main] + fl(t[main] / 10) ** 2 + fl(t[sub] / 5) + fl(t.luk / 5);
}

export function matk(int, b = counter()) {
  const f = (d) => {
    const v = fl((int + fl(int / d) ** 2) * (100 + b.matkRate) / 100) + b.matk;
    return v + fl(v * b.magicPowerRate / 100);
  };
  return { min: f(7), max: f(5) };
}

export function maxPool(job, field, baseLv, stat, flat = 0, rate = 0) {
  const table = field === 'maxHp' ? job.baseHp : job.baseSp;
  let base = table[Math.min(baseLv, table.length) - 1];
  if (job.id.endsWith('_high') || REBORN.has(job.id)) base = fl(base * 125 / 100); // ponytail: reborn ×1.25 unverified (no reborn captures)
  return Math.max(1, fl((fl(base * (100 + stat) / 100) + flat) * (100 + rate) / 100));
}

/** Returns { motion, aspd, attackIntervalMs }. */
export function aspd(job, wt, agi, dex, aspdRate = 0, aspdAdd = 0) {
  const base = job.baseAspd[wt] ?? job.baseAspd.fist ?? 500;
  let motion = base - fl(base * (4 * agi + dex) / 1000);
  motion = Math.max(100, fl(motion * (100 - aspdRate) / 100) - 10 * aspdAdd);
  return { motion, aspd: (2000 - motion) / 10, attackIntervalMs: 2 * motion };
}

export const castMs = (skill, lv, dex) => fl(lookup(skill.castMs, lv) * Math.max(0, 150 - dex) / 150);
export const skillDelayMs = (skill, lv) => lookup(skill.delayMs, lv);
export const refineAtk = (refineTable, weaponLevel = 1, refine = 0) =>
  refine ? fl(refineTable.weapon[String(weaponLevel)][refine - 1].bonus / 100) : 0;
/** attack/defense are element names; a skill element of `weapon` must be resolved by the caller first. */
export function elementMod(attack, defense, defenseLv) {
  const a = ELEMENTS.indexOf(attack), d = ELEMENTS.indexOf(defense);
  if (a < 0 || d < 0 || !ELEMENT_TABLE[defenseLv - 1]) throw new Error(`unknown element ${attack}→${defense} Lv${defenseLv}`);
  return ELEMENT_TABLE[defenseLv - 1][a][d];
}
export const sizeMod = (wt, size) => SIZE_TABLE[wt][size];

/** Full stat panel (snapshot `derived` field names). data: { job, items, refine } (refine table needed for refined weapons). */
export function derive(state, { job, items, refine }) {
  const c = state.character;
  const b = bonuses(state, items);
  const t = totalStats(c, job, b);
  const sk = (k) => c.skills[k] ?? 0;
  const eq = equipped(state, items);
  const w = eq.find((e) => e.slot === 'weapon');
  const wt = w?.item.weaponType ?? 'fist';
  const ref = w?.stack.refine ?? 0;
  const armorRefine = eq.filter((e) => e.slot !== 'ammo' && !(e.item.slots ?? []).includes('weapon'))
    .reduce((n, e) => n + 70 * (e.stack.refine ?? 0), 0);
  const hard = eq.filter((e) => e.slot !== 'ammo').reduce((n, e) => n + (e.item.def ?? 0), 0) + b.def + fl((armorRefine + 50) / 100);
  const m = matk(t.int, b);
  const a = aspd(job, wt, t.agi, t.dex, b.aspdRate, b.aspdAdd);
  const maxHp = maxPool(job, 'maxHp', c.baseLv, t.vit, b.maxHp, b.maxHpRate);
  const maxSp = maxPool(job, 'maxSp', c.baseLv, t.int, b.maxSp, b.maxSpRate);
  return {
    total: t, maxHp, maxSp,
    statusAtk: statusAtk(t, isRangedStat(wt)),
    refineAtk: ref ? refineAtk(refine, w.item.weaponLevel, ref) : 0,
    matkMin: m.min, matkMax: m.max,
    hardDef: Math.min(99, fl(hard * Math.max(0, 100 + b.defRate) / 100)),
    vitDef: t.vit, hardMdef: Math.min(99, b.mdef), softMdef: t.int,
    hit: c.baseLv + t.dex + b.hit + sk('AC_VULTURE') + 2 * sk('BS_WEAPONRESEARCH'),
    flee: c.baseLv + t.agi + b.flee + 3 * sk('TF_MISS') + fl(3 * sk('MO_DODGE') / 2) + (sk('TF_BACKSLIDING') ? 10 : 0),
    perfectDodge: 1 + fl(t.luk / 10) + b.perfectDodge,
    crit: (1 + fl(t.luk * 3 / 10) + b.crit) * (wt === 'katar' ? 2 : 1),
    aspd: a.aspd, attackIntervalMs: a.attackIntervalMs,
    weightMax: job.baseWeight + 30 * t.str + 200 * sk('MC_INCCARRY') + (c.riding ? 1000 : 0) + 200 * Math.min(10, c.gymPass ?? 0),
    hpRegen: fl(fl((1 + fl(t.vit / 5) + fl(maxHp / 200)) * (sk('SM_MOVINGRECOVERY') ? 150 : 100) / 100) * (100 + b.hpRecovRate) / 100),
    spRegen: fl(fl((1 + fl(t.int / 6) + fl(maxSp / 100)) * (100 + b.spRecovRate) / 100) * (100 + 3 * sk('HP_MEDITATIO')) / 100),
    atkBonus: b.atk, vitDefRate: b.vitDefRate, // vitDefRate (Angelus) feeds monsterDamageRange
  };
}

/** One physical hit with all random parts already rolled. Crit ignores hard and soft DEF. */
export function playerDamage({ statAtk, weaponRoll, arrowRoll = 0, wt = 'fist', size, atkBonus = 0, refineAtk = 0,
  monsterDef = 0, monsterSoftDef = 0, elementMod = 100, hits = 1, crit = false, doubleLv = 0 }) {
  const base = statAtk + fl((weaponRoll + arrowRoll) * sizeMod(wt, size) / 100) + atkBonus;
  const dmg = crit ? base + refineAtk : fl(base * (100 - monsterDef) / 100) - monsterSoftDef + refineAtk;
  const out = Math.max(1, fl(dmg * elementMod / 100)) * hits;
  return wt === 'katar' ? out + katarOffhand(out, doubleLv) : out;
}
/** Katar off-hand hit, fitted to captures (all katar hits fit with it, formulas.md): floor(damage × (1 + 2×TF_DOUBLE lv) / 100). */
export const katarOffhand = (damage, doubleLv = 0) => fl(damage * (1 + 2 * doubleLv) / 100);

// Random parts of a physical hit: weapon roll [min,max], arrow roll [0,arrowAtk−1] (bow), monster soft DEF.
function physicalRolls({ dex, weapon = {}, arrowAtk = 0, monster, crit = false }) {
  const wt = weapon.weaponType ?? 'fist';
  const max = weapon.atk ?? 0;
  let min = Math.min(max, fl(dex * (80 + 20 * (weapon.weaponLevel ?? 0)) / 100));
  if (wt === 'bow') min = fl(min * max / 100);
  if (crit) min = max;
  const vit = monster.stats.vit;
  return { wt, weapon: [min, max], arrow: [0, wt === 'bow' ? Math.max(0, arrowAtk - 1) : 0], soft: [vit, vit + Math.max(0, fl(vit / 20) ** 2 - 1)] };
}
const physicalArgs = (o, r, weaponRoll, arrowRoll, monsterSoftDef) => ({ ...o, wt: r.wt, size: o.monster.size,
  monsterDef: o.monster.def, weaponRoll, arrowRoll, monsterSoftDef });

/** opts: { statAtk, dex, weapon, arrowAtk?, atkBonus?, refineAtk?, monster, elementMod?, hits?, crit?, doubleLv? (katar) } → { min, max } */
export function playerDamageRange(o) {
  const r = physicalRolls(o);
  return { min: playerDamage(physicalArgs(o, r, r.weapon[0], r.arrow[0], r.soft[1])),
    max: playerDamage(physicalArgs(o, r, r.weapon[1], r.arrow[1], r.soft[0])) };
}
export function rollPlayerDamage(o, rng = Math.random) {
  const r = physicalRolls(o);
  return playerDamage(physicalArgs(o, r, uniformInt(...r.weapon, rng), uniformInt(...r.arrow, rng), uniformInt(...r.soft, rng)));
}

/** Player soft DEF range, fitted to captures (same shape as rAthena pre-renewal; see formulas.md for counts): def2 = VIT scaled by Angelus. */
export function playerSoftDefRange(vit, vitDefRate = 0) {
  const def2 = fl(vit * (100 + vitDefRate) / 100);
  const lo = fl(def2 / 2);
  return [lo, lo + Math.max(0, fl(def2 * (def2 - 15) / 150) - 1)];
}
export const monsterDamage = (atkRoll, hardDef, softDef) => Math.max(1, fl(atkRoll * (100 - hardDef) / 100) - softDef);
/** opts: { atk: [min,max], hardDef, vit, vitDefRate? } → { min, max } */
export function monsterDamageRange({ atk, hardDef, vit, vitDefRate = 0 }) {
  const [lo, hi] = playerSoftDefRange(vit, vitDefRate);
  return { min: monsterDamage(atk[0], hardDef, hi), max: monsterDamage(atk[1], hardDef, lo) };
}
export function rollMonsterDamage({ atk, hardDef, vit, vitDefRate = 0 }, rng = Math.random) {
  return monsterDamage(uniformInt(...atk, rng), hardDef, uniformInt(...playerSoftDefRange(vit, vitDefRate), rng));
}

/** Bolt-type magic hit (fitted 474/0 on Lightning Bolt). */
export function magicDamage({ matkRoll, monster, elementMod = 100, hits = 1 }) {
  const dmg = fl(matkRoll * (100 - monster.mdef) / 100) - monster.stats.int - fl(monster.stats.vit / 2);
  return Math.max(1, fl(dmg * elementMod / 100)) * hits;
}

/** Even share per eligible member. ponytail: only n=8 verified; share mode / level-gap eligibility left to the caller. */
export function partyExpShare({ baseExp, jobExp }, members) {
  const pct = 100 + Math.min(100, 20 * (members - 1));
  return { base: fl(baseExp * pct / (100 * members)), job: fl(jobExp * pct / (100 * members)) };
}

/** Base EXP lost on death (mechanics page). ponytail: floor + novice exemption unverified (no deaths captured). */
export const deathPenalty = ({ baseExp, baseExpNext, job }) =>
  job === 'novice' ? 0 : Math.min(baseExp, fl(baseExpNext / 100));
