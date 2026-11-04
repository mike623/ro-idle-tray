// Seeded bot population for the load test (#24), from docs/offline-backend/population.md:
// map by player count, job by shared-config usage, level fitting the map, stats/skills/gear archetypes from game
// data, brain config = a real shared config of that job when the local capture has one (read at runtime, never
// committed), else an archetype config. Parties: solo, 2–4 and full 8 (one account per party).
import { readFileSync } from 'node:fs';
import { data } from '../game.js';
import * as f from '../rules/formulas.js';
import { mulberry32 } from '../rules/engine.js';

// population.md "Where players are": top-10 maps by characters; the long tail by the level-spread table.
const TOP_MAPS = { ein_fild04: 4975, pay_dun01: 2992, yuno_fild08: 2369, pay_fild02: 1903, prt_fild08: 1795, gef_fild14: 1528,
  iz_dun03: 1494, in_sphinx4: 1236, pay_dun03: 1215, mjolnir_05: 1025 };
const ALL_FIELD = 42091;
const LEVEL_SHARE = [13.6, 25.5, 29.2, 8.2, 7.2, 8.2, 7.4, 0.7]; // monster Lv 0–9, 10–19 … 70+ (% of field characters)
// population.md "Which jobs": share of config usage; the unlisted 2.2% = level-99 rebirths so AoE paths get exercised.
const JOB_SHARE = { novice: 28.1, bard: 10.2, dancer: 9.9, priest: 9.2, wizard: 7.1, hunter: 4.4, archer: 4.4, mage: 4.0, merchant: 3.8,
  acolyte: 3.2, thief: 3.0, swordman: 1.5, novice_high: 1.3, rogue: 1.3, crusader: 1.2, gypsy: 1.2, clown: 1.2, assassin: 1.1,
  blacksmith: 1.1, knight: 0.6, sage: 0.1, monk: 0.1, alchemist: 0.1, lord_knight: 0.3, high_wizard: 0.3, high_priest: 0.3,
  sniper: 0.3, assassin_cross: 0.3, whitesmith: 0.3, champion: 0.1, paladin: 0.1, stalker: 0.1, professor: 0.1 };
const FIRST = ['swordman', 'mage', 'archer', 'acolyte', 'merchant', 'thief'];
const TRANS = ['lord_knight', 'high_wizard', 'high_priest', 'sniper', 'assassin_cross', 'whitesmith', 'champion', 'paladin', 'stalker',
  'professor', 'creator', 'clown', 'gypsy'];
const tierOf = (job) => (job.startsWith('novice') ? 0 : FIRST.includes(job) || job.endsWith('_high') ? 1 : TRANS.includes(job) ? 3 : 2);
const LEVELS = [[1, 15], [10, 60], [40, 90], [80, 99]]; // base level window per tier
// Party mix by character share: solo 50% / 2–4 30% / full 8 20%, drawn per group (share ÷ mean size).
// ponytail: guessed split; population.md has no party data
const PARTY = [[0.5 / 1, () => 1], [0.3 / 3, (r) => 2 + Math.floor(r() * 3)], [0.2 / 8, () => 8]];
// Stat archetypes (allocation weights) by job family.
const FAMILY = [[/sword|knight|crusader|paladin/, { str: 5, vit: 3, dex: 2, agi: 2 }], [/thief|assassin|rogue|stalker/, { agi: 6, str: 3, dex: 2, luk: 1 }],
  [/archer|hunter|bard|dancer|clown|gypsy|sniper/, { dex: 6, agi: 3, int: 1 }], [/mage|wizard|sage|professor/, { int: 6, dex: 4 }],
  [/acolyte|priest|monk|champion/, { int: 4, vit: 3, dex: 2 }], [/merchant|smith|alchemist|creator/, { str: 5, dex: 3, vit: 2, agi: 1 }],
  [/novice/, { str: 3, agi: 3, dex: 2 }]];
const POTIONS = [[1, 501], [30, 502], [50, 503], [70, 504]]; // red / orange / yellow / white by base level
const TOWN_OF = [[/^prt|^prontera/, 'prontera'], [/^pay|^payon/, 'payon'], [/^gef|^geffen/, 'geffen'], [/^moc|^morocc|^in_sphinx/, 'morocc'],
  [/^iz|^izlude/, 'izlude'], [/^alb|^alberta/, 'alberta'], [/^ein/, 'einbroch'], [/^yuno|^juno/, 'yuno'], [/^mjolnir|^gl_|^glast/, 'prontera'],
  [/^ama/, 'amatsu'], [/^gon/, 'gonryun'], [/^lou/, 'louyang'], [/^um/, 'umbala'], [/^cmd|^comodo/, 'comodo'], [/^ald|^c_tower|^tur/, 'aldebaran'],
  [/^lhz|^lighthalzen/, 'lighthalzen'], [/^nif/, 'niflheim'], [/^xmas/, 'xmas'], [/^ayo/, 'ayothaya']];

export const statPointsAt = (lv) => { let p = 48; for (let i = 1; i < lv; i++) p += Math.floor(i / 5) + 3; return p; };
const raiseCost = (x) => Math.floor((x - 1) / 10) + 2;

function pick(rng, weights) { // weights: [[item, w]…]
  const total = weights.reduce((n, [, w]) => n + w, 0);
  let x = rng() * total;
  for (const [it, w] of weights) if ((x -= w) < 0) return it;
  return weights.at(-1)[0];
}

const mapLv = (m) => {
  const lvs = m.spawns.flatMap((s) => Array(Math.min(s.count, 50)).fill(data.monsters[s.monsterId]?.lv ?? 1)).sort((a, b) => a - b);
  return lvs[Math.floor(lvs.length / 2)];
};
const FARM_MAPS = Object.values(data.maps).filter((m) => m.type !== 'town' && m.spawns?.length).map((m) => ({ m, lv: mapLv(m), minLv: Math.min(...m.spawns.map((s) => data.monsters[s.monsterId]?.lv ?? 1)) }));
const bucket = (lv) => Math.min(7, Math.floor(lv / 10));
const inBucket = FARM_MAPS.filter((x) => !TOP_MAPS[x.m.id]).reduce((o, x) => { o[bucket(x.lv)] = (o[bucket(x.lv)] ?? 0) + 1; return o; }, {});
const topSum = Object.values(TOP_MAPS).reduce((a, b) => a + b, 0);
const mapWeight = (x) => TOP_MAPS[x.m.id] ?? (LEVEL_SHARE[bucket(x.lv)] / 100) * (ALL_FIELD - topSum) / inBucket[bucket(x.lv)];

/** Shared configs found in capture lines (`GET /api/shared-configs/:id` replies) → { job: [[config, using]…] }. */
export function sharedConfigs(lines) {
  const out = {};
  for (const line of lines) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r?.kind !== 'http' || !/^\/api\/shared-configs\/\d+$/.test(r.path ?? '') || r.status !== 200) continue;
    const sh = (typeof r.resp === 'string' ? JSON.parse(r.resp) : r.resp)?.shared;
    if (sh?.config?.config) (out[sh.job] ??= []).push([sh.config.config, Math.max(1, sh.using ?? 1)]);
  }
  return out;
}
export const sharedConfigsFrom = (files) => sharedConfigs(files.flatMap((p) => readFileSync(p, 'utf8').split('\n')));

function learnSkills(job, points) {
  const tree = data.jobs[job].skillTree, skills = {};
  const row = (id) => tree.find((x) => x.id === id);
  const kind = (id) => data.skills[id]?.kind;
  const order = [...tree].sort((a, b) => rank(kind(a.id)) - rank(kind(b.id)));
  function learn(id, lv) {
    const r = row(id);
    if (!r) return;
    for (const [req, n] of Object.entries(r.requires ?? {})) learn(req, n);
    while ((skills[id] ?? 0) < Math.min(lv, r.maxLv) && points > 0) { skills[id] = (skills[id] ?? 0) + 1; points--; }
  }
  for (const r of order) learn(r.id, r.maxLv);
  return skills;
}
function rank(k) { return { attack: 0, self: 1, support: 2, passive: 3 }[k] ?? 4; }

function allocate(weights, points) {
  const stats = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  for (;;) {
    const k = Object.keys(weights).filter((s) => stats[s] < 99 && raiseCost(stats[s]) <= points)
      .sort((a, b) => stats[a] / weights[a] - stats[b] / weights[b])[0];
    if (!k) return stats;
    points -= raiseCost(stats[k]);
    stats[k]++;
  }
}

const ITEMS = Object.values(data.items);
// only bonuses formulas.derive understands (numbers, flags, stats); others (attackElement…) are not modelled yet
const plain = (b = {}) => Object.entries(b).every(([k, v]) => typeof v === 'number' || typeof v === 'boolean' || k === 'stats');
const supported = (it) => plain(it.bonuses) && Object.values(it.byRefine ?? {}).every(plain);
const fits = (it, job, lv) => it.category === 'equipment' && (it.equipLevel ?? 0) <= lv && (it.jobs === 'all' || it.jobs?.includes(job)) && supported(it);
const TWO_HANDED = /^2h|bow|katar|instrument|whip/;

function gear(rng, job, lv) {
  const inv = [], equipment = {};
  let uid = 1;
  const put = (slot, it, extra = {}) => { const x = { qty: 1, uid: uid++, cards: [], itemId: it.id, refine: 0, ...extra }; inv.push(x); equipment[slot] = x.uid; return x; };
  const weapons = ITEMS.filter((it) => it.slots?.includes('weapon') && fits(it, job, lv) && data.jobs[job].baseAspd[it.weaponType])
    .sort((a, b) => (b.atk ?? 0) - (a.atk ?? 0)).slice(0, 3);
  const w = weapons.length ? weapons[Math.floor(rng() * weapons.length)] : null;
  if (w) {
    const x = put('weapon', w, { refine: w.refineable && rng() < 0.3 ? 1 + Math.floor(rng() * 7) : 0 });
    if (w.cardSlots && rng() < 0.15) { const cards = ITEMS.filter((c) => c.category === 'card' && c.slotType === 'weapon' && supported(c)); x.cards = [cards[Math.floor(rng() * cards.length)].id]; }
    if (w.weaponType === 'bow') { inv.push({ qty: 2000, uid: uid++, itemId: 1750 }); equipment.ammo = uid - 1; }
  }
  for (const slot of ['armor', 'headTop', 'garment', 'shoes', ...(w && TWO_HANDED.test(w.weaponType) ? [] : ['shield'])]) {
    const best = ITEMS.filter((it) => it.slots?.includes(slot) && fits(it, job, lv)).sort((a, b) => (b.def ?? 0) - (a.def ?? 0))[0];
    if (best) put(slot, best, { refine: best.refineable && rng() < 0.2 ? 1 + Math.floor(rng() * 5) : 0 });
  }
  return { inv, equipment, nextUid: uid };
}

function archetypeConfig(s, potion, map) {
  const sk = s.character.skills, learned = (k) => Object.keys(sk).filter((id) => data.skills[id]?.kind === k);
  const attack = learned('attack').filter((id) => data.skills[id].attackType && (data.skills[id].hits?.length || data.skills[id].attackType === 'magic'))
    .sort((a, b) => sk[b] - sk[a]).slice(0, 2).map((id) => ({ skill: id, lv: sk[id], use: 'attack', percent: 25 }));
  const buffs = learned('self').filter((id) => data.skills[id].durationMs?.length).slice(0, 2)
    .map((id) => ({ skill: id, lv: sk[id], use: 'buff', cond: { refreshBeforeSec: 5 } }));
  const heal = sk.AL_HEAL ? [{ skill: 'AL_HEAL', lv: sk.AL_HEAL, use: 'heal', percent: 50 }] : [];
  const loot = [...new Set(map.spawns.flatMap((x) => data.monsters[x.monsterId]?.drops ?? []).map((d) => d.itemId))]
    .filter((id) => ['material', 'etc'].includes(data.items[id]?.category));
  return { skills: [...heal, ...buffs, ...attack], hpPotion: { items: [potion], enabled: true, belowPercent: 35 },
    spPotion: { items: [], enabled: false, belowPercent: 20 }, recovery: { order: 'itemFirst', hysteresis: 10 },
    sit: { enabled: true, hpBelow: 30, hpUntil: 80, spBelow: heal.length || attack.some((a) => data.skills[a.skill].attackType === 'magic') ? 15 : 0, spUntil: 60 },
    townBuy: [{ itemId: potion, below: 5, qty: 40 }], autoSell: loot, autoLoot: true,
    autoStorage: { enabled: false, items: [], keep: {}, onReturn: true, abovePercent: 80 },
    escape: { lowHp: { action: 'fly', belowPercent: 15 }, dangerMonsters: [], avoidMvp: true },
    targets: { maxLv: 0, minLv: 0, blacklist: [], whitelist: [], avoidAggressive: false }, monsterRules: [],
    combat: { skillOnly: false }, statsAddAuto: { enabled: false, list: [] }, stopOnOverweight: false, autoResumeAfterDeath: true,
    partyAssist: false, lockMap: map.id };
}

const TEMPLATE = (() => {
  const line = readFileSync(new URL('../../tests/fixtures/server/capture-72397.jsonl', import.meta.url), 'utf8').trim().split('\n')
    .map((l) => JSON.parse(l)).find((r) => /^\/api\/characters\/\d+(\?|$)/.test(r.path));
  return (typeof line.resp === 'string' ? JSON.parse(line.resp) : line.resp).snapshot;
})();

function character(rng, { id, job, map, configs }) {
  const tier = tierOf(job), [lo, hi] = LEVELS[tier];
  const baseLv = tier === 3 && rng() < 0.6 ? 99 : Math.max(lo, Math.min(hi, map.lv - 2 + Math.floor(rng() * 12)));
  const maxJob = data.jobs[job].maxJobLv ?? 50;
  const jobLv = Math.max(1, Math.min(maxJob, Math.round(maxJob * Math.min(1, (baseLv - lo + 5) / (hi - lo + 5)))));
  const points = [0, 9, 58, 58 + 10][tier] + jobLv - 1; // novice basic 9, first job 49 more; rebirth bonus ~10
  const weights = FAMILY.find(([re]) => re.test(job))[1];
  const stats = allocate(weights, statPointsAt(baseLv) + (tier === 3 ? 52 : 0));
  const skills = learnSkills(job, points);
  const g = gear(rng, job, baseLv);
  const potion = POTIONS.findLast(([lv]) => baseLv >= lv)[1];
  g.inv.push({ qty: 30, uid: g.nextUid++, itemId: potion }, { qty: 5, uid: g.nextUid++, itemId: 601 }, { qty: 2, uid: g.nextUid++, itemId: 602 });
  const s = structuredClone(TEMPLATE);
  const j = data.jobs[job];
  Object.assign(s, { mapId: map.m.id, saveMap: TOWN_OF.find(([re]) => re.test(map.m.id))?.[1] ?? 'prontera', inventory: g.inv, equipment: g.equipment,
    buffs: [], activity: 'idle', engaged: false, target: null, restSit: false, autoSellHeld: {}, baseExpNext: j.baseExpTable[baseLv - 1] ?? 0,
    jobExpNext: j.jobExpTable[jobLv - 1] ?? 0, stats: { kills: {}, itemsLooted: {}, deaths: 0, deathLog: [] } });
  s.character = { ...s.character, job, name: `bot${id}`, baseLv, jobLv, baseExp: 0, jobExp: 0, statPoints: 0, skillPoints: 0, stats, skills,
    zeny: 1000 * baseLv };
  let shared = configs?.[job]?.length ? structuredClone(pick(rng, configs[job])) : null;
  s.config = shared ? { ...shared, lockMap: map.m.id } : archetypeConfig(s, potion, map.m);
  const d = f.derive(s, { job: j, items: data.items, refine: data.refine });
  s.derived = { ...s.derived, ...d, vitDefShown: d.vitDef };
  s.character.hp = d.maxHp; s.character.sp = d.maxSp;
  s.weight = s.inventory.reduce((w, x) => w + (data.items[x.itemId]?.weight ?? 0) * x.qty, 0);
  s.weightPercent = s.weight * 100 / d.weightMax;
  return { view: { characterId: id, name: `bot${id}`, revision: 0, commandRevision: 0, lastSeq: 0, running: true, snapshot: s },
    configSource: shared ? 'shared' : 'archetype' };
}

/** → { chars: [{ account, partyId, cheat, configSource, view }], parties: [{id, …}] } */
export function generate({ bots, seed = 1, configs = null, cheatPct = 0, firstId = 1_000_000 }) {
  const rng = mulberry32(seed), chars = [], parties = [];
  const jobs = Object.entries(JOB_SHARE).filter(([j]) => data.jobs[j]);
  let group = 0;
  while (chars.length < bots) {
    let size = pick(rng, PARTY.map(([w, n]) => [n, w]))(rng);
    size = Math.min(size, bots - chars.length);
    if (size > 4 && size < 8) size = 4;
    group++;
    const lead = pick(rng, jobs), tier = tierOf(lead), [lo, hi] = LEVELS[tier];
    const map = pick(rng, FARM_MAPS.filter((x) => x.lv >= lo - 5 && x.lv <= hi + 8).map((x) => [x, mapWeight(x)]));
    const account = `bots${group}`, partyId = size > 1 ? group : null;
    if (partyId) parties.push({ id: partyId, name: `party${group}`, leaderId: firstId + chars.length, expShare: 'even', itemShare: 'each', maxMembers: 12 });
    for (let i = 0; i < size; i++) {
      // members: own job by usage, but one that can farm the leader's map (same level window)
      const job = i === 0 ? lead : pick(rng, jobs.filter(([j]) => { const [a, b] = LEVELS[tierOf(j)]; return map.lv >= a - 5 && map.lv <= b + 8; }));
      chars.push({ account, partyId, cheat: false, ...character(rng, { id: firstId + chars.length, job, map, configs }) });
    }
  }
  const nCheat = Math.round(bots * cheatPct / 100); // spread over the population, deterministic
  for (let i = 0; i < nCheat; i++) chars[Math.floor((i + 0.5) * bots / nCheat)].cheat = true;
  return { chars, parties };
}
