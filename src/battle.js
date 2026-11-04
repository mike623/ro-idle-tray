// Battle view: a side-view replay of the party's live battle log (issue #21), drawn with the
// original RO client art. Assets load through roasset:// (src-tauri/src/battle.rs): fetched
// from public mirrors on first use and cached on disk, never bundled.
//
// Layout: party in 2 rows of 4 on the left facing right, monsters in 2x2 slots on the right.
// The game has no coordinates, so positions are staged: the party marches (ground scrolls)
// whenever nothing is alive, monsters scroll in with the ground and stop in a slot.

const invoke = (c, a) => window.__TAURI__.core.invoke(c, a);
const listen = (e, f) => window.__TAURI__.event.listen(e, f);
const asset = (host, path) => `${window.ROASSET_BASE ?? 'roasset://localhost/'}${host}${path}`;   // override: browser test harness
const RA = asset('assets.latam-tools.com.br', ''), RI = asset('ro-idle.app', ''), RS = asset('ro-survivors.com', '/assets');
const UI = asset('cdn.jsdelivr.net', '/gh/GodLesZ/rangarok-js@9da23a5d2e55b7bb5bd59e6296e78dba19a913d1/basic_interface');
const W = 980, H = 640, BASE = 430, FACE_R = 6, FACE_L = 2;      // RO directions: 6 = east, 2 = west
const MARCH_PX_MS = 0.11, LAG = 3500, KEEP = 5 * 60 * 1000;   // game state arrives in ~3 s batches
// ragassets job ids by the game's job key.
const JOB_ID = { novice: 0, swordman: 1, mage: 2, archer: 3, acolyte: 4, merchant: 5, thief: 6, knight: 7, priest: 8, wizard: 9,
  blacksmith: 10, hunter: 11, assassin: 12, crusader: 14, monk: 15, sage: 16, rogue: 17, alchemist: 18, bard: 19, dancer: 20,
  supernovice: 23, novice_high: 4001, swordman_high: 4002, mage_high: 4003, archer_high: 4004, acolyte_high: 4005,
  merchant_high: 4006, thief_high: 4007, lord_knight: 4008, high_priest: 4009, high_wizard: 4010, whitesmith: 4011,
  sniper: 4012, assassin_cross: 4013, paladin: 4015, champion: 4016, professor: 4017, stalker: 4018, creator: 4019,
  clown: 4020, gypsy: 4021 };
// Front rank first: tanks and melee in front, ranged and support behind.
const RANK = { 1: 0, 7: 0, 14: 0, 4008: 0, 4015: 0, 6: 1, 12: 1, 17: 1, 15: 1, 4013: 1, 4018: 1, 4016: 1, 5: 2, 10: 2, 18: 2,
  4011: 2, 4019: 2, 0: 2, 23: 2, 3: 3, 11: 3, 19: 3, 20: 3, 4012: 3, 2: 4, 9: 4, 16: 4, 4010: 4, 4017: 4, 4: 5, 8: 5, 4009: 5 };
const NPC_SKILLS = { NPC_PIERCINGATT: '穿刺攻擊', NPC_GROUNDATTACK: '地面攻擊', NPC_WINDATTACK: '風屬性攻擊', NPC_FIREATTACK: '火屬性攻擊',
  NPC_WATERATTACK: '水屬性攻擊', NPC_POISON: '毒攻擊', NPC_STUNATTACK: '暈眩攻擊', NPC_COMBOATTACK: '連續攻擊' };

// ---------- RO window chrome from the client's basic_interface textures
document.head.append(Object.assign(document.createElement('style'), { textContent: `
  .ro .tb { background:url(${UI}/titlebar_mid.gif) repeat-x; }
  .ro .tb::before { background:url(${UI}/titlebar_left.gif); } .ro .tb::after { background:url(${UI}/titlebar_right.gif); }
  #basic { background:url(${UI}/basewin_bg.gif); } #basic .tb { background:none; }
  .gze { background:url(${UI}/gze_bg.gif); }
  .gze i { background:url(${UI}/gzeblue_left.gif) no-repeat, url(${UI}/gzeblue_mid.gif) repeat-x; }
  .gze i.low { background:url(${UI}/gzered_left.gif) no-repeat, url(${UI}/gzered_mid.gif) repeat-x; }
  .mbtn { background:url(${UI}/mesbtn_mid.gif) repeat-x; }
  .mbtn::before { background:url(${UI}/mesbtn_left.gif); } .mbtn::after { background:url(${UI}/mesbtn_right.gif); }
  #short { background:url(${UI}/shortcut_bg.gif); } #input { background:url(${UI}/dialog_bg.gif); }
  #sysMini { background:url(${UI}/sys_mini_off.gif); } #sysClose { background:url(${UI}/sys_close_off.gif); }` }));
const UI_FILES = ['titlebar_mid', 'titlebar_left', 'titlebar_right', 'basewin_bg', 'gze_bg', 'gzeblue_left', 'gzeblue_mid', 'gzered_left',
  'gzered_mid', 'mesbtn_mid', 'mesbtn_left', 'mesbtn_right', 'shortcut_bg', 'dialog_bg', 'sys_mini_off', 'sys_close_off', 'grp_online'];

// ---------- game tables (bundled with the tray)
let MOBS = {}, SKILLS = {}, ITEMS = {}, MAPS = {};
const mobInfo = (id) => MOBS[id] || { name: String(id ?? ''), beh: 'passive' };
const skillName = (s) => SKILLS[s] || NPC_SKILLS[s] || String(s ?? '').replace(/^NPC_/, '');

// ---------- state
let focus = window.BATTLE_FOCUS || '', pcs = [], PEV = [], seen = new Set(), mapId = null;
let head = 0, headAt = 0, dirty = true;
let mobs = {}, uids = [], encounters = [], lures = [], T0 = 0, marchPrefix = [];
const MOB_SLOTS = [[580, BASE + 22], [660, BASE + 22], [620, BASE - 50], [700, BASE - 50]];

function addEvents(name, events) {
  const a = pcs.findIndex(p => p.name === name); if (a < 0 || !Array.isArray(events)) return;
  for (const e of events) {
    if (!e || typeof e.simTime !== 'number' || !e.body) continue;
    const k = `${a}:${e.seq}:${e.wallMs}`; if (seen.has(k)) continue; seen.add(k);
    PEV.push({ t: e.simTime, a, b: e.body });
    if (e.simTime > head) { head = e.simTime; headAt = performance.now(); }
  }
  dirty = true;
}

// Rebuild monster ranks, entry windows, waves, lures and marching from the event window.
function build() {
  dirty = false;
  PEV.sort((x, y) => x.t - y.t || x.a - y.a);
  const cut = head - KEEP; let drop = 0; while (drop < PEV.length && PEV[drop].t < cut) drop++;
  if (drop) PEV.splice(0, drop);
  T0 = PEV[0]?.t ?? head;
  pcs.forEach(p => { p.hpLog = []; p.skillIds = [...new Set(PEV.filter(x => x.a === p.i && x.b.type === 'skillCast').map(x => x.b.skill))]; });
  const old = mobs; mobs = {};
  const firstEngage = (uid, after) => PEV.find(x => x.t > after && x.b.uid === uid && /Attack|skillHit|mobSkill/.test(x.b.type))?.t ?? after + 1500;
  for (const x of PEV) {
    const b = x.b;
    if (b.uid && !mobs[b.uid] && b.monsterId && (b.type === 'found' || /Attack|skill|targetSwitch/.test(b.type))) {
      const pre = b.type !== 'found';
      mobs[b.uid] = { uid: b.uid, id: b.monsterId, foundT: pre ? -1 : x.t, enterEnd: pre ? -1 : Math.min(firstEngage(b.uid, x.t), x.t + 2000),
                      el: old[b.uid]?.el };   // walk up, then buff/provoke in place
    }
    if (b.type === 'kill' && mobs[b.uid]) mobs[b.uid].killT = x.t;
    // the kill can land in a log we don't have (a teammate outside the tray); 0 HP left is a kill too
    if (b.hpLeft === 0 && mobs[b.uid] && /playerAttack|skillHit/.test(b.type) && mobs[b.uid].killT == null) mobs[b.uid].killT = x.t;
    if (b.me && pcs[x.a]) { pcs[x.a].hpLog.push([x.t, b.me[0], b.me[1]]); }
  }
  // a monster nobody has touched for 20 s (another player took it, or it left the window) is gone
  for (const m of Object.values(mobs)) if (m.killT == null) {
    const lastT = PEV.findLast(x => x.b.uid === m.uid)?.t ?? 0; if (head - lastT > 20000) m.killT = lastT + 1500;
  }
  Object.entries(old).forEach(([u, m]) => { if (!mobs[u] && m.el) { m.el.img.remove(); m.el.bar.remove(); } });
  uids = Object.keys(mobs); encounters = uids.map(u => mobs[u]);
  // surrounded = one wave: a mob that shows up while others are still alive was there from the wave's start
  let wave = null;
  for (const m of encounters.slice().sort((p, q) => p.foundT - q.foundT)) {
    if (wave && m.foundT < wave.end) { m.foundT = wave.foundT; m.enterEnd = wave.enterEnd; wave.end = Math.max(wave.end, m.killT ?? Infinity); }
    else wave = { foundT: m.foundT, enterEnd: m.enterEnd, end: m.killT ?? Infinity, n: 0 };
    m.slot = wave.n++ % MOB_SLOTS.length;   // ponytail: >4 at once share slots
  }
  // 引怪: the puller runs out ahead, tags the mob, runs back with it in tow (log: tag -> luring{count,goal})
  lures = [];
  for (const L of PEV.filter(e => e.b.type === 'luring')) {
    const tag = PEV.filter(e => e.a === L.a && e.t <= L.t && e.t > L.t - 4000 && e.b.uid && /playerAttack|statusStart/.test(e.b.type)).at(-1);
    const m = tag && mobs[tag.b.uid]; if (!m || m.foundT < 0 || m.lure) continue;
    const out = Math.min(700, Math.max(250, tag.t - m.foundT - 200)), back = Math.max(700, L.t - tag.t - 150);
    m.enterEnd = tag.t - out;   // party halts here; the mob is still PULL px further out
    m.lure = { a: L.a, out0: m.enterEnd, tag: tag.t, back0: tag.t + 150, back1: tag.t + 150 + back, L: L.t, n: L.b.count, goal: L.b.goal };
    lures.push(m);
  }
  marchPrefix = []; for (let t = T0, acc = 0; t <= head + LAG + 50; t += 50) { marchPrefix.push(acc); if (marchingAt(t)) acc += 50 * MARCH_PX_MS; }
  for (const m of encounters) if (!m.el) {
    m.el = { img: mk('img', 'sprite'), bar: mk('div', 'bar') }; m.el.bar.append(document.createElement('i'));
    const first = PEV.find(e => e.b.uid == m.uid && 'hpLeft' in e.b && e.b.type !== 'monsterAttack' && e.b.type !== 'mobSkill');
    m.maxHp = first ? first.b.hpLeft + first.b.damage : 1;
  }
}
const PULL = 230;
const live = (m, t) => m.foundT <= t && !(m.killT + 1200 <= t);
const fighting = (m, t) => live(m, t) && !(m.killT + 1000 <= t);   // hold the line 1 s for the death + loot
const lureOff = (m, t) => !m.lure || t >= m.lure.back1 ? 0 : t < m.lure.back0 ? PULL : PULL * (1 - (t - m.lure.back0) / (m.lure.back1 - m.lure.back0));
// the party always closes the distance: monsters hold still and scroll in with the ground
const marchingAt = (t) => encounters.some(m => m.foundT <= t && t < m.enterEnd) || !encounters.some(m => fighting(m, t));
const scrollAt = (t) => marchPrefix[Math.max(0, Math.min(marchPrefix.length - 1, Math.floor((t - T0) / 50)))] ?? 0;

// ---------- client assets (effects from ro-survivors' client extracts)
const load = (src) => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const json = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); };
const atl = {}, strs = {}, tex = {};
const ATLASES = ['fx_numbers', 'fx_miss'], STRS = ['fx_crit', 'str_angelus', 'str_provoke', 'str_loud', 'str_lightning'], TEXES = ['tex_magic_green', 'tex_magic_blue', 'tex_agi_up'];
async function loadAtlas(n) { const j = await json(`${RS}/sprites/${n}.json`); atl[n] = { ...j, img: await load(`${RS}/sprites/${j.image}`) }; }
async function loadStr(n) {
  const s = await json(`${RS}/str/${n}/str.json`), names = [...new Set(s.layers.flatMap(l => l.tex))];
  const imgs = Object.fromEntries(await Promise.all(names.map(async t => [t, await load(`${RS}/str/${n}/${t}`)])));
  s.layers.forEach(l => { l.imgs = l.tex.map(t => imgs[t]); l.keys.sort((a, b) => a.f - b.f || a.t - b.t); }); strs[n] = s;
}
const tints = {};
function tinted(color) {
  if (tints[color]) return tints[color];
  const a = atl.fx_numbers, c = document.createElement('canvas'); c.width = a.img.width; c.height = a.img.height;
  const x = c.getContext('2d'); x.drawImage(a.img, 0, 0); x.globalCompositeOperation = 'multiply'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(a.img, 0, 0); return tints[color] = c;
}
function drawDigits(ctx, n, x, y, scale, color, alpha) {
  const a = atl.fx_numbers; if (!a?.img || scale <= 0.02) return;
  const img = tinted(color), fr = [...String(n)].map(ch => a.frames[+ch]).filter(Boolean);
  let cx = x - fr.reduce((w, f) => w + (f[2] - 1) * scale, 0) / 2; ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (const f of fr) { ctx.drawImage(img, f[0], f[1], f[2], f[3], cx, y - f[3] * scale, f[2] * scale, f[3] * scale); cx += (f[2] - 1) * scale; }
  ctx.globalAlpha = 1;
}
function drawAtlas(ctx, n, i, x, y, scale = 1, alpha = 1) {
  const a = atl[n]; if (!a?.img || !a.frames[i]) return; const [sx, sy, w, h, ox, oy] = a.frames[i];
  ctx.globalAlpha = alpha; ctx.drawImage(a.img, sx, sy, w, h, x - ox * scale, y - oy * scale, w * scale, h * scale); ctx.globalAlpha = 1;
}
function drawStr(ctx, n, age, x, y, scale = 1) {
  const s = strs[n]; if (!s) return; const frame = Math.floor(age * s.fps / 1000); if (frame < 0 || frame > s.maxKey) return;
  for (const L of s.layers) {
    let from = -1, to = -1, lastF = 0;
    L.keys.forEach((k, i) => { if (k.f <= frame) { if (k.t === 0) from = i; else to = i; } lastF = Math.max(lastF, k.f); });
    if (from < 0 || (to < 0 && lastF < frame)) continue;
    const k = L.keys[from], d = to === from + 1 && L.keys[to].f === k.f ? L.keys[to] : null, dt = frame - k.f, v = (a, b) => d ? a + b * dt : a;
    const xs = [0, 1, 2, 3].map(i => v(k.xy[i], d?.xy[i])), ys = [4, 5, 6, 7].map(i => v(k.xy[i], d?.xy[i]));
    const alpha = v(k.c[3], d?.c[3]) / 255, img = L.imgs[Math.max(0, Math.min(L.imgs.length - 1, Math.floor(v(k.af, d?.af))))];
    if (!img || alpha <= 0) continue;
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    ctx.save(); ctx.globalAlpha = Math.min(1, alpha); ctx.globalCompositeOperation = k.add ? 'lighter' : 'source-over';
    ctx.translate(x + (v(k.pos[0], d?.pos[0]) - 320) * scale, y + (v(k.pos[1], d?.pos[1]) - 320) * scale); ctx.rotate(-v(k.a, d?.a) * Math.PI / 180);
    ctx.drawImage(img, x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale); ctx.restore();
  }
}

// ---------- DOM
const $ = (id) => document.getElementById(id);
const ground = $('ground').getContext('2d'), under = $('under').getContext('2d'), fx = $('fx').getContext('2d');
const mk = (tag, cls) => Object.assign($('world').appendChild(document.createElement(tag)), { className: cls });
const setSrc = (img, url) => { if (img.dataset.u !== url) { img.dataset.u = url; img.src = url; } };
const look = (p) => `job=${p.job}&gender=${p.sex === 'f' ? 'female' : 'male'}&head=${p.hair}&headPalette=${p.hairColor}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
let sel = 0, groundImg = null;

function setParty(list) {
  const key = list.map(c => c.name).join('|');
  if (key === pcs.map(p => p.name).join('|')) { list.forEach((c, i) => Object.assign(pcs[i], stats(c))); return; }
  pcs.forEach(p => { p.img.remove(); p.bar.remove(); p.cast.remove(); });
  // ponytail: two rows of four; a party past 8 only shows the first 8 by rank.
  pcs = list.map((c, i) => ({ i, name: c.name, cls: c.class, profile: c.profile, job: JOB_ID[c.jobKey] ?? 0, sex: c.look?.sex === 'f' ? 'f' : 'm',
    hair: c.look?.hair ?? 1, hairColor: c.look?.hairColor ?? 0, hpLog: [], skillIds: [], ...stats(c) }));
  [...pcs].sort((a, b) => (RANK[a.job] ?? 2) - (RANK[b.job] ?? 2) || a.i - b.i).forEach((p, r) => {
    p.rank = r; const back = r >= 4, c = r % 4; p.x = (back ? 430 : 470) - c * 72; p.y = back ? BASE - 50 : BASE + 22; p.hidden = r >= 8; });
  pcs.forEach(p => { p.img = mk('img', 'sprite'); p.img.onclick = () => sel = p.i; p.img.style.display = p.hidden ? 'none' : '';
    p.bar = mk('div', 'bar'); p.bar.append(document.createElement('i'), Object.assign(document.createElement('i'), { className: 'sp' }));
    p.cast = mk('div', 'cast'); p.cast.append(document.createElement('i')); });
  $('roster').innerHTML = '';
  [...pcs].sort((a, b) => a.rank - b.rank).forEach(p => { const d = $('roster').appendChild(document.createElement('div'));
    d.className = 'row'; d.innerHTML = `<img src="${UI}/grp_online.gif"><span>${esc(p.name)}</span><div class="gze"><i></i></div>`; d.onclick = () => sel = p.i; p.rosterEl = d; });
  sel = Math.max(0, pcs.findIndex(p => p.name === focus));
  PEV = []; seen = new Set(); head = 0; mobs = {}; document.querySelectorAll('.world .sprite, .world .bar').forEach(e => pcs.some(p => p.img === e || p.bar === e) || e.remove());
}
const stats = (c) => ({ lv: c.base, maxHp: c.maxHp || 1, spMax: c.maxSp || 1, hpNow0: c.hp ?? c.maxHp, spNow0: c.sp ?? c.maxSp, map: c.map });

async function refreshParty() {
  const list = focus ? await invoke('battle_party', { name: focus }).catch(() => []) : [];
  const changed = list.map(c => c.name).join('|') !== pcs.map(p => p.name).join('|');
  setParty(list);
  const m = list.find(c => c.name === focus)?.mapId || list[0]?.mapId || null;
  if (m !== mapId) { mapId = m; groundImg = null; if (m) load(`${RI}/client/backdrop/map/${m}.jpg`).then(i => { if (mapId === m) groundImg = i; }); }
  $('mapName').textContent = list.find(c => c.name === focus)?.map || MAPS[mapId] || mapId || '';
  if (changed && list.length) addBackfill(await invoke('battle_backfill', { names: list.map(c => c.name) }).catch(() => ({})));
  $('empty').textContent = list.length ? '' : '角色未載入：先在選單打開這個角色';
}
function addBackfill(map) { for (const [name, events] of Object.entries(map || {})) addEvents(name, events); }
window.battleFocus = (name) => { if (name && name !== focus) { focus = name; live_ = true; refreshParty(); } };

// ---------- render(t)
const lo = (t) => { let a = 0, b = PEV.length; while (a < b) { const m = (a + b) >> 1; if (PEV[m].t <= t) a = m + 1; else b = m; } return a; };   // first index after t
const ev = (t, win, pred) => { const out = []; for (let i = lo(t) - 1; i >= 0 && PEV[i].t > t - win; i--) if (pred(PEV[i])) out.push(PEV[i]); return out.reverse(); };
const lastBefore = (t, pred) => { for (let i = lo(t) - 1; i >= 0; i--) if (pred(PEV[i])) return PEV[i]; };
function bracket(ctx, x, y, w, color) {   // selection bracket under the feet
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(x - w, y + 2); ctx.lineTo(x - w, y + 10); ctx.lineTo(x + w, y + 10); ctx.lineTo(x + w, y + 2); ctx.stroke();
}
function render(t) {
  const marching = marchingAt(t), scroll = scrollAt(t);
  ground.clearRect(0, 0, W, H);
  if (groundImg) { const tw = groundImg.width * (H / groundImg.height), off = scroll % (tw * 2);
    for (let k = -1; k * tw - off < W; k++) { const x = k * tw - off; ground.save();
      if (k % 2) { ground.translate(x + tw, 0); ground.scale(-1, 1); ground.drawImage(groundImg, 0, 0, tw, H); } else ground.drawImage(groundImg, x, 0, tw, H);
      ground.restore(); } }
  under.clearRect(0, 0, W, H); fx.clearRect(0, 0, W, H);
  const lureNow = lures.find(m => t >= m.lure.out0 && !(m.killT <= t));
  $('banner').textContent = !pcs.length ? '' : lureNow ? `— 引怪 ${t >= lureNow.lure.L ? lureNow.lure.n : lureNow.lure.n - 1}/${lureNow.lure.goal} —` : marching ? '— 探索中 —' : '— 戰鬥 —';

  // monsters
  const mobPos = {};
  uids.forEach(uid => { const m = mobs[uid], { img, bar } = m.el;
    const show = live(m, t); img.style.display = bar.style.display = show ? '' : 'none'; if (!show) return;
    let [x, y] = MOB_SLOTS[m.slot];
    const entering = m.foundT >= 0 && t < m.enterEnd;
    if (entering) x += scrollAt(m.enterEnd) - scrollAt(t);   // pinned to the ground
    x += lureOff(m, t); const following = m.lure && t >= m.lure.back0 && t < m.lure.back1;
    const atk = ev(t, 520, e => e.b.uid == uid && (e.b.type === 'monsterAttack' || e.b.type === 'mobSkill'));
    if (atk.length) x -= 34 * Math.sin(Math.PI * Math.min(1, (t - atk.at(-1).t) / 300));
    const hurt = ev(t, 260, e => e.b.uid == uid && (e.b.type === 'playerAttack' || e.b.type === 'skillHit') && e.b.result !== 'miss').length;
    if (hurt) x += 4;
    const act = m.killT <= t ? 32 : hurt ? 24 : atk.length ? 16 : following ? 8 : 0;
    setSrc(img, `${RA}/image?job=${m.id}&action=${act + FACE_L}`);
    img.style.opacity = m.killT <= t && t > m.killT + 600 ? 0 : 1; img.title = mobInfo(m.id).name;
    Object.assign(img.style, { left: x + 'px', top: y + 'px', zIndex: 100 + y });
    const hp = lastBefore(t, e => e.b.uid == uid && 'hpLeft' in e.b && e.b.type !== 'monsterAttack' && e.b.type !== 'mobSkill');
    const mf = Math.max(0, (hp ? hp.b.hpLeft : m.maxHp) / m.maxHp); bar.firstChild.style.width = 100 * mf + '%'; bar.firstChild.className = mf < .25 ? 'low' : '';
    Object.assign(bar.style, { left: x + 'px', top: y + 14 + 'px', display: m.killT <= t || entering ? 'none' : '' });
    under.fillStyle = 'rgba(0,0,0,.35)'; under.beginPath(); under.ellipse(x, y - 2, 20, 6, 0, 0, 7); under.fill();
    mobPos[uid] = [x, y];
  });

  // party
  pcs.forEach(p => {
    if (p.hidden) { p.screen = [p.x, p.y]; p.now = { hpNow: p.hpNow0, spNow: p.spNow0 }; return; }
    let x = p.x; const y = p.y;
    const cast = lastBefore(t, e => e.a === p.i && e.b.type === 'skillCast' && e.b.castMs > 0);
    const casting = cast && t < cast.t + cast.b.castMs && !ev(t, cast.b.castMs + 1, e => e.a === p.i && e.b.type === 'skillInterrupt' && e.t > cast.t).length;
    const swing = ev(t, 420, e => e.a === p.i && (e.b.type === 'playerAttack' || (e.b.type === 'skillCast' && !e.b.castMs)));
    const hurt = ev(t, 300, e => e.a === p.i && (e.b.type === 'monsterAttack' || e.b.type === 'mobSkill') && e.b.result === 'hit').length;
    if (swing.length && swing.at(-1).b.type === 'playerAttack') x += 42 * Math.sin(Math.PI * Math.min(1, (t - swing.at(-1).t) / 320));   // step in and back
    if (hurt) x -= 5;
    const dead = (lastBefore(t, e => e.a === p.i && e.b.me)?.b.me[0] ?? 1) <= 0;
    let act = dead ? 64 : marching ? 8 : casting ? 96 : swing.length ? 40 : hurt ? 48 : 32, face = FACE_R;   // battle idle = standby (stand act 0 cycles head turns)
    const lm = lures.find(m => m.lure.a === p.i && t >= m.lure.out0 && t < m.lure.back1);
    if (lm) { const l = lm.lure, far = MOB_SLOTS[lm.slot][0] + PULL - 48 - p.x;
      if (t < l.tag) { x = p.x + far * (t - l.out0) / (l.tag - l.out0); act = 8; }        // sprint out
      else if (t < l.back0) x = p.x + far;                                                  // tag it
      else { x = p.x + far * (1 - (t - l.back0) / (l.back1 - l.back0)); act = 8; face = FACE_L; } // run home, mob in tow
    }
    setSrc(p.img, `${RA}/image?${look(p)}&action=${act + face}`); p.img.title = p.name;
    Object.assign(p.img.style, { left: x + 'px', top: y + 'px', zIndex: 100 + y });
    const hpRec = p.hpLog.length && p.hpLog[0][0] <= t ? p.hpLog.findLast(h => h[0] <= t) : null;
    const hpNow = hpRec?.[1] ?? p.hpNow0, spNow = hpRec?.[2] ?? p.spNow0;
    p.bar.firstChild.style.width = 100 * hpNow / p.maxHp + '%'; p.bar.firstChild.className = hpNow / p.maxHp < .25 ? 'low' : '';
    p.bar.lastChild.style.width = 100 * spNow / p.spMax + '%'; Object.assign(p.bar.style, { left: x + 'px', top: y + 14 + 'px' });
    const ri = p.rosterEl.querySelector('i'); ri.style.width = 100 * hpNow / p.maxHp + '%'; ri.className = hpNow / p.maxHp < .25 ? 'low' : ''; p.rosterEl.classList.toggle('sel', p.i === sel);
    under.fillStyle = 'rgba(0,0,0,.35)'; under.beginPath(); under.ellipse(x, y - 2, 17, 5, 0, 0, 7); under.fill();
    if (p.i === sel) bracket(under, x, y + 12, 26, '#e9c46a');
    p.cast.style.display = casting ? '' : 'none';
    if (casting) {
      const f = (t - cast.t) / cast.b.castMs; p.cast.firstChild.style.width = f * 100 + '%'; Object.assign(p.cast.style, { left: x + 'px', top: y - 92 + 'px' });
      const ring = tex[cast.b.skill?.startsWith('AL_') ? 'tex_magic_green' : 'tex_magic_blue'];
      if (ring) { fx.save(); fx.globalCompositeOperation = 'lighter'; fx.globalAlpha = .8; fx.translate(x, y - 4); fx.scale(1, .45); fx.rotate(t / 600);
        fx.drawImage(ring, -36, -36, 72, 72); fx.restore(); }
    }
    p.screen = [x, y]; p.now = { hpNow, spNow, casting, cast };
  });

  // event effects: damage numbers, shouts, client STR effects
  for (const x of ev(t, 3000, () => true)) {
    const age = t - x.t, b = x.b, [px, py] = pcs[x.a]?.screen ?? [0, 0],
      mp = mobPos[b.uid] ?? mobPos[uids.find(k => mobs[k].id === b.monsterId && live(mobs[k], x.t))];
    const dmg = (n, sx, sy, color, delay = 0, k = 1) => { const a2 = age - delay; if (a2 < 0 || a2 > 1500) return;
      const q = a2 / 1500, arc = Math.sin(-Math.PI / 2 + Math.PI * (0.5 + q * 1.5));
      drawDigits(fx, n, sx + q * 40 * (color === '#ff3030' ? -1 : 1), sy - 66 - arc * 42, (1 - q) * 1.9 * k, color, 1 - q); };
    const combo = (n, sx, sy) => { if (age > 3000) return; const q = age / 3000; drawDigits(fx, n, sx, sy - 116 - q * 14, Math.min(q, .05) * 75 / 3.75 * 1.7, '#e6e626', 1 - q); };
    const miss = (sx, sy) => { if (age > 800) return; const a = atl.fx_miss; if (a) drawAtlas(fx, 'fx_miss', a.actions.a0.dirs[0][Math.min(11, age / 70 | 0)], sx, sy - 84 - age / 800 * 30, .42, 1 - age / 800); };
    const shout = (text, sx, sy, color) => { if (age > 1600) return; fx.globalAlpha = Math.min(1, (1600 - age) / 400);
      fx.font = 'bold 12px "MingLiU", "PMingLiU", Gulim, "Fusion Pixel 12px", sans-serif'; fx.textAlign = 'center'; fx.fillStyle = '#000'; fx.fillText(text, sx + 1, sy - 107);
      fx.fillStyle = color; fx.fillText(text, sx, sy - 108); fx.globalAlpha = 1; };
    if ((b.type === 'playerAttack' || b.type === 'skillHit') && mp) {
      if (b.result === 'miss') miss(mp[0], mp[1]);
      else if (b.result === 'crit') { if (age < 1600) drawStr(fx, 'fx_crit', age, mp[0], mp[1] - 30, .85); dmg(b.damage, mp[0], mp[1], '#e6e626', 0, 1.25); }
      else if (b.hits > 1) { for (let h = 0; h < b.hits; h++) dmg(Math.round(b.damage / b.hits), mp[0], mp[1], '#ffffff', h * 140); combo(b.damage, mp[0], mp[1]); }
      else dmg(b.damage, mp[0], mp[1], '#ffffff');
    }
    if (b.type === 'monsterAttack' || b.type === 'mobSkill') {
      if (b.result === 'miss') miss(px, py); else dmg(b.damage, px, py, '#ff3030');
      if (b.type === 'mobSkill' && mp) shout(skillName(b.skill) + '!!', mp[0], mp[1] + 40, '#ffd36b');
    }
    if (b.type === 'skillCast') {
      const done = age - (b.castMs || 0);
      if (done >= 0) shout(skillName(b.skill) + '!!', px, py, '#bfe3ff');
      if (done >= 0 && b.skill === 'SM_PROVOKE' && mp) drawStr(fx, 'str_provoke', done, mp[0], mp[1] - 20);
      if (done >= 0 && b.skill === 'MC_LOUD') drawStr(fx, 'str_loud', done, px, py - 20);
      if (done >= 0 && b.skill === 'SM_ENDURE' && done < 900) { fx.save(); fx.globalCompositeOperation = 'lighter'; fx.globalAlpha = 1 - done / 900;
        fx.strokeStyle = '#ffcf4a'; fx.lineWidth = 3; fx.beginPath(); fx.ellipse(px, py - 32, 24 + done / 30, 44 + done / 20, 0, 0, 7); fx.stroke(); fx.restore(); }
    }
    if (b.type === 'skillInterrupt' && age < 1200) shout('詠唱中斷', px, py, '#ff8a7a');
    if (b.type === 'luring') shout(`引怪 ${b.count}/${b.goal}`, px, py, '#ffcf4a');
    if (b.type === 'support' && b.from) {
      if (b.skill === 'AL_ANGELUS') drawStr(fx, 'str_angelus', age, px, py - 8, .5);
      if (b.skill === 'AL_HEAL' && b.amount) dmg(b.amount, px, py, '#30ff60');
      if (b.skill === 'AL_INCAGI' && age < 1100 && tex.tex_agi_up) { fx.save(); fx.globalCompositeOperation = 'lighter'; fx.globalAlpha = 1 - age / 1100;
        for (let k = 0; k < 3; k++) fx.drawImage(tex.tex_agi_up, px - 20 + k * 12, py - 20 - (age / 1100 * 70 + k * 14) % 70, 22, 22); fx.restore(); }
    }
  }
  for (const x of ev(t + 1500, 2700, e => e.b.type === 'skillHit' && e.b.skill === 'MG_LIGHTNINGBOLT')) {   // the bolt lands ~0.9 s in, so start before the damage tick
    const mp = mobPos[x.b.uid]; if (!mp) continue;
    for (let h = 0; h < x.b.hits; h++) drawStr(fx, 'str_lightning', t - (x.t - 900 - (x.b.hits - 1 - h) * 150), mp[0] + (h % 2 ? 7 : -7), mp[1] + 10, .8);
  }
  // drops pop out of the monster and fly to whoever picks them up
  document.querySelectorAll('.world .drop').forEach(d => d.remove());
  for (const x of ev(t, 8000, e => e.b.type === 'drop')) {
    const uid = uids.find(k => mobs[k].killT === x.t && mobs[k].id === x.b.monsterId); if (!uid) continue;
    const pick = PEV.find(y => y.b.type === 'pickup' && y.b.itemId === x.b.itemId && y.t >= x.t); if (pick && t > pick.t + 300) continue;
    const n = PEV.filter(y => y.t === x.t && y.b.type === 'drop').indexOf(x), [sx, sy] = MOB_SLOTS[mobs[uid].slot];
    const pop = Math.min(1, (t - x.t) / 300); let dx = sx + (n % 3 - 1) * 20 * pop, dy = sy - 10 - Math.sin(Math.PI * pop) * 30 + (n / 3 | 0) * 12;
    if (pick && t > pick.t && pcs[pick.a]) { const [ppx, ppy] = pcs[pick.a].screen, f = (t - pick.t) / 300; dx += (ppx - dx) * f; dy += (ppy - 40 - dy) * f; }
    const d = mk('img', 'drop'); d.src = `${RI}/client/item/${x.b.itemId}.png`; Object.assign(d.style, { left: dx + 'px', top: dy + 'px' });
  }

  // HUD: selected character
  const p = pcs[sel]; if (!p?.now) return;
  $('pName').textContent = p.name; $('pCls').textContent = p.cls; $('pLv').textContent = `Base Lv. ${p.lv}`;
  $('pHp').style.width = 100 * p.now.hpNow / p.maxHp + '%'; $('pHp').className = p.now.hpNow / p.maxHp < .25 ? 'low' : ''; $('pHpT').textContent = `${p.now.hpNow} / ${p.maxHp}`;
  $('pSp').style.width = 100 * p.now.spNow / p.spMax + '%'; $('pSpT').textContent = `${p.now.spNow} / ${p.spMax}`;
  const hot = p.now.casting ? p.now.cast.b.skill : ev(t, 1200, e => e.a === p.i && e.b.type === 'skillCast').at(-1)?.b.skill;
  const buffs = [...new Set(ev(t, KEEP, e => e.a === p.i && e.b.type === 'buffStart' && t < e.t + e.b.durationMs
    && !ev(t, t - e.t, z => z.a === p.i && z.b.type === 'buffEnd' && z.b.buffId === e.b.buffId && z.t > e.t).length).map(e => e.b.buffId))];
  const bh = buffs.map(s => skillName(s)).join('  ') || '　'; if ($('pBuff').textContent !== bh) $('pBuff').textContent = bh;
  const html = p.skillIds.slice(0, 9).map((s, k) => `<img style="left:${7 + 27 * k}px" class="${s === hot ? 'hot' : ''}" src="${RI}/client/skill/${esc(s)}.png" title="${esc(skillName(s))}">`).join('');
  if ($('short').dataset.h !== html) { $('short').dataset.h = html; $('short').innerHTML = html; }
  const fmt = (x) => { const b = x.b, who = esc(pcs[x.a]?.name), mob = esc(mobInfo(b.monsterId).name); return ({
    found: `${who} 發現 ${mob}`, kill: `${who} 擊倒 ${mob}`,
    skillCast: `${who} 施放 ${esc(skillName(b.skill))}${b.castMs ? `（詠唱 ${b.castMs} ms）` : ''}`,
    skillHit: `${who} ${esc(skillName(b.skill))} → ${mob} ${b.damage}`, skillInterrupt: `${who} ${esc(skillName(b.skill))} 被中斷`,
    mobSkill: `${mob} 對 ${who} 使用 ${esc(skillName(b.skill))}`, pickup: `${who} 撿起 ${esc(ITEMS[b.itemId] || b.itemId)}`,
    luring: `${who} 引怪 ${b.count}/${b.goal}`,
  })[b.type] || (b.result === 'crit' ? `${who} 爆擊 ${mob} ${b.damage}！` : null); };
  const lines = []; for (let i = lo(t) - 1; i >= 0 && lines.length < 6; i--) { const s = fmt(PEV[i]); if (s) lines.push([PEV[i], s]); }
  const logHtml = lines.reverse().map(([x, s]) => `<div class="${/kill|pickup/.test(x.b.type) ? 'sys' : x.b.type === 'skillCast' ? 'pt' : ''}">${s}</div>`).join('');
  if ($('log').dataset.h !== logHtml) { $('log').dataset.h = logHtml; $('log').innerHTML = logHtml; }
}

// ---------- clock: follow the live edge (game state lands in ~3 s batches), or scrub back
let t = 0, speed = 1, playing = true, live_ = true, last = performance.now();
const liveEdge = () => Math.min(head, head - LAG + (performance.now() - headAt));
$('seek').oninput = () => { t = +$('seek').value; live_ = false; };
$('time').onclick = () => { live_ = true; playing = true; $('play').textContent = '❚❚'; };
$('play').onclick = (e) => { playing = !playing; if (!playing) live_ = false; e.currentTarget.textContent = playing ? '❚❚' : '▶'; };
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { speed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b)); });
let lastBuild = 0;
function loop(now) {
  if (dirty && now - lastBuild > 500) { lastBuild = now; build(); }
  const edge = liveEdge();
  if (live_) t = edge;
  else if (playing) { t += (now - last) * speed; if (t >= edge) { t = edge; live_ = true; } }
  t = Math.max(T0, t); last = now;
  if (PEV.length) render(t);
  $('seek').min = T0; $('seek').max = Math.max(T0 + 1, edge); $('seek').value = t;
  $('time').className = live_ ? 'live' : ''; $('time').textContent = live_ ? '● LIVE' : `-${Math.max(0, (edge - t) / 1000).toFixed(1)} s`;
  requestAnimationFrame(loop);
}

// ---------- offline: warm the asset cache for this party and map
$('dl').onclick = async () => {
  const note = $('dlNote'), urls = new Set(UI_FILES.map(f => `${UI}/${f}.gif`));
  ATLASES.forEach(n => urls.add(`${RS}/sprites/${n}.json`)); TEXES.forEach(n => urls.add(`${RS}/fxtex/${n}.png`));
  const actions = [0, 8, 16, 24, 32];   // monster: idle, walk, attack, hurt, die
  for (const p of pcs) for (const a of [8, 32, 40, 48, 64, 96]) urls.add(`${RA}/image?${look(p)}&action=${a + FACE_R}`), a === 8 && urls.add(`${RA}/image?${look(p)}&action=${a + FACE_L}`);
  for (const p of pcs) for (const s of p.skillIds) urls.add(`${RI}/client/skill/${s}.png`);
  const spawns = window.GAME?.maps.find(m => m.id === mapId)?.spawns ?? [];
  for (const s of spawns) { for (const a of actions) urls.add(`${RA}/image?job=${s.monsterId}&action=${a + FACE_L}`);
    for (const d of window.GAME.monsters.find(m => m.id === s.monsterId)?.drops ?? []) urls.add(`${RI}/client/item/${d.itemId}.png`); }
  if (mapId) urls.add(`${RI}/client/backdrop/map/${mapId}.jpg`);
  const list = [...urls]; let done = 0, failed = 0;
  // STR effects list their own textures; fetch the json first, then queue the textures.
  for (const n of STRS) { try { const s = await json(`${RS}/str/${n}/str.json`); new Set(s.layers.flatMap(l => l.tex)).forEach(x => list.push(`${RS}/str/${n}/${x}`)); } catch { failed++; } }
  const step = async () => { while (list.length) { const u = list.pop(); try { (await fetch(u)).ok || failed++; } catch { failed++; } done++;
    note.textContent = `已下載 ${done} 個${failed ? `，失敗 ${failed}` : ''}`; } };
  note.textContent = '下載中…'; await Promise.all([1, 2, 3, 4, 5, 6].map(step));
  note.textContent = `完成：${done} 個素材已存到本機${failed ? `（${failed} 個失敗）` : ''}`;
};

// ---------- boot
(async () => {
  const [game, items] = await Promise.all([fetch('game-data.json').then(r => r.json()), fetch('item-info.json').then(r => r.json())]);
  window.GAME = game;
  for (const m of game.monsters) MOBS[m.id] = { name: m.name, beh: m.behavior };
  for (const s of game.skills) SKILLS[s.id] = s.name;
  for (const m of game.maps) MAPS[m.id] = m.name;
  for (const [id, v] of Object.entries(items)) ITEMS[id] = v.name;
  await refreshParty();
  setInterval(refreshParty, 10000);   // map changes and members joining or leaving
  listen('ro-idle-log', (e) => {
    const p = pcs.find(x => x.profile === e.payload?.profile); if (!p) return;
    try { addEvents(p.name, JSON.parse(e.payload.data)); } catch {}
  });
  ATLASES.forEach(n => loadAtlas(n).catch(() => {}));
  STRS.forEach(n => loadStr(n).catch(() => {}));
  TEXES.forEach(async n => { tex[n] = await load(`${RS}/fxtex/${n}.png`); });
  requestAnimationFrame(loop);
})();
