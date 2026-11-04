// Authoritative game state for the owned server (#16): characters, parties, account storage, event logs, live
// fights. In-memory; server/index.js checkpoints `dump()` to SQLite. Rules come from server/rules/engine.js; every
// action is timed with the injected wall clock `now()`, never a client-supplied time.
// Shapes follow docs/offline-backend/api.md (captured traffic).
import { readFileSync } from 'node:fs';
import * as e from './rules/engine.js';
import * as f from './rules/formulas.js';

const read = (u) => JSON.parse(readFileSync(new URL(u, import.meta.url)));
const game = read('../src/game-data.json');
const rules = read('./data/rules.json');
export const data = {
  ...rules,
  monsters: Object.fromEntries(game.monsters.map((m) => [m.id, m])),
  maps: Object.fromEntries(game.maps.map((m) => [m.id, m])),
  skills: Object.fromEntries(game.skills.map((s) => [s.id, s])),
};

const LOG_KEEP = 10000; // captured retainedFrom sits ~8–10k events back
const FLY_WING = 601, BUTTERFLY_WING = 602;
const REGEN_MS = 6000, SIT_REGEN_MS = 3000; // ponytail: RO natural regen tick (standing 6 s, sitting 3 s); unverified here
const STORAGE_FEE = 40; // captured at prontera; ponytail: one fee everywhere, add per-town `fees` when needed
const DEFAULT_KILL_EVENT = { id: 1, name: '全服擊殺波利', monsterId: 1002, target: 20000000, startsMs: 0, endsMs: 0, dropMult: 1.5,
  bonusMs: 259200000, reachedMs: null, missMult: 1.2, missedMs: null, progress: 0 };

export class RuleError extends Error {}
const rule = (ok, msg) => { if (!ok) throw new RuleError(msg); };
const fl = Math.floor;

export function createGame({ now = Date.now, rng = Math.random, maxDrivers = 8 } = {}) {
  const g = {
    data, now, rng, maxDrivers,
    accounts: new Map(), // name → { name, token }
    chars: new Map(), // id → C
    parties: new Map(), // id → party record (no members; members = chars with partyId)
    storage: new Map(), // account → storage object
    killEvent: { ...DEFAULT_KILL_EVENT },
    listeners: new Map(), // charId → Set(fn(name, data))
    nextUid: 1,
  };

  // ---------- views ----------
  g.view = (C) => ({ characterId: C.id, name: C.name, revision: C.revision, commandRevision: C.commandRevision, lastSeq: C.lastSeq,
    running: C.running, backlogMs: 0, settledAtMs: now(), clockFrozen: false, deleteAfterMs: null, snapshot: g.snapshot(C) });
  g.snapshot = (C) => {
    const s = C.snapshot;
    s.time = now() - C.simEpoch;
    if (!C.driven) return s; // a seeded twin stays identical to its capture until something drives it
    const fight = C.fight && !C.fight.s.over ? C.fight : null;
    s.engaged = !!fight;
    s.target = fight ? { name: fight.mob.name, lv: fight.mob.lv, hp: fight.s.mob.hpLeft, maxHp: fight.mob.hp } : null;
    s.aggressors = fight?.s.mob.aggro ? 1 : 0;
    return s;
  };
  const streamSnapshot = (C) => { const { characterId, name, clockFrozen, deleteAfterMs, snapshot, ...v } = g.view(C); return { snapshot, ...v }; };
  const notify = (C, name, payload) => { for (const fn of g.listeners.get(C.id) ?? []) fn(name, payload); };
  const touch = (C) => { C.revision++; notify(C, 'snapshot', streamSnapshot(C)); };
  g.subscribe = (id, fn) => { const set = g.listeners.get(id) ?? new Set(); g.listeners.set(id, set.add(fn)); return () => set.delete(fn); };

  /** Appends battle events ({t, body}) to the character's log and pushes them; returns the wrapped events. */
  function emit(C, list) {
    const out = list.map(({ t = now(), body }) => ({ seq: ++C.lastSeq, body, wallMs: t, simTime: t - C.simEpoch }));
    if (!out.length) return out;
    C.log.push(...out);
    if (C.log.length > LOG_KEEP) C.log.splice(0, C.log.length - LOG_KEEP);
    g.onEmit?.(C, out);
    notify(C, 'events', out);
    return out;
  }
  Object.assign(g, { emit, combatOf: (C) => combatOf(C), touch: (C) => touch(C), party: (C) => party(C), job: (C) => job(C),
    addItem, takeItem, progress: (M, mob) => progress(M, mob, 1, 1) }); // hooks for server/offline.js

  // ---------- characters ----------
  g.addCharacter = (view, account) => {
    const s = structuredClone(view.snapshot);
    const C = { id: view.characterId, name: view.name, account, revision: view.revision ?? 0, commandRevision: view.commandRevision ?? 0,
      lastSeq: view.lastSeq ?? 0, running: view.running ?? false, snapshot: s, partyId: null, log: [], commands: new Map(),
      simEpoch: now() - (s.time ?? 0), fight: null, regenAt: now() };
    g.chars.set(C.id, C);
    return C;
  };
  g.charsOf = (account) => [...g.chars.values()].filter((C) => C.account === account);
  const job = (C) => data.jobs[C.snapshot.character.job];
  const party = (C) => [...g.chars.values()].filter((x) => x === C || (C.partyId != null && x.partyId === C.partyId));

  /** Recomputes the stat panel (formulas.derive reproduces captured `derived` for all 8 captured characters). */
  function rederive(C) {
    const s = C.snapshot;
    try {
      Object.assign(s.derived, f.derive({ character: s.character, inventory: s.inventory, equipment: s.equipment, buffs: s.buffs },
        { job: job(C), items: data.items, refine: data.refine }));
    } catch { /* ponytail: unsupported buff/bonus → keep last panel; add the source to formulas.js BUFFS when it shows up */ }
    s.derived.vitDefShown = s.derived.vitDef; // ponytail: shown values kept equal; captured differ by Angelus share only
    const c = s.character;
    c.hp = Math.min(c.hp, s.derived.maxHp); c.sp = Math.min(c.sp, s.derived.maxSp);
    reweigh(C);
  }
  function reweigh(C) {
    const s = C.snapshot;
    s.weight = s.inventory.reduce((w, x) => w + (data.items[x.itemId]?.weight ?? 0) * x.qty, 0);
    s.weightPercent = s.weight * 100 / s.derived.weightMax;
  }
  const stack = (C, uid) => C.snapshot.inventory.find((x) => x.uid === uid);
  const isEquipped = (C, uid) => Object.values(C.snapshot.equipment).includes(uid);
  function addItem(C, itemId, qty) {
    const inv = C.snapshot.inventory, it = data.items[itemId];
    const equip = it?.category === 'equipment';
    const same = !equip && inv.find((x) => x.itemId === itemId);
    if (same) same.qty += qty;
    else inv.push(equip ? { qty, uid: nextInvUid(C), cards: [], itemId, refine: 0 } : { qty, uid: nextInvUid(C), itemId });
    reweigh(C);
  }
  const nextInvUid = (C) => C.snapshot.inventory.reduce((m, x) => Math.max(m, x.uid), 0) + 1;
  function takeItem(C, uid, qty) {
    const x = stack(C, uid);
    rule(x && x.qty >= qty && qty > 0, '物品不足');
    x.qty -= qty;
    if (!x.qty) C.snapshot.inventory.splice(C.snapshot.inventory.indexOf(x), 1);
    reweigh(C);
    return x;
  }
  const itemStack = (C, itemId) => C.snapshot.inventory.find((x) => x.itemId === itemId && x.qty > 0);

  /** Combat view of a character for the engine (same fields as tests/l2-fights.mjs `charOf`). */
  function combatOf(C) {
    const { character: c, derived: d, equipment: eq, buffs } = C.snapshot;
    const w = data.items[stack(C, eq.weapon)?.itemId];
    const ammo = data.items[stack(C, eq.ammo)?.itemId];
    const angelus = buffs.find((b) => b.id === 'AL_ANGELUS');
    return { job: c.job, baseLv: c.baseLv, jobLv: c.jobLv, hp: c.hp, sp: c.sp, maxHp: d.maxHp, maxSp: d.maxSp, statusAtk: d.statusAtk,
      weapon: w ? { weaponType: w.weaponType, weaponLevel: w.weaponLevel, atk: w.atk } : { weaponType: 'fist', weaponLevel: 0, atk: 0 },
      arrowAtk: ammo?.atk ?? 0, refineAtk: d.refineAtk, atkBonus: d.atkBonus, dex: d.total.dex, int: d.total.int, vit: d.total.vit,
      vitDefRate: angelus ? 5 * (angelus.lv ?? 10) : 0, matkMin: d.matkMin, matkMax: d.matkMax, hit: d.hit, flee: d.flee, crit: d.crit,
      perfectDodge: d.perfectDodge, hardDef: d.hardDef, attackIntervalMs: d.attackIntervalMs, moveSpeedMs: d.moveSpeedMs,
      attackRange: d.attackRange, skills: c.skills };
  }

  // ---------- fights ----------
  /** Runs the fight forward to `now()`: cast completions, monster swings, then delivers due events, kill/death. */
  function advance(C) {
    const F = C.fight;
    if (!F) return [];
    const t = now(), s = F.s;
    if (!s.over && s.char.casting && s.char.casting.until <= t) { e.mobTurn(s, s.char.casting.until - 1, g.rng); if (!s.over) e.finishCast(s, g.rng); }
    if (!s.over) e.mobTurn(s, t, g.rng);
    const c = C.snapshot.character;
    c.hp = s.char.hp; c.sp = s.char.sp;
    s.events.sort((a, b) => a.t - b.t);
    const due = s.events.filter((x) => x.t <= t);
    s.events = s.events.filter((x) => x.t > t);
    const out = emit(C, due);
    if (s.over === 'kill' && !F.settled) out.push(...onKill(C, F));
    if (s.over === 'death' && !F.settled) out.push(...onDeath(C, F));
    return out;
  }

  function onKill(C, F) {
    F.settled = true;
    const mob = F.mob, members = party(C).filter((x) => x === C || (x.running && x.snapshot.mapId === C.snapshot.mapId));
    const dropMult = e.killEventDropMult(g.killEvent, mob.id, now());
    if (g.killEvent.monsterId === mob.id) g.killEvent.progress++;
    const at = C.log.findLast((x) => x.body.type === 'kill' && x.body.uid === F.uid)?.wallMs ?? now(); // rewards land with the kill
    let out = [];
    for (const M of members) {
      const got = progress(M, M === C ? mob : { ...mob, drops: [], card: null }, members.length, dropMult);
      if (M === C) F.loot = got.events.filter((x) => x.body.type === 'drop').map((x) => x.body);
      const evs = got.events.map((x) => ({ t: at, body: M === C ? x.body : { ...x.body, by: C.name } }));
      const pushed = emit(M, evs);
      if (M === C) out = pushed;
      if (M !== C) touch(M);
    }
    const st = C.snapshot.stats;
    if (st?.kills) st.kills[mob.id] = (st.kills[mob.id] ?? 0) + 1;
    C.snapshot.activity = F.loot.length ? 'looting' : 'idle';
    touch(C);
    return out;
  }
  /** grantKill applied to a character's snapshot (EXP, level-ups, next-level tables). */
  function progress(M, mob, members, dropMult) {
    const s = M.snapshot, c = s.character, j = job(M);
    const r = e.grantKill({ char: { ...c, weight: s.weight, weightMax: s.derived.weightMax }, mob, members, dropMult, rng: g.rng,
      tables: j, autoLoot: false });
    const lvBefore = c.baseLv;
    for (const k of ['baseLv', 'jobLv', 'baseExp', 'jobExp', 'statPoints', 'skillPoints']) c[k] = r.char[k];
    s.baseExpNext = j.baseExpTable[c.baseLv - 1] ?? 0;
    s.jobExpNext = j.jobExpTable[c.jobLv - 1] ?? 0;
    if (c.baseLv !== lvBefore) rederive(M);
    return r;
  }
  function onDeath(C, F) {
    F.settled = true;
    const s = C.snapshot, c = s.character;
    emit(C, [{ body: { type: 'death', monsterId: F.mob.id } }]); // ponytail: shape guessed (never captured); summary already reads it
    c.baseExp = e.applyDeath({ ...c }, job(C)).baseExp;
    // ponytail: instant respawn at the save map with 50% HP/SP (mechanics page); the 5 s respawn delay is not modelled
    c.hp = fl(s.derived.maxHp / 2); c.sp = fl(s.derived.maxSp / 2);
    const from = s.mapId;
    s.mapId = s.saveMap;
    if (s.stats) { s.stats.deaths = (s.stats.deaths ?? 0) + 1; s.stats.deathLog?.push({ t: s.time, mapId: from, damage: 0, monsterId: F.mob.id }); } // ponytail: killing-blow damage not tracked
    C.fight = null;
    s.activity = 'idle';
    const out = emit(C, [{ body: { type: 'mapChange', from, to: s.mapId, cause: 'return' } }]);
    touch(C);
    return out;
  }

  const ownerOf = (uid) => [...g.chars.values()].find((x) => x.fight?.uid === uid);
  function target(C, uid) {
    advance(C);
    if (C.fight?.uid === uid && !C.fight.s.over) return C.fight;
    rule(!ownerOf(uid) || ownerOf(uid).fight.s.over, 'NOT_YOURS');
    throw new RuleError('NO_TARGET');
  }
  const engineResult = (C, r) => {
    if (!r.ok) return r;
    return { ok: true, events: advance(C) };
  };

  // ---------- brain actions (WebSocket) ----------
  const actions = {
    search(C) {
      advance(C);
      rule(!C.fight || C.fight.s.over, 'IN_FIGHT');
      const map = data.maps[C.snapshot.mapId];
      rule(map?.spawns?.length, 'NO_MONSTERS');
      const c = combatOf(C);
      rule(c.hp > 0, 'DEAD');
      const t = now(), uid = g.nextUid++;
      const enc = e.encounter({ map, monsters: data.monsters, char: c, uid, rng: g.rng });
      const mob = enc.mob, foundAt = t + enc.searchMs;
      // same opening geometry as engine.simulateFight
      const meleeMeet = enc.distance && c.attackRange < enc.distance ? (enc.distance - c.attackRange) * mob.walkSpeed : 0;
      const arrive = foundAt + enc.approachMs + meleeMeet;
      const s = e.startFight({ char: c, mob, uid, skills: data.skills, buffs: C.snapshot.buffs, t: foundAt,
        gap: meleeMeet ? 0 : Math.max(0, (enc.distance ?? 1) - 1), aggro: mob.behavior === 'aggressive' });
      s.char.nextActAt = arrive;
      s.mob.reachAt = mob.behavior === 'aggressive' ? arrive + s.gap * mob.walkSpeed : arrive;
      if (s.mob.aggro) s.mob.aggroAt = arrive;
      s.events = enc.events.map((x) => ({ t: t + x.t, body: x.body }));
      C.fight = { uid, mob, s, loot: [] };
      C.snapshot.restSit = false;
      C.snapshot.activity = 'searching';
      return { ok: true, uid, events: advance(C) };
    },
    attack(C, a) {
      const F = target(C, a.uid);
      C.snapshot.activity = 'attacking';
      return engineResult(C, e.resolveAction(F.s, { type: 'attack', at: now() }, g.rng));
    },
    cast(C, a) {
      const F = target(C, a.uid);
      rule(!F.s.char.casting, 'CASTING');
      return engineResult(C, e.resolveAction(F.s, { type: 'skill', skill: a.skill, lv: a.lv, at: now() }, g.rng));
    },
    useItem(C, a) {
      const x = stack(C, a.uid);
      rule(x, 'NO_ITEM');
      return { ok: true, events: useItem(C, x) };
    },
    pickup(C, a) {
      advance(C);
      const loot = C.fight?.loot ?? [];
      const i = loot.findIndex((d) => d.itemId === a.itemId);
      rule(i >= 0, 'NO_LOOT');
      const [d] = loot.splice(i, 1);
      addItem(C, d.itemId, d.qty);
      const st = C.snapshot.stats;
      if (st?.itemsLooted) st.itemsLooted[d.itemId] = (st.itemsLooted[d.itemId] ?? 0) + d.qty;
      const out = emit(C, [{ body: { type: 'pickup', itemId: d.itemId, qty: d.qty, rare: d.rare } }]);
      touch(C);
      return { ok: true, events: out };
    },
    sit(C) {
      advance(C);
      rule(!C.fight || C.fight.s.over, 'IN_FIGHT');
      C.snapshot.restSit = true;
      C.snapshot.activity = 'idle';
      touch(C);
      return { ok: true, events: [] };
    },
    teleport(C) {
      const map = data.maps[C.snapshot.mapId];
      rule(map?.teleportAllowed !== false, 'NO_TELEPORT');
      const wing = itemStack(C, FLY_WING);
      rule(wing || C.snapshot.character.skills.AL_TELEPORT, 'NO_ITEM');
      if (wing) takeItem(C, wing.uid, 1);
      C.fight = null;
      const out = emit(C, [{ body: { type: 'teleport', mapId: C.snapshot.mapId } }]);
      touch(C);
      return { ok: true, events: out };
    },
    return(C) {
      const wing = itemStack(C, BUTTERFLY_WING);
      rule(wing, 'NO_ITEM');
      takeItem(C, wing.uid, 1);
      return { ok: true, events: changeMap(C, C.snapshot.saveMap, 'return') };
    },
  };
  g.act = (id, a) => {
    const C = g.chars.get(id);
    C.driven = true;
    if (!Object.hasOwn(actions, a?.type)) return { ok: false, error: 'UNKNOWN_ACTION' };
    try { return actions[a.type](C, a); } catch (err) {
      if (err instanceof RuleError) return { ok: false, error: err.message };
      throw err;
    }
  };

  function useItem(C, x) {
    const it = data.items[x.itemId];
    rule(it?.category === 'consumable' && (it.effect?.healHp || it.effect?.healSp), 'NO_ITEM');
    const c = C.snapshot.character, d = C.snapshot.derived;
    const roll = (r) => (r ? f.uniformInt(r[0], r[1], g.rng) : 0);
    const hp = Math.min(d.maxHp - c.hp, roll(it.effect.healHp)), sp = Math.min(d.maxSp - c.sp, roll(it.effect.healSp));
    takeItem(C, x.uid, 1);
    c.hp += hp; c.sp += sp;
    if (C.fight && !C.fight.s.over) Object.assign(C.fight.s.char, { hp: c.hp, sp: c.sp });
    const out = emit(C, [{ body: { type: 'useItem', itemId: x.itemId, hp, sp, auto: false } }]);
    touch(C);
    return out;
  }
  function changeMap(C, to, cause) {
    const from = C.snapshot.mapId;
    C.snapshot.mapId = to;
    C.fight = null;
    C.snapshot.activity = 'idle';
    const out = emit(C, [{ body: { type: 'mapChange', from, to, cause } }]);
    touch(C);
    return out;
  }

  // ---------- persistent commands (REST) ----------
  const inTown = (C) => data.maps[C.snapshot.mapId]?.type === 'town';
  const commands = {
    start(C) { C.running = true; emit(C, [{ body: { type: 'start', mapId: C.snapshot.mapId } }]); },
    stop(C) { C.running = false; C.fight = null; C.snapshot.activity = 'stopped'; emit(C, [{ body: { type: 'stop', reason: 'MANUAL' } }]); },
    selectMap(C, { mapId }) { rule(data.maps[mapId], '地圖不存在'); changeMap(C, mapId, 'manual'); },
    updateConfig(C, { config }) {
      rule(config && typeof config === 'object' && !Array.isArray(config), '設定格式錯誤');
      C.snapshot.config = config;
      emit(C, [{ body: { type: 'config', message: '掛機設定已更新' } }]);
    },
    allocateStats(C, { stats }) {
      const c = C.snapshot.character;
      for (const [k, n] of Object.entries(stats ?? {})) {
        rule(f.STATS.includes(k) && Number.isInteger(n) && n > 0, '屬性錯誤');
        for (let i = 0; i < n; i++) {
          const cost = fl((c.stats[k] - 1) / 10) + 2; // RO raise cost
          rule(c.stats[k] < 99 && c.statPoints >= cost, '屬性點不足');
          c.statPoints -= cost; c.stats[k]++;
        }
      }
      rederive(C);
    },
    learnSkills(C, { skills }) {
      const c = C.snapshot.character;
      for (const id of skills ?? []) {
        const row = job(C).skillTree.find((x) => x.id === id);
        rule(row && (c.skills[id] ?? 0) < row.maxLv && c.skillPoints > 0, '無法學習技能');
        rule(Object.entries(row.requires ?? {}).every(([k, lv]) => (c.skills[k] ?? 0) >= lv), '前置技能不足');
        c.skillPoints--; c.skills[id] = (c.skills[id] ?? 0) + 1;
      }
      rederive(C);
    },
    equip(C, { uid }) {
      const x = stack(C, uid), it = data.items[x?.itemId], c = C.snapshot.character;
      rule(it?.slots?.length && !isEquipped(C, uid), '無法裝備');
      rule((it.equipLevel ?? 0) <= c.baseLv && (it.jobs === 'all' || it.jobs?.includes(c.job)), '無法裝備');
      // ponytail: no two-hand/shield exclusion; add it with the first two-handed weapon in a seeded character
      const slot = it.slots.find((sl) => !C.snapshot.equipment[sl]) ?? it.slots[0];
      C.snapshot.equipment[slot] = uid;
      rederive(C);
      emit(C, [{ body: { type: 'equip', slot, itemId: x.itemId } }]);
    },
    unequip(C, { slot }) {
      const uid = C.snapshot.equipment[slot];
      rule(uid != null, '沒有裝備');
      delete C.snapshot.equipment[slot];
      rederive(C);
      emit(C, [{ body: { type: 'unequip', slot, itemId: stack(C, uid)?.itemId } }]);
    },
    useItem(C, { uid }) { rule(stack(C, uid), '物品不足'); useItem(C, stack(C, uid)); },
    sell(C, { uid, qty = 1 }) {
      rule(inTown(C), '需要在城鎮');
      rule(!isEquipped(C, uid), '裝備中無法販賣');
      const x = takeItem(C, uid, qty), zeny = (data.items[x.itemId]?.sell ?? 0) * qty;
      C.snapshot.character.zeny += zeny;
      emit(C, [{ body: { type: 'shopSell', itemId: x.itemId, qty, zeny } }]);
    },
    buy(C, { itemId, qty = 1 }) {
      rule(inTown(C) && Number.isInteger(qty) && qty > 0, '需要在城鎮');
      const offer = data.shops.filter((s) => s.town === C.snapshot.mapId).flatMap((s) => s.items).find((x) => x.itemId === itemId);
      rule(offer, '商店沒有販賣');
      const zeny = offer.price * qty;
      rule(C.snapshot.character.zeny >= zeny, 'Zeny 不足');
      C.snapshot.character.zeny -= zeny;
      addItem(C, itemId, qty);
      emit(C, [{ body: { type: 'shopBuy', itemId, qty, zeny } }]);
    },
    storageDeposit(C, { items }) {
      const st = storageOf(C), moved = [];
      payFee(C);
      for (const { uid, qty } of items ?? []) {
        rule(!isEquipped(C, uid), '裝備中無法存放');
        const x = takeItem(C, uid, qty);
        const same = st.items.find((y) => y.itemId === x.itemId && !x.cards?.length);
        if (same && data.items[x.itemId]?.category !== 'equipment') same.qty += qty;
        else st.items.push({ qty, sid: st.items.reduce((m, y) => Math.max(m, y.sid), 0) + 1, itemId: x.itemId });
        moved.push({ itemId: x.itemId, qty });
      }
      st.revision++;
      emit(C, [{ body: { type: 'storage', action: 'deposit', items: moved, fee: STORAGE_FEE } }]);
    },
    storageWithdraw(C, { items }) {
      const st = storageOf(C), moved = [];
      payFee(C);
      for (const { sid, qty } of items ?? []) {
        const y = st.items.find((z) => z.sid === sid);
        rule(y && qty > 0 && y.qty >= qty, '倉庫物品不足');
        y.qty -= qty;
        if (!y.qty) st.items.splice(st.items.indexOf(y), 1);
        addItem(C, y.itemId, qty);
        moved.push({ itemId: y.itemId, qty });
      }
      st.revision++;
      emit(C, [{ body: { type: 'storage', action: 'withdraw', items: moved, fee: STORAGE_FEE } }]);
    },
    storageZeny(C, { action, amount }) {
      const st = storageOf(C), c = C.snapshot.character;
      rule(Number.isInteger(amount) && amount > 0 && ['deposit', 'withdraw'].includes(action), '金額錯誤');
      if (action === 'deposit') { rule(c.zeny >= amount, 'Zeny 不足'); c.zeny -= amount; st.zeny += amount; }
      else { rule(st.zeny >= amount, '倉庫 Zeny 不足'); st.zeny -= amount; c.zeny += amount; }
      st.revision++;
      emit(C, [{ body: { type: 'storage', action, items: [], fee: 0, zeny: amount } }]);
    },
  };
  const payFee = (C) => {
    rule(C.snapshot.character.zeny >= STORAGE_FEE, `Zeny 不足（倉庫費 ${STORAGE_FEE} Zeny）`);
    C.snapshot.character.zeny -= STORAGE_FEE;
  };
  const storageOf = (C) => g.storageFor(C.account);
  g.storageFor = (account) => {
    if (!g.storage.has(account)) g.storage.set(account, { items: [], zeny: 0, capacity: 600, revision: 0, fees: { prontera: STORAGE_FEE }, heldItems: [] });
    return g.storage.get(account);
  };

  /** Runs one command. Returns { status, body } in the captured reply shapes. */
  g.command = (id, { commandId, command } = {}) => {
    const C = g.chars.get(id);
    if (commandId && C.commands.has(commandId)) return C.commands.get(commandId);
    C.driven = true;
    let res;
    const isStorage = /^storage/.test(command?.type);
    if (!Object.hasOwn(commands, command?.type)) {
      res = { status: 422, body: { error: { code: 'GAME_RULE', message: `不支援的指令 ${command?.type}` }, view: g.view(C) } };
    } else {
      advance(C); // settle due fight events first so a rule rollback cannot undo granted rewards
      const backup = structuredClone({ snapshot: C.snapshot, storage: g.storage.get(C.account) ?? null });
      try {
        commands[command.type](C, command);
        C.commandRevision++;
        touch(C);
        res = { status: 200, body: { ok: true, view: g.view(C) } };
      } catch (err) {
        if (!(err instanceof RuleError)) throw err;
        C.snapshot = backup.snapshot; // all-or-nothing: a rule failure leaves no partial change
        if (backup.storage) g.storage.set(C.account, backup.storage);
        res = { status: 422, body: { error: { code: 'GAME_RULE', message: err.message }, view: g.view(C) } };
      }
    }
    if (isStorage) res.body.storage = storageOf(C);
    if (commandId) { C.commands.set(commandId, res); if (C.commands.size > 100) C.commands.delete(C.commands.keys().next().value); }
    return res;
  };

  // ---------- reads ----------
  g.events = (C, after, limit = 1000) => {
    const retainedFrom = C.log[0]?.seq ?? C.lastSeq + 1;
    return { events: C.log.filter((x) => x.seq > after).slice(0, limit), gap: after + 1 < retainedFrom && after < C.lastSeq, retainedFrom };
  };
  g.summary = (C, after) => {
    const { events, gap } = g.events(C, after, Infinity);
    const sm = { events: events.length, fromSeq: events[0]?.seq ?? after + 1, toSeq: events.at(-1)?.seq ?? after,
      fromWallMs: events[0]?.wallMs ?? now(), toWallMs: events.at(-1)?.wallMs ?? now(), gap, truncated: false,
      estimatedMs: 0, estimatedZeny: 0, kills: 0, killsByMonster: {}, baseExp: 0, jobExp: 0, baseLevelUps: 0, jobLevelUps: 0, // ponytail: offline rate checkout is #18
      deaths: 0, deathLog: [], stopped: null, looted: {}, autoSold: {}, autoSellZeny: 0, used: {}, autoBuyZeny: 0, unpicked: 0,
      noPotion: 0, rareDrops: [], noIncome: [], noIncomeKills: 0 };
    const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
    for (const { body: b, simTime } of events) {
      if (b.type === 'kill') { sm.kills++; inc(sm.killsByMonster, b.monsterId); }
      else if (b.type === 'exp') { sm.baseExp += b.base; sm.jobExp += b.job; }
      else if (b.type === 'baseLevelUp') sm.baseLevelUps++;
      else if (b.type === 'jobLevelUp') sm.jobLevelUps++;
      else if (b.type === 'death') { sm.deaths++; sm.deathLog.push({ t: simTime, monsterId: b.monsterId }); }
      else if (b.type === 'pickup') inc(sm.looted, b.itemId, b.qty);
      else if (b.type === 'useItem') inc(sm.used, b.itemId);
      else if (b.type === 'drop' && b.rare && !b.by) sm.rareDrops.push({ t: simTime, itemId: b.itemId, monsterId: b.monsterId });
      else if (b.type === 'stop') sm.stopped = b.reason;
    }
    return { summary: sm };
  };
  g.partyView = (C) => {
    const p = C.partyId != null ? g.parties.get(C.partyId) : null;
    const member = (M) => {
      const s = M.snapshot, d = s.derived, eq = s.equipment, top = stack(M, eq.headTop)?.itemId;
      return { id: M.id, name: M.name, mapId: s.mapId, running: M.running, baseLv: s.character.baseLv, job: s.character.job,
        look: { appearance: s.appearance, headgear: top ? { top } : {}, gear: {} },
        vitals: { hp: fl(s.character.hp * 100 / d.maxHp), sp: fl(s.character.sp * 100 / d.maxSp) },
        buffs: s.buffs.map((b) => ({ id: b.id, lv: b.lv })) };
    };
    const own = g.charsOf(C.account).filter((x) => x !== C).map((M) => ({ id: M.id, name: M.name, partyId: M.partyId, running: M.running,
      vending: false, mapId: M.snapshot.mapId, baseLv: M.snapshot.character.baseLv, job: M.snapshot.character.job, invites: [] }));
    return { party: p ? { ...p, members: party(C).map(member) } : null, invites: [], own };
  };
  g.population = () => {
    const maps = Object.fromEntries(Object.keys(data.maps).map((id) => [id, [0, 0]]));
    for (const C of g.chars.values()) { const m = maps[C.snapshot.mapId]; if (m) m[0]++; }
    return { at: now(), maps };
  };
  g.streamHello = (C) => streamSnapshot(C);

  // ---------- clock ----------
  /** Advances every live fight and regen; driven by a timer in index.js (or by hand in tests). */
  g.tick = () => {
    const t = now();
    for (const C of g.chars.values()) {
      if (C.fight && !C.fight.settled) advance(C);
      const step = C.snapshot.restSit ? SIT_REGEN_MS : REGEN_MS;
      if (C.fight && !C.fight.s.over) { C.regenAt = t; continue; } // ponytail: no regen while engaged
      if (t - C.regenAt < step) continue;
      const n = fl((t - C.regenAt) / step), c = C.snapshot.character, d = C.snapshot.derived;
      C.regenAt += n * step;
      if (c.hp >= d.maxHp && c.sp >= d.maxSp) continue;
      c.hp = Math.min(d.maxHp, c.hp + n * d.hpRegen); c.sp = Math.min(d.maxSp, c.sp + n * d.spRegen);
      touch(C);
    }
  };

  // ---------- persistence ----------
  g.dump = () => ({
    accounts: [...g.accounts.values()], parties: [...g.parties.values()], storage: [...g.storage], killEvent: g.killEvent, nextUid: g.nextUid,
    chars: [...g.chars.values()].map(({ fight, commands: _, ...C }) => ({ ...C, snapshot: { ...C.snapshot, time: now() - C.simEpoch } })),
  });
  g.restore = (d) => {
    for (const a of d.accounts ?? []) g.accounts.set(a.name, a);
    for (const p of d.parties ?? []) g.parties.set(p.id, p);
    for (const [k, v] of d.storage ?? []) g.storage.set(k, v);
    if (d.killEvent) g.killEvent = d.killEvent;
    g.nextUid = d.nextUid ?? 1;
    for (const C of d.chars ?? []) g.chars.set(C.id, { ...C, commands: new Map(), fight: null, simEpoch: now() - C.snapshot.time, regenAt: now() });
  };
  return g;
}
