// Offline checkout (#18). A character with no driving client gets no simulation; when it is next read (GET view,
// stream, summary, command, driver connect) it gets a rate-based delta for the away time instead:
// rates (kills/h per monster, EXP/h, zeny/h, loot/h, potions/h, deaths/h) from its recent driven history on that map,
// or from quick engine fights when there is none. Caps follow /info/mechanics 「離線會怎麼結算？」 and the 7-day rule:
// - a driver with no action for 20 min counts as offline (the 20-min no-input pause);
// - the party keeps advancing (no away time) while any member is live;
// - 7 days after the account was last online the character stops (only natural regen after that).
// Cost per checkout is O(monsters + item kinds in the rate table), independent of the away time.
import * as e from './rules/engine.js';

export const IDLE_MS = 20 * 60e3, WEEK_MS = 7 * 24 * 3600e3;
const ACTIVE_GAP_MS = 60e3; // longer pauses between brain actions do not count as farming time
const MIN_HISTORY_MS = 10 * 60e3, MIN_HISTORY_KILLS = 3;
const DECAY_MS = 6 * 3600e3; // ponytail: history halves past 6 h of farming ("recent"); a sliding window if it matters
const SAMPLE_MS = 30 * 60e3, SAMPLE_FIGHTS = 300;
// Engine fights carry no session overhead (looting, sitting, buffs, town trips): the captured party killed 541/h
// against 1,565/h simulated solo (formulas.md "Kill / EXP per hour"), so sampled time is stretched by that ratio.
const SESSION_STRETCH = 1565 / 541;
const OVERWEIGHT = 0.9; // loot stops at 90% weight (mechanics page); the rest is `unpicked`
const REGEN_MS = 6000;
const KEEP_CHECKOUTS = 20;

const blank = () => ({ ms: 0, kills: {}, baseExp: 0, jobExp: 0, zeny: 0, loot: {}, used: {}, deaths: 0 });
const ZENY = { autoSell: 1, shopSell: 1, autoBuy: -1 };
const add = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

/** Installs the offline checkout on a game from createGame(); returns the same game. */
export function attachOffline(g) {
  const { now, rng, data } = g;
  const drivers = new Set(); // charIds with a connected driver (not persisted: nobody drives after a restart)
  const samples = new Map(); // `${id}:${mapId}:${baseLv}` → sampled rates
  g.drivers = drivers;

  const state = (C) => (C.off ??= { settledAtMs: now(), lastActAt: null, offAt: null, rates: {}, checkouts: [] });
  const account = (C) => g.accounts.get(C.account) ?? {};
  const liveUntil = (M) => {
    const o = state(M);
    if (o.lastActAt == null) return -Infinity;
    return Math.min(o.lastActAt + IDLE_MS, drivers.has(M.id) ? now() : o.offAt ?? -Infinity);
  };
  const isLive = (M) => liveUntil(M) >= now();
  // ponytail: party() scans every character; index members by party id if the world grows past a few hundred
  const partyLive = (C) => g.party(C).some(isLive);
  const awayFrom = (C) => Math.max(state(C).settledAtMs, ...g.party(C).map(liveUntil));
  const addCharacter = g.addCharacter, restore = g.restore;
  g.addCharacter = (...a) => { const C = addCharacter(...a); state(C); return C; };
  g.restore = (d) => { restore(d); for (const C of g.chars.values()) state(C); }; // pre-#18 dumps count as settled now
  g.backlogMs = (C) => (partyLive(C) ? 0 : Math.max(0, now() - awayFrom(C)));

  const view = g.view;
  g.view = (C) => {
    const backlogMs = g.backlogMs(C);
    if (!backlogMs) state(C).settledAtMs = now();
    return { ...view(C), backlogMs, settledAtMs: now() - backlogMs, clockFrozen: backlogMs > 0 };
  };

  // ---------- history ----------
  const rateOf = (C) => (state(C).rates[C.snapshot.mapId] ??= blank());
  g.recordActive = (C, ms) => {
    const r = rateOf(C);
    r.ms += ms;
    if (r.ms > DECAY_MS) halve(r);
  };
  g.onEmit = (C, out) => {
    if (!isLive(C)) return; // checkout's own events and party shares to an offline member are not history
    const r = rateOf(C);
    for (const { body: b } of out) {
      if (b.type === 'kill') add(r.kills, b.monsterId);
      else if (b.type === 'exp') { r.baseExp += b.base; r.jobExp += b.job; }
      else if (b.type === 'pickup') add(r.loot, b.itemId, b.qty);
      else if (b.type === 'useItem') add(r.used, b.itemId);
      else if (b.type === 'death') r.deaths++;
      if (ZENY[b.type]) r.zeny += ZENY[b.type] * b.zeny;
    }
  };

  /** Rates from quick engine fights on the current map (HP/SP reset per fight, expected drops). Cached per level. */
  function sample(C) {
    const map = data.maps[C.snapshot.mapId];
    if (!map?.spawns?.length) return null;
    const key = `${C.id}:${map.id}:${C.snapshot.character.baseLv}`;
    if (samples.has(key)) return samples.get(key);
    const base = g.combatOf(C), r = blank();
    const char = { ...base, hp: base.maxHp, sp: base.maxSp };
    for (let n = 0; r.ms < SAMPLE_MS && n < SAMPLE_FIGHTS; n++) {
      const enc = e.encounter({ map, monsters: data.monsters, char, uid: n, rng, skills: data.skills });
      const f = e.simulateFight({ char: { ...char }, mob: enc.mob, rng, skills: data.skills });
      r.ms += enc.searchMs + f.durationMs;
      if (f.outcome === 'death') { r.deaths++; continue; }
      if (f.outcome !== 'kill') continue;
      add(r.kills, enc.mob.id); r.baseExp += enc.mob.baseExp; r.jobExp += enc.mob.jobExp;
      for (const d of [...enc.mob.drops, ...(enc.mob.card ? [enc.mob.card] : [])]) add(r.loot, d.itemId, Math.min(1, d.rate / 10000));
    }
    r.ms *= SESSION_STRETCH;
    samples.set(key, r);
    return r;
  }
  const ratesFor = (C) => {
    const r = state(C).rates[C.snapshot.mapId];
    const kills = r ? Object.values(r.kills).reduce((a, b) => a + b, 0) : 0;
    return r && r.ms >= MIN_HISTORY_MS && kills >= MIN_HISTORY_KILLS ? { ...r, source: 'history' } : sample(C) && { ...sample(C), source: 'engine' };
  };

  // ---------- checkout ----------
  const count = (x) => { const n = Math.floor(x); return n + (rng() < x - n ? 1 : 0); };
  /** Settles the away time; returns the settlement record (also kept for /summary), or null when nothing was due. */
  g.checkout = (C) => {
    const t = now(), o = state(C);
    if (partyLive(C)) { o.settledAtMs = t; return null; }
    const from = awayFrom(C);
    if (t <= from) { o.settledAtMs = t; return null; }
    const limit = (account(C).lastOnlineMs ?? from) + WEEK_MS;
    const end = Math.min(t, Math.max(from, limit));
    const s = C.snapshot, c = s.character;
    const rec = { ms: 0, zeny: 0, kills: 0, killsByMonster: {}, baseExp: 0, jobExp: 0, looted: {}, used: {}, unpicked: 0, noPotion: 0,
      deaths: 0, stopped: null, source: null };
    const events = [];
    if (C.running && end > from) {
      const R = ratesFor(C);
      if (R?.ms) {
        rec.source = R.source;
        const away = end - from, per = (x) => x / R.ms;
        let run = away, why = null;
        for (const [id, n] of Object.entries(R.used)) {
          const stock = s.inventory.filter((x) => x.itemId === +id).reduce((q, x) => q + x.qty, 0);
          const tOut = stock / per(n);
          if (tOut < run) { run = tOut; why = 'supply'; }
        }
        const tDeath = R.deaths ? -Math.log(1 - rng()) / per(R.deaths) : Infinity;
        if (tDeath < run) { run = tDeath; why = 'death'; }
        rec.ms = Math.round(run);
        for (const [id, n] of Object.entries(R.kills)) {
          const k = count(per(n) * run);
          if (k) { rec.killsByMonster[id] = k; rec.kills += k; if (s.stats?.kills) add(s.stats.kills, id, k); }
        }
        rec.baseExp = count(per(R.baseExp) * run); rec.jobExp = count(per(R.jobExp) * run);
        rec.zeny = Math.max(-c.zeny, count(per(R.zeny) * run));
        c.zeny += rec.zeny;
        for (const [id, n] of Object.entries(R.used)) {
          let q = Math.min(count(per(n) * run), s.inventory.filter((x) => x.itemId === +id).reduce((a, x) => a + x.qty, 0));
          if (q) rec.used[id] = q;
          for (const x of s.inventory.filter((y) => y.itemId === +id)) { const take = Math.min(q, x.qty); if (take) g.takeItem(C, x.uid, take); q -= take; }
        }
        const cap = s.derived.weightMax * OVERWEIGHT;
        for (const [id, n] of Object.entries(R.loot)) {
          const q = count(per(n) * run), w = data.items[id]?.weight ?? 0;
          const fit = w ? Math.max(0, Math.min(q, Math.floor((cap - s.weight) / w))) : q;
          if (fit) { g.addItem(C, +id, fit); rec.looted[id] = fit; }
          rec.unpicked += q - fit;
        }
        const r = g.progress(C, { id: 0, baseExp: rec.baseExp, jobExp: rec.jobExp, drops: [], card: null });
        events.push(...r.events.filter((x) => x.body.type !== 'exp'));
        if (why === 'death') {
          const mobId = Object.keys(R.kills)[0] ?? null;
          rec.deaths = 1;
          c.baseExp = e.applyDeath({ ...c }, g.job(C)).baseExp;
          c.hp = Math.floor(s.derived.maxHp / 2); c.sp = Math.floor(s.derived.maxSp / 2);
          const fromMap = s.mapId;
          s.mapId = s.saveMap;
          if (s.stats) s.stats.deaths = (s.stats.deaths ?? 0) + 1;
          events.push({ body: { type: 'death', monsterId: mobId && +mobId } }, { body: { type: 'mapChange', from: fromMap, to: s.mapId, cause: 'return' } });
        }
        if (why === 'supply') { rec.noPotion = 1; rec.stopped = 'CRITICAL_SUPPLY'; }
      }
    }
    if (!rec.stopped && end < t && C.running) rec.stopped = 'OFFLINE_7D'; // ponytail: code guessed; the log text is 「7 天沒上線自動停止」
    if (rec.stopped) { C.running = false; C.fight = null; s.activity = 'stopped'; events.push({ body: { type: 'stop', reason: rec.stopped } }); }
    const ticks = Math.floor((t - from - rec.ms) / REGEN_MS); // natural regen while not farming
    c.hp = Math.min(s.derived.maxHp, c.hp + ticks * s.derived.hpRegen); c.sp = Math.min(s.derived.maxSp, c.sp + ticks * s.derived.spRegen);
    o.settledAtMs = t;
    if (!rec.ms && !rec.stopped) { g.touch(C); return null; }
    const hours = (rec.ms / 3600e3).toFixed(1);
    const [head] = g.emit(C, [{ t: from, body: { type: 'system', level: 'info', message: `離線結算 ${hours} 小時` } },
      ...events.map((x) => ({ t, body: x.body }))]);
    rec.seq = head.seq; rec.fromWallMs = from; rec.toWallMs = t;
    o.checkouts.push(rec);
    if (o.checkouts.length > KEEP_CHECKOUTS) o.checkouts.shift();
    g.touch(C);
    return rec;
  };

  // ---------- activity ----------
  /** Account was online (opened the game, watching, input): resets the 7-day clock after settling anything past it. */
  g.online = (name) => {
    const a = g.accounts.get(name);
    if (!a) return;
    if (a.lastOnlineMs != null && now() - a.lastOnlineMs > WEEK_MS) for (const C of g.charsOf(name)) g.checkout(C);
    a.lastOnlineMs = now();
  };
  g.idleViewer = (name) => now() - (g.accounts.get(name)?.lastOnlineMs ?? now()) > IDLE_MS;
  const goLive = (C) => {
    if (!isLive(C)) for (const M of g.party(C)) g.checkout(M); // settle the party up to the moment it starts advancing again
    state(C).lastActAt = now();
    g.online(C.account);
  };
  g.driverOn = (id) => { const C = g.chars.get(id); goLive(C); drivers.add(id); };
  g.driverOff = (id) => { drivers.delete(id); const C = g.chars.get(id); if (C) state(C).offAt = now(); };
  const act = g.act;
  g.act = (id, a) => {
    const C = g.chars.get(id), o = state(C), dt = now() - (o.lastActAt ?? -Infinity);
    goLive(C);
    if (dt < ACTIVE_GAP_MS) g.recordActive(C, dt);
    return act(id, a);
  };
  const command = g.command;
  g.command = (id, body) => { const C = g.chars.get(id); g.online(C.account); g.checkout(C); return command(id, body); };

  // ---------- reads ----------
  const events = g.events;
  g.events = (C, after, limit) => {
    const r = events(C, after, limit);
    return { ...r, gap: r.gap || state(C).checkouts.some((k) => k.seq > after) };
  };
  const summary = g.summary;
  g.summary = (C, after) => {
    const out = summary(C, after), sm = out.summary;
    for (const k of state(C).checkouts) {
      if (k.seq <= after) continue;
      sm.estimatedMs += k.ms; sm.estimatedZeny += k.zeny; sm.kills += k.kills; sm.baseExp += k.baseExp; sm.jobExp += k.jobExp;
      sm.unpicked += k.unpicked; sm.noPotion += k.noPotion;
      for (const [id, n] of Object.entries(k.killsByMonster)) add(sm.killsByMonster, id, n);
      for (const [id, n] of Object.entries(k.looted)) add(sm.looted, id, n);
      for (const [id, n] of Object.entries(k.used)) add(sm.used, id, n);
    }
    return out;
  };
  return g;
}

function halve(r) {
  for (const k of ['ms', 'baseExp', 'jobExp', 'zeny', 'deaths']) r[k] /= 2;
  for (const k of ['kills', 'loot', 'used']) for (const id in r[k]) r[k][id] /= 2;
}
