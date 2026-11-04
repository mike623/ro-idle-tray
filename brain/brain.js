// OpenKore-style idle brain (#19). Pure ES module: no DOM, no timers, no I/O; runs in a webview or Node.
//   const b = createBrain();  observe(b, serverMessage, nowMs);  tick(b, nowMs) → actions[] (at most one in flight)
// Server messages are the WebSocket ones (docs/offline-backend/server.md): snapshot, events, result. Command results
// ({type:'result', ok, error, view}) come from the client's REST call. Actions: WS brain actions ({type:'search'} …)
// or {type:'command', command} for REST commands. Pacing is by the wall time passed in, never by timers.
// Loop: recover → loot → fight (skip / buffs / skills / attack) → sit → stats → town supply → lockMap → search.

const FLY_WING = 601;
const STALE_MS = 10000; // an action with no result for this long is dropped (lost on reconnect)
const BUFF_GUARD_MS = 10000; // after a buff lands, wait for the snapshot to show it
const SUPPLY_EVERY_MS = 600000; // at most one town trip per 10 min, so an unfixable shortage cannot loop
const pct = (a, b) => (b ? (100 * a) / b : 100);

export function createBrain({ monsters = null } = {}) {
  return { monsters, snap: null, running: false, fight: null, loot: [], inflight: null, inflightAt: 0, waitUntil: 0,
    until: {}, sitting: false, died: false, town: null, supplyAfter: 0 };
}

/** Conditions of a skill rule (`cond`); x = {hp, sp (percent), buffs:Set, aggro, allies:[{buffs:[]}]}. Unknown keys pass. */
export function condOk(c, x) {
  if (!c) return true;
  if (c.or && !c.or.some((o) => condOk(o, x))) return false;
  if (c.hpAbove != null && !(x.hp > c.hpAbove)) return false;
  if (c.hpBelow != null && !(x.hp < c.hpBelow)) return false;
  if (c.spAbove != null && !(x.sp > c.spAbove)) return false;
  if (c.spBelow != null && !(x.sp < c.spBelow)) return false;
  if (c.selfLacks?.some((id) => x.buffs.has(id))) return false;
  if (c.allyLacks && !(x.allies ?? []).some((a) => c.allyLacks.some((id) => !a.buffs?.includes(id)))) return false;
  if (c.targetAggro != null && c.targetAggro !== !!x.aggro) return false;
  return true;
}

export function observe(b, m, now) {
  if (m.type === 'snapshot') setSnap(b, m.snapshot, m.running);
  else if (m.type === 'events') for (const e of m.events) onEvent(b, e.body, e.wallMs ?? now);
  else if (m.type === 'result') onResult(b, m, now);
  return b;
}

function setSnap(b, s, running) {
  b.snap = s;
  b.running = !!running;
  if (!s.engaged) { if (b.fight?.found || b.fight?.resumed) b.fight = null; }
  else if (!b.fight && s.target?.uid) b.fight = fight(s.target.uid, { found: true, committed: true, resumed: true });
}
const fight = (uid, o = {}) => ({ uid, monsterId: null, found: false, readyAt: 0, aggro: false, committed: false, casts: new Set(), ...o });

function onEvent(b, e, at) {
  const F = b.fight;
  switch (e.type) {
    case 'found': if (F?.uid === e.uid) Object.assign(F, { monsterId: e.monsterId, found: true, readyAt: at + (e.approachMs ?? 0) }); break;
    case 'monsterAttack': case 'mobSkill': if (F?.uid === e.uid) F.aggro = true; break;
    case 'kill': if (F?.uid === e.uid) b.fight = null; break;
    case 'drop': if (b.snap?.config?.autoLoot !== false) b.loot.push(e.itemId); break;
    case 'pickup': drop1(b.loot, e.itemId); break;
    case 'targetSkip': b.fight = null; break;
    case 'teleport': b.fight = null; b.loot = []; break;
    case 'mapChange': b.fight = null; b.loot = []; if (e.cause === 'return') b.died = true; break;
  }
}
const drop1 = (list, x) => { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); };

function onResult(b, m, now) {
  const a = b.inflight;
  b.inflight = null;
  if (!a) return;
  if (m.view) setSnap(b, m.view.snapshot, m.view.running);
  const F = b.fight, interval = b.snap?.derived?.attackIntervalMs ?? 1000;
  if (m.ok) {
    if (a.type === 'search') { b.fight = fight(m.uid); b.sitting = false; }
    if (a.type === 'attack') b.waitUntil = now + interval;
    if (a.type === 'cast') {
      b.waitUntil = now + interval;
      if (a.rule?.repeat === 'once') F?.casts.add(a.skill);
      if (a.rule?.use === 'buff') b.until[a.skill] = now + BUFF_GUARD_MS;
    }
    if (a.type === 'sit') b.sitting = true;
    if (a.type === 'command' && a.command.type === 'stop') b.died = false;
    return;
  }
  switch (m.error) {
    case 'TOO_EARLY': b.waitUntil = m.retryAt ?? now + 250; break;
    case 'NO_TARGET': b.fight = null; break;
    case 'ENGAGED': if (F) F.committed = true; break;
    case 'NO_LOOT': drop1(b.loot, a.itemId); break;
    case 'NO_SP': case 'COOLDOWN': case 'NOT_LEARNED': b.until[a.skill] = now + (m.error === 'NOT_LEARNED' ? 3600000 : 5000); break;
    case 'CASTING': b.waitUntil = now + 250; break;
    case 'NO_ITEM': case 'NO_TELEPORT': b.until[a.key ?? a.type] = now + 30000; break;
    default:
      if (a.type === 'command') { if (!a.queued) b.until[`cmd:${a.command.type}`] = now + 60000; } // queued town steps just move on
      else b.waitUntil = now + 1000;
  }
}

export function tick(b, now) {
  if (b.inflight && now - b.inflightAt < STALE_MS) return [];
  b.inflight = null;
  if (!b.snap || !b.running || now < b.waitUntil) return [];
  const a = decide(b, now);
  if (!a) return [];
  b.inflight = a;
  b.inflightAt = now;
  const { rule, key, queued, ...wire } = a; // brain-only bookkeeping stays here
  return [wire];
}

function decide(b, now) {
  const s = b.snap, c = s.character, d = s.derived, cfg = s.config ?? {};
  if (c.hp <= 0) return null;
  const free = (k) => !(b.until[k] > now);
  const cmd = (command, o) => (free(`cmd:${command.type}`) ? { type: 'command', command, ...o } : null);
  const inv = s.inventory ?? [];
  const equipped = new Set(Object.values(s.equipment ?? {}));
  const count = (id) => inv.reduce((n, x) => n + (x.itemId === id ? x.qty : 0), 0);
  const x = { hp: pct(c.hp, d.maxHp), sp: pct(c.sp, d.maxSp), buffs: new Set((s.buffs ?? []).map((y) => y.id)), aggro: b.fight?.aggro };
  const F = b.fight?.found ? b.fight : null;

  if (cfg.stopAtLv?.base > 0 && c.baseLv >= cfg.stopAtLv.base) return cmd({ type: 'stop' });
  if (b.died && cfg.autoResumeAfterDeath === false) return cmd({ type: 'stop' });

  // escape
  const low = cfg.escape?.lowHp;
  if (F && low?.action === 'fly' && x.hp < low.belowPercent && free('teleport') && (count(FLY_WING) || c.skills?.AL_TELEPORT))
    return { type: 'teleport' };

  // recovery: potions anywhere, heal skills need a live target (server casts only inside an encounter)
  const potion = (p, v) => {
    if (!p?.enabled || !(v < p.belowPercent)) return null;
    const st = p.items.map((id) => inv.find((y) => y.itemId === id)).find((y) => y && free(`item:${y.itemId}`));
    return st ? { type: 'useItem', uid: st.uid, key: `item:${st.itemId}` } : null;
  };
  const skillRule = (r) => r.enabled !== false && (c.skills?.[r.skill] ?? 0) >= 1 && free(r.skill) && condOk(r.cond, x);
  const heal = F && (cfg.skills ?? []).find((r) => r.use === 'heal' && x.hp < r.percent && skillRule(r));
  const healCast = heal && { type: 'cast', uid: F.uid, skill: heal.skill, lv: heal.lv, rule: heal };
  const pots = potion(cfg.hpPotion, x.hp) ?? potion(cfg.spPotion, x.sp);
  const rec = cfg.recovery?.order === 'skillFirst' ? healCast || pots : pots ?? healCast;
  if (rec) return rec;

  if (!b.fight && b.loot.length) return { type: 'pickup', itemId: b.loot[0] };

  if (b.fight) {
    if (!F) return null; // searching: the found event says what we met
    if (!F.committed) {
      const reason = skipReason(b, cfg, F);
      if (reason) return { type: 'skip', uid: F.uid, reason };
    }
    const skills = cfg.skills ?? [];
    const buff = skills.find((r) => r.use === 'buff' && r.target !== 'allies' && skillRule(r) && x.sp >= (r.percent ?? 0)
      && !((s.buffs ?? []).find((y) => y.id === r.skill)?.remainingMs > 1000 * (r.cond?.refreshBeforeSec ?? 0)));
    const atk = skills.find((r) => r.use === 'attack' && skillRule(r) && x.sp >= (r.percent ?? 0)
      && !(r.repeat === 'once' && F.casts.has(r.skill)));
    const r = buff ?? atk;
    if (r) return { type: 'cast', uid: F.uid, skill: r.skill, lv: r.lv, rule: r };
    if (now < F.readyAt) { b.waitUntil = F.readyAt; return null; }
    if (cfg.combat?.skillOnly) { b.waitUntil = now + 250; return null; }
    return { type: 'attack', uid: F.uid };
  }

  // out of a fight
  const sit = cfg.sit;
  if (s.restSit || b.sitting) {
    const done = x.hp >= (sit?.hpUntil ?? 100) && (!(sit?.spUntil > 0) || x.sp >= sit.spUntil);
    if (!done) { b.waitUntil = now + 1000; return null; }
  } else if (sit?.enabled && (x.hp < sit.hpBelow || (sit.spBelow > 0 && x.sp < sit.spBelow))) return { type: 'sit' };

  const auto = cfg.statsAddAuto;
  if (auto?.enabled && c.statPoints > 0) {
    const e = auto.list.find((y) => (c.stats[y.stat] ?? 0) < y.target);
    if (e && Math.floor((c.stats[e.stat] - 1) / 10) + 2 <= c.statPoints) {
      const a = cmd({ type: 'allocateStats', stats: { [e.stat]: 1 } });
      if (a) return a;
    }
  }

  // return-to-town supply: sell, store, buy, then lockMap below takes the character back
  const store = cfg.autoStorage;
  const short = (cfg.townBuy ?? []).some((t) => count(t.itemId) < t.below);
  const heavy = s.weightPercent >= 90 || (store?.enabled && s.weightPercent >= store.abovePercent);
  if (!b.town && now >= b.supplyAfter && (short || heavy) && s.saveMap) b.town = { queue: null };
  if (b.town) {
    if (s.mapId !== s.saveMap) return cmd({ type: 'selectMap', mapId: s.saveMap }) ?? (b.town = null);
    if (!b.town.queue) b.town.queue = townQueue(cfg, s, inv, equipped, count);
    const next = b.town.queue.shift();
    if (next) return { type: 'command', command: next, queued: true };
    b.town = null;
    b.supplyAfter = now + SUPPLY_EVERY_MS;
  }

  if (cfg.lockMap && s.mapId !== cfg.lockMap) { const a = cmd({ type: 'selectMap', mapId: cfg.lockMap }); if (a) { b.died = false; return a; } }
  return { type: 'search' };
}

function skipReason(b, cfg, F) {
  const id = F.monsterId, t = cfg.targets ?? {};
  const rule = (cfg.monsterRules ?? []).find((r) => r.monsterId === id);
  if (rule) return rule.action === 'defend' && !F.aggro ? 'defend' : null; // attack / priority / lure: fight it
  if (t.blacklist?.includes(id)) return 'blacklist';
  if (t.whitelist?.length && !t.whitelist.includes(id)) return 'whitelist';
  if (cfg.escape?.dangerMonsters?.includes(id)) return 'danger';
  const m = b.monsters?.[id];
  if (m && ((t.minLv > 0 && m.lv < t.minLv) || (t.maxLv > 0 && m.lv > t.maxLv))) return 'level';
  if (m && ((cfg.escape?.avoidMvp && m.mvp) || (t.avoidAggressive && m.behavior === 'aggressive'))) return 'avoid';
  return null;
}

function townQueue(cfg, s, inv, equipped, count) {
  const held = s.autoSellHeld ?? {};
  const q = [];
  for (const y of inv) if (cfg.autoSell?.includes(y.itemId) && !equipped.has(y.uid) && !held[y.uid]) q.push({ type: 'sell', uid: y.uid, qty: y.qty });
  const st = cfg.autoStorage;
  if (st?.enabled && st.onReturn !== false) {
    const items = [];
    for (const y of inv) {
      if (!st.items.includes(y.itemId) || equipped.has(y.uid)) continue;
      const qty = y.qty - (st.keep?.[y.itemId] ?? 0);
      if (qty > 0) items.push({ uid: y.uid, qty });
    }
    if (items.length) q.push({ type: 'storageDeposit', items });
  }
  for (const t of cfg.townBuy ?? []) if (count(t.itemId) < t.below) q.push({ type: 'buy', itemId: t.itemId, qty: t.qty - count(t.itemId) });
  return q;
}
