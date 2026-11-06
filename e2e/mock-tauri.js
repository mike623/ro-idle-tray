// Stand-in for window.__TAURI__ so the app's own windows run in a plain browser for the
// demo recordings (e2e/record.mjs). Every character, account and number here is made up.
(() => {
  // bubble.js mounts the assistant in a closed shadow root; open it so Playwright can click inside.
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: "open" }); };

  const now = () => Math.floor(Date.now() / 1000);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const char = (name, cls, base, job, map, extra = {}) => ({
    name, class: cls, base, job, map, updated: now(), running: true, stopping: false,
    baseExp: 412000 + base * 900, baseExpNext: 1_000_000, jobExp: 61000, jobExpNext: 140000,
    hp: 4200, maxHp: 5100, sp: 310, maxSp: 420, weight: 1240, weightMax: 3400, zeny: 284500, points: 0,
    action: "戰鬥中", target: { name: "狼", lv: 45, hp: 610, maxHp: 1219 }, ...extra,
  });
  const map = "妙勒妙勒尼山脈 南邊山麓";
  const state = {
    version: "0.2.7", autostart: true, pinned: false, update: /update/.test(location.search) ? "0.2.8" : null, wakeIn: 2412,
    nicknames: { 伊莉絲: "主坦" }, goals: { 伊莉絲: "騎士領主", 小雪: "神官" },
    profiles: [
      { n: 1, info: char("伊莉絲", "騎士", 78, 45, map, { assist: "defend" }) },
      { n: 2, info: char("小雪", "祭司", 74, 41, map, { hp: 3020, maxHp: 3330, sp: 880, maxSp: 1020, target: null, action: "支援" }) },
      { n: 3, info: char("阿凱", "獵人", 71, 40, map, { running: false, action: "待機", target: null }) },
      { n: 4, info: char("米亞", "巫師", 69, 38, map, { hp: 610, maxHp: 2900, points: 4 }) },
      { n: 5, offline: true, info: char("鐵柱", "鐵匠", 66, 36, "普隆德拉原野 08", { running: false, target: null }) },
    ],
  };
  const listeners = new Map();
  const emit = (event, payload) => (listeners.get(event) ?? []).forEach((f) => f({ event, payload }));
  const byN = (n) => state.profiles.find((p) => p.n === n);
  const moved = (names) => names.map((name) => ({ name, error: null }));
  const live = () => state.profiles.filter((p) => !p.offline).map((p) => p.info.name);

  const groups = [{ name: "主力隊", members: [1, 2, 3, 4] }, { name: "小號", members: [5] }];
  try { localStorage.setItem("roIdleTray.groups", JSON.stringify(groups)); } catch {}

  const itemsFile = {
    exportedAt: Date.now() - 3_600_000,
    mergedFrom: ["伊莉絲", "小雪", "阿凱", "米亞"],
    characters: [{ name: "伊莉絲", class: "騎士" }, { name: "小雪", class: "祭司" }, { name: "阿凱", class: "獵人" }, { name: "米亞", class: "巫師" }],
    overrides: {},
    config: {
      lootPriority: { items: [909, 914, 938] }, autoStorage: { items: [914] }, autoSell: [938],
      hpPotion: { items: [501, 503] }, spPotion: { items: [505] }, buffPotion: { items: [] },
      restock: [{ itemId: 503, below: 20, qty: 100 }], townBuy: [{ itemId: 602, below: 1, qty: 5 }],
    },
  };

  const reply = [
    "**米亞** 在 `mjolnir_09` 一小時約 **11.8 萬** Base EXP，但過去 3 小時倒地 2 次，都是被 **狼** 圍攻時 HP 見底。",
    "",
    "巫師血量偏低，先補體質再回頭堆智力：",
    "> 建議改法",
    "> VIT +4",
    "> INT 70",
    "",
    "追問：換哪張圖比較安全？｜紅水要帶多少？",
  ].join("\n");
  const history = [];
  let saved = "claude-sonnet-5-5";
  const plan = { selected: [], note: "" };
  const memory = { count: 3, fact: "米亞走 INT/DEX 路線" };

  // The real right-click menu is native (lib.rs profile_menu). In the demo stage (e2e/tray.html)
  // the parent page draws a stand-in and posts the picked mode back here.
  let lastClick = { x: 0, y: 0 };
  addEventListener("contextmenu", (e) => { lastClick = { x: e.clientX, y: e.clientY }; }, true);
  addEventListener("message", ({ data }) => {
    if (!data?.assist) return;
    const i = byN(data.assist).info;
    i.assist = i.assist === data.mode ? undefined : data.mode;
    emit("state-changed");
  });

  const commands = {
    profile_menu: ({ n }) => { const p = byN(n); parent.postMessage({ menu: n, ...lastClick, offline: !!p.offline, assist: p.info.assist ?? null }, "*"); },
    get_state: () => structuredClone(state),
    get_groups: () => groups,
    toggle_idle: ({ n }) => { const i = byN(n).info; i.running = !i.running; i.action = i.running ? "戰鬥中" : "待機"; setTimeout(() => emit("state-changed"), 1200); },
    toggle_online: ({ n }) => { const p = byN(n); p.offline = !p.offline; emit("state-changed"); },
    recall_all: async () => { await wait(900); return moved(live()); },
    refresh_all: () => 1,
    atlas_characters: () => state.profiles.filter((p) => !p.offline).map((p) => ({ profile: p.n, name: p.info.name, map: p.info.map, running: p.info.running })),
    move_all: async () => { await wait(1400); return moved(live()); },
    move_selected: async ({ profiles }) => { await wait(1400); return moved(profiles.map((n) => byN(n).info.name)); },
    items_read: () => structuredClone(itemsFile),
    items_characters: () => state.profiles.map((p) => ({ name: p.info.name, class: p.info.class, nickname: state.nicknames[p.info.name] ?? "", goal: state.goals[p.info.name] ?? "" })),
    items_save: ({ file }) => { Object.assign(itemsFile, structuredClone(file)); },
    items_merge: async () => { await wait(800); return moved(itemsFile.mergedFrom); },
    items_apply: async () => { await wait(1500); return moved(itemsFile.mergedFrom); },
    chat_history: () => structuredClone(history),
    chat_memory: () => memory,
    chat_starters: async () => { await wait(500); return ["誰最需要調整配點？", "全隊該換哪張圖練？", "米亞為什麼一直倒地？"]; },
    // Real titles from ned-lin-9527.github.io/Ragnarok.
    chat_plan: () => ({ ...plan, suggested: ["ID巫師培養攻略", "巫師技能說明", "超魔導師技能說明"],
      pages: ["初心者一轉前培養攻略", "賢者培養攻略", "ID巫師培養攻略", "巫師技能說明", "超魔導師技能說明", "智者技能說明", "全輔助祭司培養攻略", "十字軍培養攻略"] }),
    chat_plan_set: ({ pages, note }) => Object.assign(plan, { selected: pages, note }),
    open_guide: ({ page }) => { guideWindow(page); },
    chat_alerts: () => ({ unread: 0, nudge: "" }),
    chat_alert_open: () => ({ ids: [] }),
    chat_new: () => { history.length = 0; },
    chat_send: async ({ text, onEvent }) => {
      await wait(500);
      for (const t of ["get_character 米亞", "get_log_summary 米亞", "game_lookup monsters 狼"]) { onEvent.onmessage({ kind: "tool", name: t }); await wait(350); }
      for (let i = 0; i < reply.length; i += 6) { onEvent.onmessage({ kind: "text", text: reply.slice(i, i + 6) }); await wait(28); }
      history.push({ role: "user", text }, { role: "assistant", text: reply, tools: ["get_character 米亞", "get_log_summary 米亞", "game_lookup monsters 狼"] });
      return structuredClone(history);
    },
    apply_stats: async ({ rows }) => { await wait(1300); return rows.map((r) => ({ stat: r.stat, target: r.add ? 30 + r.n : r.n })); },
    ai_get_settings: () => ({ baseUrl: "http://127.0.0.1:8317", model: "claude-sonnet-5-5", hasKey: true, hasTavilyKey: false, format: "auto" }),
    ai_save_settings: (a) => (saved = a.model, { baseUrl: a.baseUrl, model: a.model, hasKey: true, hasTavilyKey: false, format: a.format }),
    ai_list_models: async () => { await wait(400); return { models: ["claude-sonnet-5-5", "claude-opus-5-5", "gpt-5.4", "gemini-3-pro", "qwen3-coder"], contextTokens: { "claude-sonnet-5-5": 1000000, "claude-opus-5-5": 1000000, "gpt-5.4": 400000, "gemini-3-pro": 1048576 }, fallbackContextTokens: 128000 }; },
    ai_test_connection: async () => { await wait(1300); return { ok: true, model: saved, message: "OK", caching: true }; },
  };

  // ?guide: the assistant page is drawn as a 420px window, and open_guide shows the guide window
  // beside it on the same ned-lin-9527.github.io page the app opens (guide::page_url).
  const guideStage = /guide/.test(location.search);
  if (guideStage) addEventListener("DOMContentLoaded", () => {
    document.head.append(Object.assign(document.createElement("style"), { textContent: `
      html { background: radial-gradient(120% 90% at 70% 0%, #4a5d86, #26324a 60%, #1a2131) !important; }
      body { width: 420px !important; height: calc(100% - 32px) !important; margin: 16px !important; border-radius: 10px; overflow: hidden; box-shadow: 0 14px 40px #0007; background: #fff; }
      #guide-win { position: fixed; left: 452px; top: 16px; right: 16px; bottom: 16px; border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 14px 40px #0007;
        display: flex; flex-direction: column; opacity: 0; transform: scale(.97); transition: opacity .2s ease-out, transform .2s ease-out; }
      #guide-win.open { opacity: 1; transform: none; }
      #guide-win div { height: 28px; flex: none; display: grid; place-items: center; background: #e9e9ec; border-bottom: 1px solid #ccc; font: 13px -apple-system, system-ui, sans-serif; color: #333; }
      #guide-win iframe { border: 0; flex: 1; }` }));
    const w = Object.assign(document.createElement("section"), { id: "guide-win", innerHTML: "<div>攻略</div><iframe title=攻略></iframe>" });
    document.documentElement.append(w);
  });
  function guideWindow(page) {
    const w = document.getElementById("guide-win");
    if (!w) return;
    const base = "https://ned-lin-9527.github.io/Ragnarok/";
    w.querySelector("iframe").src = page ? `${base}guides/${encodeURIComponent(page)}.html` : `${base}index.html`;
    w.firstChild.textContent = page ?? "攻略";
    w.classList.add("open");
  }

  class Channel { onmessage = () => {}; }
  window.__TAURI__ = {
    core: {
      Channel,
      invoke: async (cmd, args = {}) => {
        const f = commands[cmd];
        return f ? f(args) : null; // window/menu commands (open_*, set_*) do nothing in the browser
      },
    },
    event: {
      listen: async (event, f) => { listeners.set(event, [...(listeners.get(event) ?? []), f]); return () => {}; },
    },
    window: { getCurrentWindow: () => ({ hide() {} }) },
  };
})();
