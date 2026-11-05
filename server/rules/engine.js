// Rules engine for the owned server: pure and deterministic. The caller injects the clock (`now`/`t`)
// and a seeded RNG (`mulberry32`). Combat math lives in formulas.js; this module sequences it and emits
// battle event bodies in the captured shapes (docs/offline-backend/api.md "Battle event") as `{t, body}`; the server
// wraps them into `{seq, body, wallMs, simTime}`. Attacks are neutral element (arrow/weapon elements not modelled).
//
// `char` (combat view of a character): { job, baseLv, jobLv, hp, sp, maxHp, maxSp, statusAtk, weapon: {weaponType,
// weaponLevel, atk}, arrowAtk?, refineAtk, atkBonus, dex, int, vit, vitDefRate, matkMin, matkMax, hit, flee, crit,
// perfectDodge, hardDef, attackIntervalMs, moveSpeedMs, attackRange, skills: {id: lv}, inventory?: {itemId: qty} },
// i.e. the snapshot `derived` panel plus totals (tests/l2-fights.mjs `charOf` builds it from a snapshot).
// `mob` is a src/game-data.json monster record; `skills` maps skill id → game-data skill row.

import * as f from './formulas.js';

/** Tiny seeded PRNG (mulberry32, public domain). Returns rng() → [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fl = Math.floor;
const pct = (p, rng) => rng() * 100 < p;
const clamp = (lo, hi, x) => Math.max(lo, Math.min(hi, x));

/**
 * Fight state; resolveAction/finishCast/mobTurn mutate it and append `{t, body}` to `events`.
 * `restat(buffs)` → char stat fields with those buffs active ([{id, lv}]); called when a buff starts or ends
 * (the server and the L2 replay re-derive with formulas.derive). Without it the char's stats stay as given.
 */
export function startFight({ char, mob, uid, skills = {}, items = {}, buffs = [], mobHp = mob.hp, t = 0, gap = 0, aggro = false, restat }) {
  return { t, uid, skills, items, gap, restat, buffs: buffs.map((b) => ({ ...b, endsAt: t + b.remainingMs })),
    char: { ...char, nextActAt: t, cooldowns: {} },
    mob: { ...mob, hpLeft: mobHp, aggro, aggroAt: aggro ? t : null, reachAt: t, nextAttackAt: null, skillReadyAt: {} },
    events: [], over: null };
}

const emit = (s, t, body) => { s.events.push({ t, body }); };
const restat = (s) => { if (s.restat) Object.assign(s.char, s.restat(s.buffs.filter((b) => !b.ended).map(({ id, lv }) => ({ id, lv })))); };
const me = (c) => [c.hp, c.sp];
const playerHit = (c, m) => clamp(5, 95, 80 + c.hit - (m.lv + m.stats.agi));

function physical(c, m, { elementMod, hits, crit = false, ratio = 100 }, rng) {
  return fl(f.rollPlayerDamage({ statAtk: c.statusAtk, dex: c.dex, weapon: c.weapon, arrowAtk: c.arrowAtk ?? 0,
    atkBonus: c.atkBonus, refineAtk: c.refineAtk, monster: m, elementMod, hits, crit, doubleLv: c.skills?.TF_DOUBLE ?? 0 }, rng) * ratio / 100);
}

function hitMob(s, t, dmg) {
  const m = s.mob;
  m.hpLeft = Math.max(0, m.hpLeft - dmg);
  if (m.aggro) return;
  m.aggro = true; m.aggroAt = t;
  m.reachAt = t + s.gap * m.walkSpeed; // hit from range: the mob walks the gap first
}
function checkKill(s, t) {
  if (s.mob.hpLeft > 0) return;
  emit(s, t, { type: 'kill', uid: s.uid, monsterId: s.mob.id });
  s.over = 'kill';
}

/** Server-side validation + resolution of one brain action. Returns {ok} or {ok:false, error}. */
export function resolveAction(s, a, rng) {
  const c = s.char, m = s.mob;
  if (s.over) return { ok: false, error: 'FIGHT_OVER' };
  if (a.type === 'item') { // ponytail: potions ignore the attack timer; no item delay modelled
    const it = s.items[a.itemId];
    if (!it || !(c.inventory?.[a.itemId] > 0)) return { ok: false, error: 'NO_ITEM' };
    c.inventory = { ...c.inventory, [a.itemId]: c.inventory[a.itemId] - 1 };
    const hp = it.hp ? Math.min(c.maxHp - c.hp, f.uniformInt(...it.hp, rng)) : 0;
    const sp = it.sp ? Math.min(c.maxSp - c.sp, f.uniformInt(...it.sp, rng)) : 0;
    c.hp += hp; c.sp += sp;
    emit(s, a.at, { type: 'useItem', itemId: a.itemId, hp, sp, auto: true });
    return { ok: true };
  }
  if (a.at < c.nextActAt) return { ok: false, error: 'TOO_EARLY', retryAt: c.nextActAt };
  if (a.type === 'attack') {
    const crit = pct(c.crit - m.stats.luk / 5, rng);
    const hit = crit || pct(playerHit(c, m), rng);
    const dbl = !crit && c.weapon.weaponType === 'dagger' && pct(5 * (c.skills?.TF_DOUBLE ?? 0), rng);
    const hits = dbl ? 2 : 1;
    const elementMod = f.elementMod('neutral', m.element, m.elementLv);
    const damage = hit ? physical(c, m, { elementMod, hits, crit }, rng) : 0;
    hitMob(s, a.at, damage);
    emit(s, a.at, { type: 'playerAttack', uid: s.uid, monsterId: m.id, me: me(c), damage, hpLeft: m.hpLeft,
      result: crit ? 'crit' : hit ? 'hit' : 'miss', elementMod, ...(hits > 1 && { hits }) });
    checkKill(s, a.at);
    c.nextActAt = a.at + c.attackIntervalMs;
    return { ok: true };
  }
  if (a.type === 'skill') {
    const sk = s.skills[a.skill];
    if (!sk || !(a.lv >= 1 && a.lv <= (c.skills?.[a.skill] ?? 0))) return { ok: false, error: 'NOT_LEARNED' };
    if ((c.cooldowns[a.skill] ?? 0) > a.at) return { ok: false, error: 'COOLDOWN', retryAt: c.cooldowns[a.skill] };
    const sp = lookup(sk.sp, a.lv);
    if (c.sp < sp) return { ok: false, error: 'NO_SP' };
    c.sp -= sp;
    const castMs = f.castMs(sk, a.lv, c.dex), delayMs = f.skillDelayMs(sk, a.lv);
    emit(s, a.at, { type: 'skillCast', skill: a.skill, lv: a.lv, castMs, delayMs, ...(sk.kind !== 'self' && { monsterId: m.id }) });
    c.casting = { sk, lv: a.lv, until: a.at + castMs, delayMs };
    c.nextActAt = c.casting.until;
    return { ok: true };
  }
  return { ok: false, error: 'UNKNOWN_ACTION' };
}

const lookup = (arr, lv) => (arr?.length ? arr[Math.min(lv, arr.length) - 1] : 0);
const skillRatio = (sk, lv) => +(sk.descs?.[lv - 1]?.match(/(\d+)%/)?.[1] ?? 100);

/** Lands the pending cast at its completion time. Magic always hits; weapon skills roll like a normal hit. */
export function finishCast(s, rng) {
  const c = s.char, m = s.mob, { sk, lv, until: t, delayMs } = c.casting;
  c.casting = null;
  c.nextActAt = t + Math.max(delayMs, c.attackIntervalMs);
  const cd = lookup(sk.cooldownMs, lv);
  if (cd) c.cooldowns[sk.id] = t + cd;
  if (sk.kind === 'self' || sk.kind === 'support') { // ponytail: support cast in a fight lands on the caster (no ally targets yet)
    const durationMs = lookup(sk.durationMs, lv);
    s.buffs = s.buffs.filter((b) => b.id !== sk.id); // a recast replaces the running buff
    s.buffs.push({ id: sk.id, lv, endsAt: t + durationMs });
    restat(s);
    emit(s, t, { type: 'buffStart', buffId: sk.id, durationMs });
    return;
  }
  const hits = lookup(sk.hits, lv) || 1;
  const element = !sk.element || sk.element === 'weapon' ? 'neutral' : sk.element;
  const elementMod = f.elementMod(element, m.element, m.elementLv);
  let damage, hit = true;
  if (sk.attackType === 'magic') {
    damage = f.magicDamage({ matkRoll: f.uniformInt(c.matkMin, c.matkMax, rng), monster: m, elementMod, hits });
  } else {
    hit = pct(playerHit(c, m), rng);
    damage = hit ? physical(c, m, { elementMod, hits, ratio: skillRatio(sk, lv) }, rng) : 0;
  }
  hitMob(s, t, damage);
  emit(s, t, { type: 'skillHit', uid: s.uid, monsterId: m.id, skill: sk.id, lv, me: me(c), damage, hpLeft: m.hpLeft, hits,
    result: hit ? 'hit' : 'miss', elementMod });
  checkKill(s, t);
}

function checkDeath(s, t) {
  if (s.char.hp > 0) return;
  emit(s, t, { type: 'death', uid: s.uid, monsterId: s.mob.id });
  s.over = 'death';
}

// ponytail: only damaging `NPC_*ATTACK` skills used in attack state; their ailments, PIERCINGATT's DEF bypass
// and non-damage skills (emotion, provocation, keeping) are not modelled.
function mobSkill(m, t, rng) {
  for (const sk of m.skills ?? []) {
    if (sk.state !== 'attack' || sk.cond !== 'always' || !/ATT(ACK)?$/.test(sk.skill) || (m.skillReadyAt[sk.skill] ?? 0) > t) continue;
    if (rng() * 10000 >= sk.rate) continue;
    m.skillReadyAt[sk.skill] = t + sk.delayMs;
    return sk;
  }
  return null;
}

/** Monster swings up to time `upTo`: first one uniformly within attackDelay after aggro, then every attackDelay. */
export function mobTurn(s, upTo, rng) {
  const c = s.char, m = s.mob;
  if (!m.aggro || m.behavior === 'immobile') return;
  m.nextAttackAt ??= Math.max(m.aggroAt, m.reachAt) + f.uniformInt(0, m.attackDelay, rng);
  while (!s.over && m.nextAttackAt <= upTo) {
    const t = m.nextAttackAt;
    const sk = mobSkill(m, t, rng);
    const dodge = pct(c.perfectDodge, rng);
    const hit = !dodge && pct(clamp(5, 95, 80 + m.lv + m.stats.dex - c.flee), rng);
    const roll = hit ? f.rollMonsterDamage({ atk: m.atk, hardDef: c.hardDef, vit: c.vit, vitDefRate: c.vitDefRate }, rng) : 0;
    const damage = sk && hit ? Math.max(1, fl(roll * f.elementMod(sk.element ?? 'neutral', 'neutral', 1) / 100)) : roll;
    c.hp = Math.max(0, c.hp - damage);
    if (sk) emit(s, t, { type: 'mobSkill', uid: s.uid, monsterId: m.id, skill: sk.skill, lv: sk.lv, damage, result: hit ? 'hit' : 'miss' });
    else emit(s, t, { type: 'monsterAttack', uid: s.uid, monsterId: m.id, me: me(c), damage, hpLeft: c.hp, maxHp: c.maxHp,
      result: dodge ? 'perfectDodge' : hit ? 'hit' : 'miss' });
    checkDeath(s, t);
    m.nextAttackAt = t + m.attackDelay;
  }
}

const OPENER_MS = 500; // ponytail: captured constant for a 9-cell ranged/Provoke opener (profile-5); origin unknown
const OPENER_CELLS = 9, MELEE_WALK_CELLS = 10;

/**
 * Encounter approach. Ranged opener (bow, Provoke, or a magic attack skill in the brain) starts 9 cells out and the
 * mob closes the gap at its walkSpeed (captured even for immobile mushrooms: 500 + 8×1000 ms); melee walks 10 cells.
 */
export function approach({ char, mob, brainChoices = {}, skills = {} }) {
  const ranged = char.weapon.weaponType === 'bow' || char.skills?.SM_PROVOKE
    || (brainChoices.attackSkills ?? []).some((r) => skills[r.skill]?.attackType === 'magic');
  if (ranged) return { approachMs: OPENER_MS, distance: OPENER_CELLS };
  return { approachMs: MELEE_WALK_CELLS * (char.moveSpeedMs ?? 150) };
}

function expireBuffs(s, upTo) {
  let changed = false;
  for (const b of s.buffs) {
    if (b.ended || b.endsAt > upTo) continue;
    b.ended = changed = true;
    emit(s, b.endsAt, { type: 'buffEnd', buffId: b.id });
  }
  if (changed) restat(s);
}

function brainAction(s, at, choices) {
  const c = s.char;
  const pot = choices.hpPotion;
  if (pot && c.hp * 100 < pot.belowPct * c.maxHp && c.inventory?.[pot.itemId] > 0) return { type: 'item', itemId: pot.itemId, at };
  const ready = (r) => { const sk = s.skills[r.skill]; return sk && r.lv <= (c.skills?.[r.skill] ?? 0)
    && c.sp >= lookup(sk.sp, r.lv) + (r.spAbove ?? 0) && (c.cooldowns[r.skill] ?? 0) <= at; };
  for (const r of choices.selfBuffs ?? []) {
    if (ready(r) && !s.buffs.some((b) => b.id === r.skill && !b.ended)) return { type: 'skill', skill: r.skill, lv: r.lv, at };
  }
  for (const r of choices.attackSkills ?? []) {
    if (ready(r)) return { type: 'skill', skill: r.skill, lv: r.lv, at };
  }
  return { type: 'attack', at };
}

/**
 * One fight from `found` (or an assist switch) to kill/death/timeout, driven by a simple brain.
 * Times are ms from fight start. Returns the events plus the L2 observables.
 */
export function simulateFight({ char, mob, buffs = [], brainChoices = {}, rng, skills = {}, items = {}, start = 'found',
  mobHp = mob.hp, uid = 1, maxMs = 600000, restat }) {
  const ap = start === 'found' ? approach({ char, mob, brainChoices, skills }) : { approachMs: 0 };
  // A ranged attacker keeps the gap until the mob walks it; a melee one meets the mob (Provoke lure walks it in).
  const range = char.attackRange ?? 1;
  const meleeMeet = ap.distance && range < ap.distance ? (ap.distance - range) * mob.walkSpeed : 0;
  const arrive = ap.approachMs + meleeMeet;
  const s = startFight({ char, mob, uid, skills, items, buffs, mobHp, gap: meleeMeet ? 0 : Math.max(0, (ap.distance ?? 1) - 1),
    aggro: mob.behavior === 'aggressive', restat });
  s.char.nextActAt = arrive;
  s.mob.reachAt = mob.behavior === 'aggressive' ? arrive + s.gap * mob.walkSpeed : arrive;
  if (s.mob.aggro) s.mob.aggroAt = arrive;
  while (!s.over) {
    const at = s.char.casting ? s.char.casting.until : s.char.nextActAt;
    if (at > maxMs) break;
    expireBuffs(s, at);
    mobTurn(s, at - 1, rng); // ponytail: on a tie the player acts first
    if (s.over) break;
    if (s.char.casting) { finishCast(s, rng); continue; }
    if (!resolveAction(s, brainAction(s, at, brainChoices), rng).ok) resolveAction(s, { type: 'attack', at }, rng);
  }
  s.events.sort((a, b) => a.t - b.t); // stable: buff expiries are emitted ahead of the swing that triggered the scan
  const own = s.events.filter((x) => (x.body.type === 'playerAttack' || x.body.type === 'skillHit'));
  const taken = s.events.filter((x) => x.body.type === 'monsterAttack' || x.body.type === 'mobSkill');
  return { outcome: s.over ?? 'timeout', durationMs: s.events.at(-1)?.t ?? 0, events: s.events,
    char: { hp: s.char.hp, sp: s.char.sp, vitDefRate: s.char.vitDefRate, inventory: s.char.inventory },
    attacksMade: own.length, hitsLanded: own.filter((x) => x.body.damage > 0).length,
    attacksReceived: taken.length, hitsReceived: taken.filter((x) => x.body.damage > 0).length,
    damageTaken: taken.reduce((n, x) => n + x.body.damage, 0) };
}

const SEARCH_MIN_MS = 300, SEARCH_MEAN_EXTRA_MS = 500; // fitted to captured searching→found gaps (mean ~800 ms, min 300)

/** searching → found: no coordinates; the monster is drawn by spawn count (mechanics page), search time is 300 ms + Exp(500 ms). */
export function encounter({ map, monsters, char, uid, rng, brainChoices, skills }) {
  const total = map.spawns.reduce((n, sp) => n + sp.count, 0);
  let pick = rng() * total;
  const spawn = map.spawns.find((sp) => (pick -= sp.count) < 0) ?? map.spawns.at(-1);
  const mob = monsters[spawn.monsterId];
  const searchMs = SEARCH_MIN_MS + Math.round(-SEARCH_MEAN_EXTRA_MS * Math.log(1 - rng()));
  const ap = approach({ char, mob, brainChoices, skills });
  return { mob, searchMs, ...ap, events: [{ t: 0, body: { type: 'searching' } },
    { t: searchMs, body: { type: 'found', uid, monsterId: mob.id, ...ap } }] };
}

const RARE_RATE = 30; // ponytail: captured rate 15 → rare, 30 → not; exact cut-off unverified
const WEIGHT_THRESHOLDS = [50, 90]; // regen stops at 50%, overweight handling at 90% (mechanics page)

/** Drop multiplier of the server-wide kill event for this monster at `now` (injected clock). */
export const killEventDropMult = (ev, monsterId, now) =>
  ev && ev.monsterId === monsterId && now >= ev.startsMs && now < ev.endsMs ? ev.dropMult : 1;

/**
 * EXP (even party share when members > 1), level-ups, drops (per-10000 slot rolls × dropMult) and auto-loot
 * with weight warnings. tables: { baseExpTable, jobExpTable } (bundle job rows). Needs the progress fields on `char`
 * too: baseExp, jobExp, statPoints, skillPoints, weight, weightMax. Returns { char, events } (t = 0).
 */
export function grantKill({ char, mob, members = 1, dropMult = 1, rng, tables, itemWeights = {}, autoLoot = true }) {
  const c = { ...char }, events = [];
  const push = (body) => events.push({ t: 0, body });
  const share = members > 1 ? f.partyExpShare(mob, members) : { base: mob.baseExp, job: mob.jobExp };
  push({ type: 'exp', base: share.base, job: share.job, basePct: share.base / tables.baseExpTable[c.baseLv - 1],
    jobPct: share.job / tables.jobExpTable[c.jobLv - 1], ...(members > 1 && { party: true }) });
  c.baseExp += share.base; c.jobExp += share.job;
  for (let need; (need = tables.baseExpTable[c.baseLv - 1]) && c.baseExp >= need;) {
    c.baseExp -= need; c.baseLv += 1;
    const statPoints = fl((c.baseLv - 1) / 5) + 3; // fits captured Lv48/49/51 → 12/12/13
    c.statPoints += statPoints;
    push({ type: 'baseLevelUp', lv: c.baseLv, statPoints });
  }
  for (let need; (need = tables.jobExpTable[c.jobLv - 1]) && c.jobExp >= need;) {
    c.jobExp -= need; c.jobLv += 1; c.skillPoints += 1;
    push({ type: 'jobLevelUp', lv: c.jobLv, skillPoints: 1 });
  }
  const slots = [...mob.drops.map((d) => ({ ...d, isCard: false })), ...(mob.card ? [{ ...mob.card, isCard: true }] : [])];
  const got = slots.filter((d) => rng() * 10000 < Math.min(10000, d.rate * dropMult))
    .map((d) => ({ itemId: d.itemId, qty: 1, rare: d.isCard || d.rate < RARE_RATE, isCard: d.isCard }));
  for (const d of got) push({ type: 'drop', itemId: d.itemId, qty: 1, monsterId: mob.id, rare: d.rare, isCard: d.isCard });
  if (autoLoot) for (const d of got) {
    const before = fl(c.weight * 100 / c.weightMax);
    c.weight += (itemWeights[d.itemId] ?? 0) * d.qty;
    push({ type: 'pickup', itemId: d.itemId, qty: d.qty, rare: d.rare });
    const percent = fl(c.weight * 100 / c.weightMax);
    const crossed = WEIGHT_THRESHOLDS.filter((th) => before < th && percent >= th).at(-1);
    if (crossed) push({ type: 'weight', percent, threshold: crossed });
  }
  return { char: c, events };
}

/** Death: lose 1% of this level's requirement (never below 0, no de-level, job EXP kept). */
export const applyDeath = (char, tables) => ({ ...char,
  baseExp: char.baseExp - f.deathPenalty({ baseExp: char.baseExp, baseExpNext: tables.baseExpTable[char.baseLv - 1], job: char.job }) });
