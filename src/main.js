const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString());
const pct = (v, max) => (v == null || !max ? null : Math.max(0, Math.min(100, (v / max) * 100)));
// Buttons stay disabled briefly after a start/stop click until the game confirms.
const pending = new Map();

function ago(secs) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function setBar(el, value) {
  el.style.width = value == null ? "0%" : `${value}%`;
}

function card(n, info) {
  const tpl = $(info ? "card" : "empty").content.cloneNode(true);
  const q = (sel) => tpl.querySelector(sel);
  q(".acct").textContent = `Account ${n}`;
  q(".open").addEventListener("click", () => invoke("open_account", { n }));
  q(".remove").addEventListener("click", () => invoke("remove_account", { n }));
  if (!info) return tpl;

  q(".name").textContent = info.name;
  q(".cls").textContent = info.class;
  q(".base").textContent = info.base;
  q(".job").textContent = info.job;
  const bp = pct(info.baseExp, info.baseExpNext);
  const jp = pct(info.jobExp, info.jobExpNext);
  setBar(q(".base-bar"), info.baseExpNext == null ? 100 : bp);
  setBar(q(".job-bar"), info.jobExpNext == null ? 100 : jp);
  q(".base-pct").textContent = info.baseExpNext == null ? "MAX" : bp == null ? "" : `${bp.toFixed(2)}%`;
  q(".job-pct").textContent = info.jobExpNext == null ? "MAX" : jp == null ? "" : `${jp.toFixed(2)}%`;

  setBar(q(".hp-bar"), pct(info.hp, info.maxHp));
  q(".hp-bar").classList.toggle("low", info.hp != null && info.maxHp && info.hp * 4 < info.maxHp);
  q(".hp").textContent = `${fmt(info.hp)} / ${fmt(info.maxHp)}`;
  setBar(q(".sp-bar"), pct(info.sp, info.maxSp));
  q(".sp").textContent = `${fmt(info.sp)} / ${fmt(info.maxSp)}`;

  const wp = pct(info.weight, info.weightMax);
  q(".weight").textContent = `負重 ${fmt(info.weight)} / ${fmt(info.weightMax)}${wp == null ? "" : `（${Math.floor(wp)}%）`}`;
  q(".weight").classList.toggle("heavy", wp != null && wp >= 50);
  q(".zeny").textContent = `Zeny：${fmt(info.zeny)}`;
  if (info.points > 0) {
    q(".points").hidden = false;
    q(".points").textContent = `尚有 ${info.points} 點屬性點可分配`;
  }

  q(".map").textContent = info.map ?? "–";
  q(".action").textContent = info.action ?? "–";
  const t = info.target;
  q(".target").textContent = t ? `${t.name}${t.lv == null ? "" : ` Lv.${t.lv}`}` : "無";
  if (t && t.maxHp) {
    q(".where .bar").hidden = false;
    setBar(q(".target-bar"), pct(t.hp, t.maxHp));
  }

  const idle = q(".idle");
  const running = info.running === true;
  const waiting = (pending.get(n) ?? 0) > Date.now();
  idle.classList.toggle("running", running);
  idle.setAttribute("aria-pressed", String(running));
  idle.textContent = info.stopping ? "⏳ 停止中・按此繼續掛機" : running ? "■ 停止掛機" : "▶ 開始掛機";
  idle.disabled = waiting || info.running == null;
  idle.addEventListener("click", () => {
    pending.set(n, Date.now() + 4000);
    idle.disabled = true;
    invoke("toggle_idle", { n });
    setTimeout(refresh, 4100);
  });

  const status = q(".status");
  status.classList.toggle("on", running && !info.stopping);
  status.classList.toggle("wait", info.stopping);
  status.querySelector("span").textContent =
    `${info.stopping ? "停止中" : running ? "掛機中" : "已停止"} · ${ago(info.updated)}`;
  return tpl;
}

async function refresh() {
  const state = await invoke("get_state");
  const list = $("list");
  list.replaceChildren(...state.profiles.map((p) => card(p.n, p.info)));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "add";
  add.textContent = "＋ Add Profile";
  add.addEventListener("click", () => invoke("add_account"));
  list.append(add);

  const signedIn = state.profiles.filter((p) => p.info).length;
  const idling = state.profiles.filter((p) => p.info?.running).length;
  $("summary").textContent = `${state.profiles.length} profiles · ${signedIn} signed in · ${idling} idling`;
  $("version").textContent = `RO Idle Tray v${state.version}`;
  $("login").setAttribute("aria-pressed", String(state.autostart));
  const update = $("update");
  update.hidden = !state.update;
  update.textContent = state.update ? `Update to v${state.update}` : "";
}

$("login").addEventListener("click", () => invoke("set_login"));
$("quit").addEventListener("click", () => invoke("quit"));
$("exports").addEventListener("click", () => invoke("open_export_folder"));
$("update").addEventListener("click", () => invoke("update_app"));
listen("state-changed", refresh);
setInterval(refresh, 30000);
refresh();
