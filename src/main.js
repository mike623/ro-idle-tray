import { showPanel, closeSettings } from "./panel.js";
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
// "list" | "grid" | "board".
let view = "list";
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
  const body = el("div", "col-body");
  body.append(...boxes);
  col.append(head, body);
  return col;
}

function board(boxes) {
  const byN = new Map(boxes.map((b) => [Number(b.dataset.n), b]));
  const placed = new Set();
  const cols = groups.map((g) => g.members.map((n) => byN.get(n)).filter((b) => b && !placed.has(b) && placed.add(b)));
  cols[0].push(...boxes.filter((b) => !placed.has(b)));
  const wrap = el("div", "cols");
  const addCol = Object.assign(el("button", "add add-col", "＋"), { type: "button", title: "Add a group" });
  addCol.setAttribute("aria-label", "Add a group");
  addCol.addEventListener("click", () => {
    groups.push({ name: `群組 ${groups.length + 1}`, members: [] });
    saveGroups();
    refresh();
  });
  wrap.append(...groups.map((g, gi) => column(g, gi, cols[gi])), addCol);
  // list padding + columns (224 + 8 gap) + add button + scrollbar room.
  invoke("set_panel_width", { width: 60 + groups.length * 232 });
  return wrap;
}

// Save board membership and the overall order from what's on screen.
function saveLayout() {
  if (view === "board") {
    list.querySelectorAll(".col").forEach((col) => {
      groups[Number(col.dataset.g)].members = [...col.querySelectorAll(".col-body > [data-n]")].map((x) => Number(x.dataset.n));
    });
    saveGroups();
  }
  invoke("reorder_profiles", { order: [...list.querySelectorAll("[data-n]")].map((x) => Number(x.dataset.n)) });
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

function card(n, info, othersIdling) {
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
      b.setAttribute("aria-label", `地圖 ${info.map}: show spawns in the map atlas`);
    } else b.disabled = true;
  });
  q(".action").textContent = info.action ?? "–";
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
  q(".dot").title = state;

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
  const show = (open) => {
    expanded = open ? n : expanded === n ? null : expanded;
    detail.hidden = !open;
    section.classList.toggle("peek", open);
    lvl.setAttribute("aria-expanded", String(open));
    if (open) requestAnimationFrame(() => placePopup(section, detail));
  };
  show(isOpen);
  // Short grace period so the pointer can cross the gap into the popup (a child of the card).
  let hideTimer;
  section.addEventListener("mouseenter", () => { clearTimeout(hideTimer); show(true); });
  section.addEventListener("mouseleave", () => {
    hideTimer = setTimeout(() => { if (!section.contains(document.activeElement)) show(false); }, 150);
  });
  section.addEventListener("focusin", () => show(true));
  section.addEventListener("focusout", (e) => { if (!section.contains(e.relatedTarget) && !section.matches(":hover")) show(false); });
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

// Fixed position escapes the scrolling column; prefer the card's right side, else left.
function placePopup(card, pop) {
  const r = card.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight, gap = 6;
  let left = r.right + gap;
  if (left + w > innerWidth - 4) left = r.left - gap - w;
  left = Math.max(4, Math.min(left, innerWidth - w - 4));
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(4, Math.min(r.top, innerHeight - h - 4))}px`;
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
  const scroll = list.scrollTop;
  const boxes = state.profiles.map((p) => {
    const frag = p.roster?.length ? rosterCard(p.n, p.roster)
      : !p.info ? emptyCard(p.n)
      : card(p.n, p.info, !p.offline && idling - (p.info.running ? 1 : 0) > 0);
    const box = frag.firstElementChild;
    box.dataset.n = p.n;
    box.addEventListener("contextmenu", (e) => { e.preventDefault(); invoke("profile_menu", { n: p.n }); });
    if (p.offline) markOffline(box);
    box.draggable = true;
    return box;
  });
  if (view === "board") list.replaceChildren(board(boxes));
  else list.replaceChildren(...boxes);
  list.scrollTop = scroll;

  const signed = live.filter((p) => p.info);
  const stopped = signed.filter((p) => p.info.running === false && !p.info.stopping).length;
  const off = state.profiles.length - live.length;
  $("summary").textContent = `${state.profiles.length} profiles · ${signed.length} signed in · ${idling} idling${off ? ` · ${off} offline` : ""}`;
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

// List vs grid layout; remembered per machine.
function setView(v) {
  view = ["list", "grid", "board"].includes(v) ? v : "list";
  $("list").classList.toggle("grid", v === "grid");
  $("list").classList.toggle("board", v === "board");
  if (view !== "board") invoke("set_panel_width", { width: 360 });
  refresh();
  for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-selected", String(b.dataset.view === v));
  try { localStorage.setItem("roIdleTray.view", v); } catch {}
}
for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click", () => setView(b.dataset.view));
let savedView = "list";
try { savedView = localStorage.getItem("roIdleTray.view") || "list"; } catch {}
setView(savedView);

// Drag a profile onto another to reorder; order is saved by the app.
const list = $("list");
const clearMarks = () => list.querySelectorAll(".drop-before, .drop-after, .dragging, .drop-into")
  .forEach((x) => x.classList.remove("drop-before", "drop-after", "dragging", "drop-into"));
const after = (box, e) => {
  const r = box.getBoundingClientRect();
  // Half-width grid tiles sit side by side, so split them left/right; rows and board cards top/bottom.
  return view === "grid" && r.width < list.clientWidth * 0.75 ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
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
  const moved = list.querySelector(`[data-n="${dragging}"]`);
  if (dragging == null || !moved) return;
  const box = e.target.closest?.("[data-n]");
  const col = !box && e.target.closest?.(".col");
  if (col) col.querySelector(".col-body").append(moved);
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
$("items").addEventListener("click", () => invoke("open_items"));
$("maps").addEventListener("click", () => invoke("open_atlas", { q: null }));
$("classes").addEventListener("click", () => invoke("open_classes"));
$("guide").addEventListener("click", () => invoke("open_guide"));
$("exports").addEventListener("click", () => invoke("open_export_folder"));
$("update").addEventListener("click", () => invoke("update_app"));
// AI provider settings. The key is write-only here: Rust encrypts it in the
// app config dir and only reports whether one is saved.
function aiShow(open) {
  if (open) showPanel("ai"); else closeSettings();
  // Board view widens the panel; settings use the normal width.
  if (open) { invoke("set_panel_width", { width: 360 }); aiLoad(); }
  else setView(view);
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
setInterval(() => document.querySelectorAll(".ago[data-updated]").forEach(setAgo), 1000);
groupsReady.then(refresh);
