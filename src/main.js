import { showPanel, closeSettings } from "./panel.js";
import { overview, shown } from "./compact.js";
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString());
const pct = (v, max) => (v == null || !max ? null : Math.max(0, Math.min(100, (v / max) * 100)));
const el = (tag, className, textContent = "") => Object.assign(document.createElement(tag), { className, textContent });
// Buttons stay disabled briefly after a start/stop click until the game confirms.
const pending = new Map();
let nicknames = {};
let goals = {};
// Final (transcendent) jobs, their English names, and the classes on the way there. Novice can pick any.
const GOALS = [
  ["騎士領主", "Lord Knight", "劍士", "騎士"], ["聖殿十字軍", "Paladin", "劍士", "十字軍"],
  ["超魔導師", "High Wizard", "魔法師", "巫師"], ["智者", "Scholar", "魔法師", "賢者"],
  ["神射手", "Sniper", "弓箭手", "獵人"], ["搞笑藝人", "Clown", "弓箭手", "吟遊詩人"], ["冷豔舞姬", "Gypsy", "弓箭手", "舞孃"],
  ["神官", "High Priest", "服事", "祭司"], ["武術宗師", "Champion", "服事", "武道家"],
  ["神工匠", "Whitesmith", "商人", "鐵匠"], ["創造者", "Creator", "商人", "鍊金術師"],
  ["十字刺客", "Assassin Cross", "盜賊", "刺客"], ["神行太保", "Stalker", "盜賊", "流氓"],
  ["超級初心者", "Super Novice"],
];
// Display label only; the stored goal stays the Chinese name so goals.json and the API are unchanged.
const goalLabel = (g) => `${g[0]}（${g[1]}）`;
const goalName = (zh) => { const g = GOALS.find((r) => r[0] === zh); return g ? goalLabel(g) : zh; };
const goalsFor = (cls = "") => {
  const base = cls.replace("（轉生）", "");
  return base === "初學者" || base === "" ? GOALS : GOALS.filter((g) => g.includes(base));
};
// Don't re-render while a nickname is being typed.
let editing = false;
// Profile n whose detail popup is showing; survives the full re-render on every refresh.
let expanded = null;
// Profile number being dragged; refresh waits while a drag is in progress.
let dragging = null;
// List view's status filter: "all" | "attention" | "idle" | "offline".
let filter = "all";
// Profile order from the last refresh, so saving never drops rows that are not on screen.
let lastOrder = [];
// Board columns: [{ name, members: [n] }]. Profiles in no group show in the first column.
// Saved in groups.json by the tray (localStorage is per origin, and `tauri dev` changes
// the origin's port every run). Old localStorage groups are migrated on first load.
let groups = [{ name: "未分組", members: [] }];
const validGroups = (g) => Array.isArray(g) && g.length && g.every((x) => typeof x?.name === "string" && Array.isArray(x.members));
const saveGroups = () => { invoke("set_groups", { groups }).catch(() => {}); };
const groupsReady = invoke("get_groups").then((g) => {
  if (validGroups(g)) { groups = g; return; }
  try {
    const old = JSON.parse(localStorage.getItem("roIdleTray.groups"));
    if (validGroups(old)) { groups = old; saveGroups(); }
  } catch {}
}).catch(() => {});

// Inline text edit used for group names (Enter saves, Esc cancels, blur saves).
function editInline(node, value, onSave) {
  editing = true;
  const input = Object.assign(document.createElement("input"), { className: "col-input", value, maxLength: 30 });
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    editing = false;
    const v = input.value.trim();
    if (save && v && v !== value) onSave(v);
    refresh();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  node.replaceWith(input);
  input.focus();
  input.select();
}

function column(g, gi, boxes) {
  const col = el("section", "col");
  col.dataset.g = gi;
  const head = el("div", "col-head");
  const name = Object.assign(el("button", "col-name", g.name), { type: "button", title: "Click to rename" });
  name.addEventListener("click", () => editInline(name, g.name, (v) => { groups[gi].name = v; saveGroups(); }));
  head.append(name, el("span", "col-count dim", String(boxes.length)));
  if (groups.length > 1) {
    const del = Object.assign(el("button", "link col-del", "×"), { type: "button", title: `Delete group ${g.name}; its rows move to the next group` });
    del.setAttribute("aria-label", `Delete group ${g.name}`);
    del.addEventListener("click", () => {
      groups[gi === 0 ? 1 : 0].members.push(...g.members);
      groups.splice(gi, 1);
      saveGroups();
      refresh();
    });
    head.append(del);
  }
  const body = el("div", "sec-body");
  body.append(...boxes);
  col.append(head, body);
  return col;
}

// Boxes split by group; rows in no group go to the first.
function byGroup(boxes) {
  const byN = new Map(boxes.map((b) => [Number(b.dataset.n), b]));
  const placed = new Set();
  const cols = groups.map((g) => g.members.map((n) => byN.get(n)).filter((b) => b && !placed.has(b) && placed.add(b)));
  cols[0].push(...boxes.filter((b) => !placed.has(b)));
  return cols;
}

// List (compact) view: copies of rows needing attention on top, then each group as a stacked section.
// The rows themselves stay in their groups; the copies are not drag targets or sources.
function ledger(boxes, attn) {
  for (const b of attn) b.draggable = false;
  const cols = byGroup(filter === "attention" ? [] : boxes);
  const parts = [];
  if (attn.length) {
    const sec = el("section", "attn-sec");
    const head = el("div", "col-head");
    head.append(el("span", "col-name", "需要注意"), el("span", "col-count dim", String(attn.length)));
    sec.append(head, ...attn);
    parts.push(sec);
  }
  groups.forEach((g, gi) => { if (cols[gi].length || filter === "all") parts.push(column(g, gi, cols[gi])); });
  if (!parts.length) parts.push(el("p", "none dim", filter === "offline" ? "沒有離線角色" : "沒有符合的角色"));
  if (filter === "all") {
    const add = Object.assign(el("button", "btn add-group", "＋ 新增群組"), { type: "button" });
    add.addEventListener("click", () => {
      groups.push({ name: `群組 ${groups.length + 1}`, members: [] });
      saveGroups();
      refresh();
    });
    parts.push(add);
  }
  return parts;
}

// Save group membership and the overall order from what's on screen.
function saveLayout() {
  const before = groups.map((g) => [...g.members]);
  list.querySelectorAll(".col").forEach((col) => {
    groups[Number(col.dataset.g)].members = [...col.querySelectorAll(".sec-body > [data-n]")].map((x) => Number(x.dataset.n));
  });
  // Rows not in a group section (the attention list, or hidden by a filter) keep their old group and spot.
  const placed = new Set(groups.flatMap((g) => g.members));
  before.forEach((members, gi) => members.forEach((n, i) => {
    if (!placed.has(n)) { groups[gi].members.splice(Math.min(i, groups[gi].members.length), 0, n); placed.add(n); }
  }));
  saveGroups();
  const known = new Set(lastOrder);
  const order = [...new Set([...groups.flatMap((g) => g.members).filter((n) => known.has(n)), ...lastOrder])];
  invoke("reorder_profiles", { order });
}

// Click a character name to copy it (e.g. to paste into game chat or trade).
async function copyName(node, name) {
  try {
    await navigator.clipboard.writeText(name);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: name });
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  node.classList.add("copied");
  node.dataset.was = node.textContent;
  node.textContent = "已複製";
  setTimeout(() => { node.textContent = node.dataset.was; node.classList.remove("copied"); }, 900);
}

function editNickname(btn, name) {
  editing = true;
  const input = Object.assign(document.createElement("input"), {
    className: "nick-input", value: nicknames[name] ?? "", placeholder: name, maxLength: 30,
  });
  input.setAttribute("aria-label", `Nickname for ${name}`);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    editing = false;
    if (save) invoke("set_nickname", { name, nickname: input.value });
    else refresh();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("blur", () => finish(true));
  btn.replaceWith(input);
  input.focus();
  input.select();
}

function ago(secs) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  // Server pushes a snapshot about every 3s, so under 6s is as fresh as it gets.
  if (s < 6) return "即時";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function setOfft(node) {
  const s = Math.max(0, Math.round((Number(node.dataset.until) - Date.now()) / 1000));
  node.textContent = `${node.dataset.off ? "⏰" : "⏻"} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function setAgo(node) {
  const { state, updated } = node.dataset;
  node.textContent = state ? `${state} · ${ago(Number(updated))}` : ago(Number(updated));
}

function common(tpl, n) {
  for (const a of tpl.querySelectorAll(".acct")) a.textContent = `Account ${n}`;
  const open = tpl.querySelector(".open");
  const remove = tpl.querySelector(".remove");
  open.setAttribute("aria-label", `Open account ${n}`);
  remove.setAttribute("aria-label", `Remove account ${n}`);
  remove.title = "Remove this profile";
  open.addEventListener("click", () => invoke("open_account", { n }));
  remove.addEventListener("click", () => invoke("remove_account", { n }));
}

function rosterCard(n, chars) {
  const tpl = $("roster").content.cloneNode(true);
  common(tpl, n);
  tpl.querySelector(".count").textContent = `${chars.length} 角色`;
  tpl.querySelector(".chars").append(...chars.map((c, i) => {
    const li = document.createElement("li");
    const who = el("div", "char-who");
    const nick = nicknames[c.name];
    who.append(el("span", "char-name", nick ? `${c.name}「${nick}」` : c.name));
    if (c.status) who.append(el("span", "char-status", `（${c.status}）`));
    if (c.detail) who.append(el("span", "char-detail", c.detail));
    who.title = [c.name, c.status, c.detail].filter(Boolean).join(" · ");
    const enter = Object.assign(el("button", "btn sm", "進入"), { type: "button" });
    enter.setAttribute("aria-label", `進入 ${c.name}`);
    enter.addEventListener("click", () => { enter.disabled = true; invoke("enter_character", { n, i }); });
    li.append(who, enter);
    return li;
  }));
  return tpl;
}

function emptyCard(n) {
  const tpl = $("empty").content.cloneNode(true);
  common(tpl, n);
  return tpl;
}

function card(n, info, othersIdling, why) {
  const tpl = $("card").content.cloneNode(true);
  const q = (sel) => tpl.querySelector(sel);
  const each = (sel, fn) => tpl.querySelectorAll(sel).forEach(fn);
  common(tpl, n);
  const section = q(".prow");
  const isOpen = expanded === n;

  const nick = nicknames[info.name];
  q(".name").textContent = info.name;
  q(".name").title = `${info.name}${nick ? `「${nick}」` : ""} · ${info.class ?? ""} · Account ${n} — click to copy name`;
  const nameEl = q(".name");
  nameEl.addEventListener("click", (e) => { e.stopPropagation(); copyName(nameEl, info.name); });
  if (info.assist) nameEl.after(Object.assign(el("span", "assist", "🛡"), { title: "輔助模式：本圖怪物被打才還手，換圖自動套用（右鍵選單可關閉）" }));
  const nickBtn = q(".nick");
  nickBtn.textContent = nick ?? "＋";
  nickBtn.classList.toggle("unset", !nick);
  nickBtn.setAttribute("aria-label", nick ? `Nickname ${nick}, click to edit` : `Add nickname for ${info.name}`);
  nickBtn.addEventListener("click", () => editNickname(nickBtn, info.name));
  const goal = goals[info.name];
  const rows = goalsFor(info.class);
  q(".cls").textContent = goal && goal !== info.class ? `${info.class ?? ""} → ${goalName(goal)}` : info.class ?? "";
  const sel = q(".goal");
  const opt = (text, value) => { const o = el("option", "", text); o.value = value; return o; };
  sel.append(opt("未設定", ""), ...rows.map((g) => opt(goalLabel(g), g[0])));
  if (goal && !rows.some((g) => g[0] === goal)) sel.append(opt(goalName(goal), goal));
  sel.value = goal ?? "";
  sel.setAttribute("aria-label", `Job direction for ${info.name}`);
  sel.addEventListener("focus", () => { editing = true; });
  sel.addEventListener("blur", () => { editing = false; });
  sel.addEventListener("change", () => { editing = false; invoke("set_goal", { name: info.name, goal: sel.value }); });
  q(".base").textContent = info.base ?? "–";
  q(".job").textContent = info.job ?? "–";

  const bp = pct(info.baseExp, info.baseExpNext);
  const jp = pct(info.jobExp, info.jobExpNext);
  const baseTxt = info.baseExpNext == null ? "MAX" : bp == null ? "–" : `${bp.toFixed(2)}%`;
  const jobTxt = info.jobExpNext == null ? "MAX" : jp == null ? "–" : `${jp.toFixed(2)}%`;
  each(".base-bar", (b) => setBar(b, info.baseExpNext == null ? 100 : bp));
  each(".job-bar", (b) => setBar(b, info.jobExpNext == null ? 100 : jp));
  q(".base-pct").textContent = baseTxt;
  q(".job-pct").textContent = jobTxt;

  const hpP = pct(info.hp, info.maxHp);
  const lowHp = info.hp != null && info.maxHp && info.hp * 4 < info.maxHp;
  each(".hp-bar", (b) => { setBar(b, hpP); b.classList.toggle("low", !!lowHp); });
  each(".sp-bar", (b) => setBar(b, pct(info.sp, info.maxSp)));
  q(".hp").textContent = `${fmt(info.hp)} / ${fmt(info.maxHp)}`;
  q(".sp").textContent = `${fmt(info.sp)} / ${fmt(info.maxSp)}`;
  q(".minibars").title =
    `HP ${fmt(info.hp)} / ${fmt(info.maxHp)} · SP ${fmt(info.sp)} / ${fmt(info.maxSp)} · Base EXP ${baseTxt}`;

  const wp = pct(info.weight, info.weightMax);
  const heavy = wp != null && wp >= 50;
  q(".weight").textContent = `負重 ${fmt(info.weight)} / ${fmt(info.weightMax)}${wp == null ? "" : `（${Math.floor(wp)}%）`}`;
  q(".weight").classList.toggle("heavy", heavy);
  q(".zeny").textContent = `Zeny：${fmt(info.zeny)}`;
  const pointsTxt = `尚有 ${info.points} 點屬性點可分配`;
  if (info.points > 0) {
    q(".points").hidden = false;
    q(".points").textContent = pointsTxt;
  }

  each(".map", (m) => { m.textContent = info.map ?? "–"; });
  each(".map-link", (b) => {
    if (info.map) {
      b.addEventListener("click", () => invoke("open_atlas", { q: info.map }));
      b.title = `${info.map} — show spawns in the map atlas`;
      b.setAttribute("aria-label", `地圖 ${info.map}: show spawns in the map atlas`);
    } else b.disabled = true;
  });
  q(".action").textContent = info.action ?? "–";
  q(".battle-link").addEventListener("click", () => invoke("open_battle", { name: info.name }));
  const t = info.target;
  q(".target").textContent = t ? `${t.name}${t.lv == null ? "" : ` Lv.${t.lv}`}` : "無";
  if (t && t.maxHp) {
    q(".target-track").hidden = false;
    setBar(q(".target-bar"), pct(t.hp, t.maxHp));
  }

  const running = info.running === true;
  const state = info.stopping ? "停止中" : running ? "掛機中" : "已停止";
  section.classList.add(info.stopping ? "is-wait" : running ? "is-on" : info.running === false ? "is-off" : "is-unknown");
  // A character sitting idle while the rest grind is usually a mistake.
  if (info.running === false && !info.stopping && othersIdling) {
    section.classList.add("alert");
    section.title = "已停止 while other characters are idling";
  }

  // Attention chips: compact, each with a full-text tooltip.
  const flags = q(".flags");
  const chip = (cls, text, title) => {
    const c = el("span", `chip ${cls}`, text);
    c.title = title;
    c.setAttribute("aria-label", title);
    flags.append(c);
  };
  if (info.points > 0) chip("pts", `+${info.points}`, pointsTxt);
  if (lowHp) chip("hp", "HP", `HP ${fmt(info.hp)} / ${fmt(info.maxHp)}（低於 25%）`);
  if (heavy) chip("wt", `重${Math.floor(wp)}%`, q(".weight").textContent);

  each(".ago", (a) => { a.dataset.updated = info.updated; });
  const dAgo = q(".status .ago");
  dAgo.dataset.state = state;
  each(".ago", setAgo);
  const status = q(".status");
  status.classList.toggle("on", running && !info.stopping);
  status.classList.toggle("wait", !!info.stopping);
  const dot = q(".dot");
  dot.title = `${state} · 按此切換 Online / Offline`;
  dot.setAttribute("aria-label", `${dot.title}（${info.name}）`);
  dot.addEventListener("click", (e) => { e.stopPropagation(); invoke("toggle_online", { n }); });

  if (why) {
    section.classList.add("attn");
    q(".why").hidden = false;
    q(".why").textContent = why;
  }
  const ask = q(".ask");
  ask.setAttribute("aria-label", `問 ${info.name} 的助理`);
  ask.addEventListener("click", (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent("ask-character", { detail: info.name })); });

  const go = q(".go");
  go.setAttribute("aria-label", `Open game window（${info.name}）`);
  go.addEventListener("click", () => invoke("open_account", { n }));

  const idle = q(".idle");
  const waiting = (pending.get(n) ?? 0) > Date.now();
  const label = info.stopping ? "停止中・按此繼續掛機" : running ? "停止掛機" : "開始掛機";
  idle.classList.toggle("running", running && !info.stopping);
  idle.classList.toggle("stopping", !!info.stopping);
  idle.setAttribute("aria-pressed", String(running));
  idle.textContent = info.stopping ? "⏳" : running ? "■" : "▶";
  idle.title = label;
  idle.setAttribute("aria-label", `${label}（${info.name}）`);
  idle.disabled = waiting || info.running == null;
  idle.addEventListener("click", () => {
    pending.set(n, Date.now() + 4000);
    idle.disabled = true;
    invoke("toggle_idle", { n });
    setTimeout(refresh, 4100);
  });

  // Hover (or keyboard focus) shows the detail as a floating popup beside the card.
  const lvl = q(".lvl");
  const detail = q(".detail");
  lvl.title = "Show details";
  lvl.setAttribute("aria-label", `Base Lv ${info.base ?? "–"}, Job Lv ${info.job ?? "–"}. ${lvl.title}`);
  const host = $("popover");
  const show = (open) => {
    expanded = open ? n : expanded === n ? null : expanded;
    detail.hidden = !open;
    if (open) host.replaceChildren(detail);
    else if (detail.parentNode === host) host.replaceChildren();
    section.classList.toggle("peek", open);
    lvl.setAttribute("aria-expanded", String(open));
    if (open) requestAnimationFrame(() => placePopup(section, detail));
  };
  show(isOpen);
  // Short grace period so the pointer can cross the gap into the popup (a child of the card).
  let hideTimer;
  const inside = (node) => section.contains(node) || detail.contains(node);
  const hovered = () => section.matches(":hover") || detail.matches(":hover");
  const later = () => { hideTimer = setTimeout(() => { if (!inside(document.activeElement) && !hovered()) show(false); }, 150); };
  section.addEventListener("mouseenter", () => { clearTimeout(hideTimer); show(true); });
  section.addEventListener("mouseleave", later);
  detail.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  detail.addEventListener("mouseleave", later);
  section.addEventListener("focusin", () => show(true));
  for (const el of [section, detail]) el.addEventListener("focusout", (e) => { if (!inside(e.relatedTarget) && !hovered()) show(false); });
  return tpl;
}

// Offline = game page closed; the card keeps the last data it saw, greyed out.
function markOffline(box) {
  box.classList.remove("is-on", "is-wait", "is-off", "alert");
  box.classList.add("offline");
  box.title = "Offline: background game page closed. Right-click to go online.";
  const status = box.querySelector(".status .ago");
  if (status) { status.dataset.state = "離線"; setAgo(status); }
  box.querySelector(".status")?.classList.remove("on", "wait");
  box.querySelector(".dot")?.classList.add("off");
  const name = box.matches(".empty") && box.querySelector(".name");
  if (name) name.textContent = "離線";
  box.querySelectorAll(".idle, .enter, .char-list button").forEach((b) => { b.disabled = true; });
}

// The panel is too narrow to sit beside a row, so the popup goes under it (above if no room), right-aligned.
function placePopup(card, pop) {
  const r = card.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight, gap = 4;
  const left = Math.max(4, Math.min(r.right - w, innerWidth - w - 4));
  const top = r.bottom + gap + h <= innerHeight - 4 ? r.bottom + gap : r.top - gap - h;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(4, top)}px`;
}

function setBar(node, value) {
  node.style.width = value == null ? "0%" : `${value}%`;
}

async function refresh() {
  if (editing || dragging != null) return;
  const state = await invoke("get_state");
  nicknames = state.nicknames ?? {};
  goals = state.goals ?? {};
  const list = $("list");
  const live = state.profiles.filter((p) => !p.offline);
  const idling = live.filter((p) => p.info?.running).length;
  syncIdleAll(live);
  const scroll = list.scrollTop;
  // Popups belong to the rows being replaced; the expanded row puts its own back.
  $("popover").replaceChildren();
  const o = overview(state.profiles);
  lastOrder = state.profiles.map((p) => p.n);
  const listed = state.profiles.filter((p) => shown(p, filter, o.reasons));
  const build = (p) => {
    const frag = p.roster?.length ? rosterCard(p.n, p.roster)
      : !p.info ? emptyCard(p.n)
      : card(p.n, p.info, !p.offline && idling - (p.info.running ? 1 : 0) > 0, o.reasons.get(p.n));
    const box = frag.firstElementChild;
    box.dataset.n = p.n;
    box.addEventListener("contextmenu", (e) => { e.preventDefault(); invoke("profile_menu", { n: p.n }); });
    if (p.offline) markOffline(box);
    const t = box.querySelector(".offt");
    // Offline rows count down to the hourly wake. Online rows go offline 1 min after their
    // game window closes; that countdown is not shown.
    if (t && p.offline) {
      t.dataset.until = Date.now() + state.wakeIn * 1000;
      t.dataset.off = "1";
      t.title = "自動上線倒數（每小時喚醒一次）";
      setOfft(t);
    }
    box.draggable = true;
    return box;
  };
  const boxes = listed.map(build);
  const attn = listed.filter((p, i) => boxes[i].classList.contains("attn")).map(build);
  list.replaceChildren(...ledger(boxes, attn));
  list.scrollTop = scroll;

  const signed = live.filter((p) => p.info);
  const stopped = signed.filter((p) => p.info.running === false && !p.info.stopping).length;
  const off = state.profiles.length - live.length;
  const counts = `${state.profiles.length} profiles · ${signed.length} signed in · ${idling} idling${off ? ` · ${off} offline` : ""}`;
  $("summary").textContent = o.map ? `全部在 ${o.map} · ${counts}` : counts;
  $("summary").title = counts;
  for (const t of document.querySelectorAll("[data-filter]")) {
    const f = t.dataset.filter;
    t.querySelector("b").textContent = String(o.counts[f]);
    t.setAttribute("aria-pressed", String(filter === f));
  }
  const overall = $("overall");
  overall.hidden = signed.length === 0;
  overall.className = `pill ${stopped ? "warn" : "ok"}`;
  overall.textContent = stopped ? `${stopped} 已停止` : "全部掛機中";
  overall.title = stopped ? `${stopped} signed-in character(s) not idling` : "All signed-in characters are idling";
  $("version").textContent = `v${state.version}`;
  $("version").title = `RO Idle Tray v${state.version} · labels update live`;
  $("login").setAttribute("aria-pressed", String(state.autostart));
  $("pin").setAttribute("aria-pressed", String(!!state.pinned));
  const update = $("update");
  update.hidden = !state.update;
  update.textContent = state.update ? `Update to v${state.update}` : "";
}

// One view: the compact list at the panel's normal width.
$("list").classList.add("ledger");
invoke("set_panel_width", { width: 360 });
for (const t of document.querySelectorAll("[data-filter]")) t.addEventListener("click", () => {
  filter = filter === t.dataset.filter ? "all" : t.dataset.filter;
  $("list").scrollTop = 0;
  refresh();
});

// Drag a profile onto another to reorder; order is saved by the app.
const list = $("list");
const clearMarks = () => list.querySelectorAll(".drop-before, .drop-after, .dragging, .drop-into")
  .forEach((x) => x.classList.remove("drop-before", "drop-after", "dragging", "drop-into"));
const after = (box, e) => {
  const r = box.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
};
list.addEventListener("dragstart", (e) => {
  const box = e.target.closest?.("[data-n]");
  if (!box || e.target.closest("input")) return e.preventDefault();
  dragging = Number(box.dataset.n);
  box.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(dragging));
});
list.addEventListener("dragover", (e) => {
  if (dragging == null) return;
  const box = e.target.closest?.("[data-n]");
  if (box?.closest(".attn-sec")) return;
  // Board: empty space in a column drops at its end.
  const col = !box && e.target.closest?.(".col");
  if (!col && (!box || Number(box.dataset.n) === dragging)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  list.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-into"));
  if (col) col.classList.add("drop-into");
  else box.classList.add(after(box, e) ? "drop-after" : "drop-before");
});
list.addEventListener("drop", (e) => {
  const moved = list.querySelector(`.col [data-n="${dragging}"]`);
  if (dragging == null || !moved) return;
  const box = e.target.closest?.("[data-n]");
  const col = !box && e.target.closest?.(".col");
  if (col) col.querySelector(".sec-body").append(moved);
  else if (box && box !== moved) box[after(box, e) ? "after" : "before"](moved);
  else return;
  e.preventDefault();
  saveLayout();
});
list.addEventListener("dragend", () => {
  clearMarks();
  dragging = null;
  refresh();
});

$("login").addEventListener("click", () => invoke("set_login"));
$("pin").addEventListener("click", (e) => invoke("set_pinned", { pinned: e.currentTarget.getAttribute("aria-pressed") !== "true" }));
$("panel-hide").addEventListener("click", () => invoke("hide_panel"));
$("quit").addEventListener("click", () => invoke("quit"));
$("add").addEventListener("click", () => invoke("add_account"));
// Recall stops everyone idling, so the first click only arms it for 3 s.
$("recall").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (b.dataset.armed) {
    delete b.dataset.armed;
    b.textContent = "…";
    invoke("recall_all").then((rs) => {
      const bad = rs.filter((r) => r.error);
      b.textContent = `回城 ${rs.length - bad.length}/${rs.length}`;
      b.title = bad.map((r) => `${r.name}: ${r.error}`).join("\n") || "All recalled";
    }, (err) => { b.textContent = "回城失敗"; b.title = String(err); })
      .finally(() => setTimeout(() => { b.textContent = "Recall"; }, 5000));
    return;
  }
  b.dataset.armed = "1"; b.textContent = "確定回城？";
  setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "Recall"; } }, 3000);
});
// Idle All toggle: start every stopped in-play character; if none are stopped, stop them all.
let idleAllTargets = [];
function syncIdleAll(live) {
  const ready = live.filter((p) => p.info && p.info.running != null && !p.info.stopping && !((pending.get(p.n) ?? 0) > Date.now()));
  const stopped = ready.filter((p) => !p.info.running);
  const stop = !stopped.length && ready.length > 0;
  idleAllTargets = (stop ? ready : stopped).map((p) => p.n);
  const b = $("idle-all");
  b.textContent = stop ? "Stop All" : "Idle All";
  b.setAttribute("aria-pressed", String(stop));
  b.disabled = !idleAllTargets.length;
}
$("idle-all").addEventListener("click", (e) => {
  e.currentTarget.disabled = true;
  for (const n of idleAllTargets) { pending.set(n, Date.now() + 4000); invoke("toggle_idle", { n }); }
  setTimeout(refresh, 4100);
});
$("refresh").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  const n = await invoke("refresh_all").catch(() => 0);
  setTimeout(() => { b.disabled = false; }, n * 5000);
});
$("items").addEventListener("click", () => invoke("open_items"));
$("maps").addEventListener("click", () => invoke("open_atlas", { q: null }));
$("classes").addEventListener("click", () => invoke("open_classes"));
$("guide").addEventListener("click", () => invoke("open_guide"));
$("exports").addEventListener("click", () => invoke("open_export_folder"));
$("update").addEventListener("click", () => invoke("update_app"));
// AI provider settings. The key is write-only here: Rust encrypts it in the
// app config dir and only reports whether one is saved.
function aiShow(open) {
  if (open) { showPanel("ai"); aiLoad(); } else closeSettings();
}
function aiFill(s) {
  $("ai-url").value = s.baseUrl;
  aiRevealModel(s.model);
  $("ai-format").value = s.format ?? "auto";
  $("ai-key").value = "";
  $("ai-key").placeholder = s.hasKey ? "•••••••• (leave blank to keep)" : "Paste key";
  $("ai-keystate").hidden = !s.hasKey;
  $("ai-tavily-key").value = "";
  $("ai-tavily-key").placeholder = s.hasTavilyKey ? "•••••••• (leave blank to keep)" : "tvly-… (optional)";
  $("ai-tavily-state").hidden = !s.hasTavilyKey;
}
// The model picker is a shadcn-style combobox: a trigger showing the current
// model and a searchable list. `aiModelValue` is the source of truth; the
// hidden input keeps the save/test calls unchanged.
let aiModels = [];
let aiModelValue = "";
let aiModelActive = -1;
let aiModelFiltered = [];

function aiModelCandidates() {
  // A saved name the provider no longer offers stays selectable.
  return aiModelValue && !aiModels.includes(aiModelValue) ? [aiModelValue, ...aiModels] : aiModels;
}
function aiRevealModel(value) {
  const v = String(value ?? "").trim();
  aiModelValue = v;
  $("ai-model").value = v;
  const label = $("ai-model-value");
  label.textContent = v || "Select a model…";
  label.classList.toggle("placeholder", !v);
  aiRenderModels();
}
function aiRenderModels() {
  const query = $("ai-model-search").value.trim().toLowerCase();
  const all = aiModelCandidates();
  aiModelFiltered = query ? all.filter((m) => m.toLowerCase().includes(query)) : all;
  const selected = aiModelValue;
  const list = $("ai-model-list");
  list.replaceChildren(...aiModelFiltered.map((m, i) => {
    const item = document.createElement("li");
    item.id = `ai-model-opt-${i}`;
    item.className = "ai-combo-item";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(m === selected));
    item.dataset.value = m;
    item.dataset.active = String(i === aiModelActive);
    const text = document.createElement("span");
    text.className = "ai-combo-item-text";
    text.textContent = m;
    const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    check.setAttribute("viewBox", "0 0 24 24");
    check.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m20 6-11 11-5-5");
    check.append(path);
    item.append(text, check);
    item.addEventListener("click", () => aiChooseModel(m));
    item.addEventListener("mousemove", () => aiHighlightModel(i));
    return item;
  }));
  $("ai-model-empty").hidden = aiModelFiltered.length > 0;
  $("ai-model-search").setAttribute(
    "aria-activedescendant",
    aiModelActive >= 0 && aiModelFiltered[aiModelActive] ? `ai-model-opt-${aiModelActive}` : ""
  );
}
function aiHighlightModel(index) {
  if (index === aiModelActive) return;
  aiModelActive = index;
  for (const [i, item] of [...$("ai-model-list").children].entries()) {
    item.dataset.active = String(i === index);
  }
  const active = $("ai-model-list").children[index];
  if (active) active.scrollIntoView({ block: "nearest" });
  $("ai-model-search").setAttribute(
    "aria-activedescendant",
    active ? active.id : ""
  );
}
function aiChooseModel(value) {
  aiRevealModel(value);
  aiOpenModels(false);
  $("ai-model-trigger").focus();
}
function aiOpenModels(open) {
  const trigger = $("ai-model-trigger");
  $("ai-model-pop").hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  if (!open) {
    aiModelActive = -1;
    $("ai-model-search").value = "";
    aiRenderModels();
    return;
  }
  const search = $("ai-model-search");
  search.value = "";
  aiModelActive = Math.max(0, aiModelCandidates().indexOf(aiModelValue));
  aiRenderModels();
  const active = $("ai-model-list").children[aiModelActive];
  if (active) active.scrollIntoView({ block: "nearest" });
  search.focus();
}
$("ai-model-trigger").addEventListener("click", () => aiOpenModels($("ai-model-pop").hidden));
$("ai-model-search").addEventListener("input", () => {
  aiModelActive = 0;
  aiRenderModels();
  if (aiModelFiltered.length === 1) aiHighlightModel(0);
});
$("ai-model-search").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (aiModelFiltered.length === 0) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = (aiModelActive + step + aiModelFiltered.length) % aiModelFiltered.length;
    aiHighlightModel(next);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const value = aiModelFiltered[aiModelActive];
    if (value) aiChooseModel(value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    aiOpenModels(false);
    $("ai-model-trigger").focus();
  } else if (e.key === "Tab") {
    aiOpenModels(false);
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!$("ai-model-pop").hidden && !$("ai-model-combo").contains(e.target)) aiOpenModels(false);
});

// Ask the provider for its valid models and show them in the picker,
// preferring the saved model and otherwise picking the first valid one.
let aiModelsRequest = 0;
async function aiLoadModels() {
  const token = ++aiModelsRequest;
  const hint = $("ai-model-hint");
  const saved = aiModelValue;
  hint.textContent = "Loading models…";
  try {
    const models = await invoke("ai_list_models");
    if (token !== aiModelsRequest) return;
    aiModels = models;
    if (models.includes(saved)) {
      aiRevealModel(saved);
      hint.textContent = `${models.length} model${models.length === 1 ? "" : "s"} available.`;
    } else {
      aiRevealModel(models[0]);
      hint.textContent = saved
        ? `“${saved}” is not offered; selected “${models[0]}”. Save to keep it.`
        : `Selected “${models[0]}”.`;
    }
  } catch (e) {
    if (token !== aiModelsRequest) return;
    aiRevealModel(saved);
    hint.textContent = `Could not list models: ${e} — keeping the saved name.`;
  }
}
function aiResult(kind, text) {
  const r = $("ai-result");
  r.hidden = false;
  r.className = `ai-result ${kind}`;
  r.textContent = text;
}
async function aiLoad() {
  $("ai-result").hidden = true;
  try {
    aiFill(await invoke("ai_get_settings"));
    await aiLoadModels();
  } catch (e) { aiResult("err", String(e)); }
}
async function aiSave() {
  const s = await invoke("ai_save_settings", {
    baseUrl: $("ai-url").value,
    model: $("ai-model").value,
    apiKey: $("ai-key").value || null,
    tavilyKey: $("ai-tavily-key").value || null,
    format: $("ai-format").value,
  });
  aiFill(s);
  return s;
}
async function aiBusy(btn, label, work) {
  const was = btn.textContent;
  document.querySelectorAll(".ai-btn").forEach((b) => (b.disabled = true));
  btn.textContent = label;
  try { await work(); } catch (e) { aiResult("err", String(e)); } finally {
    document.querySelectorAll(".ai-btn").forEach((b) => (b.disabled = false));
    btn.textContent = was;
  }
}
$("ai-open").addEventListener("click", () => aiShow($("ai").hidden));
$("ai-close").addEventListener("click", () => aiShow(false));
$("ai-model-refresh").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  try { await aiLoadModels(); } finally {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
});
$("ai-save").addEventListener("click", (e) => aiBusy(e.currentTarget, "Saving…", async () => {
  const s = await aiSave();
  aiResult("ok", s.hasTavilyKey ? "Saved · web search enabled" : "Saved");
  // Refresh the valid list for the saved provider without holding up "Saved".
  aiLoadModels().catch(() => {});
}));
$("ai-test").addEventListener("click", (e) => aiBusy(e.currentTarget, "Testing…", async () => {
  await aiSave();
  const r = await invoke("ai_test_connection");
  const cache = r.caching == null ? "unknown (proxy reports no cache usage)" : r.caching ? "works" : "not working";
  if (r.ok) aiResult("ok", `OK · ${r.model}\nPrompt caching: ${r.message === "OK" ? cache : r.message}`);
  else aiResult("err", r.message);
  // The tested provider may be new; refresh its valid model list.
  if (r.ok) aiLoadModels().catch(() => {});
}));

listen("state-changed", refresh);
setInterval(refresh, 30000);
// Tick the "Ns ago" labels every second without re-rendering rows.
setInterval(() => {
  document.querySelectorAll(".ago[data-updated]").forEach(setAgo);
  document.querySelectorAll(".offt[data-until]").forEach(setOfft);
}, 1000);
groupsReady.then(refresh);

// More menu: close after picking an item or clicking anywhere else.
$("more").addEventListener("click", (e) => { if (e.target.closest(".menu button")) $("more").open = false; });
document.addEventListener("click", (e) => { if (!e.target.closest("#more")) $("more").open = false; });
