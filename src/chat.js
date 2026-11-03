import { showPanel } from "./panel.js";
const { invoke, Channel } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);
const node = (tag, cls, text = "") => Object.assign(document.createElement(tag), { className: cls, textContent: text });
let busy = false;
let loaded = false;
let characters = [];
let groupContext = "";
// null = the global assistant; a name = that character's own chat (same thread as its game bubble).
let scope = null;
function error(text = "") { $("chat-error").textContent = text; $("chat-error").hidden = !text; }
function scroll() { $("chat-messages").scrollTop = $("chat-messages").scrollHeight; }
const TOOL_LABELS = {list_characters:"角色列表",get_character:"角色狀態",get_log_summary:"讀取紀錄",game_lookup:"查詢資料",guide_lookup:"查詢攻略",rank_maps:"地圖排名",remember:"記住",update_memory:"更新記憶",forget:"忘記",recall:"回想"};
// Tool calls fold into one line ("⌕ 9 次查詢：讀取紀錄 ×8、角色列表"); open it for the full calls.
function toolList(tools) {
  const box = node("details", "chat-tools");
  const summary = node("summary", "dim tiny");
  const chips = node("div", "row");
  box.append(summary, chips);
  const seen = [];
  const add = (call) => {
    seen.push(call);
    chips.append(node("span", "chat-chip", call));
    const counts = new Map();
    for (const c of seen) { const name = c.split(/\s/)[0]; counts.set(name, (counts.get(name) ?? 0) + 1); }
    summary.textContent = `⌕ ${seen.length} 次查詢：${[...counts].map(([n, k]) => `${TOOL_LABELS[n] ?? n}${k > 1 ? ` ×${k}` : ""}`).join("、")}`;
    box.hidden = false;
  };
  box.hidden = true;
  tools.forEach(add);
  return { box, add };
}
function card(role, text, tools = []) {
  const box = node("article", `chat-card chat-${role}`);
  box.append(node("b", "dim", role === "user" ? "你" : role === "error" ? "連線錯誤" : "✦ 助理"));
  const body = node("div", "chat-body", text);
  const chips = toolList(tools);
  box.append(body, chips.box);
  $("chat-messages").append(box);
  return { box, body, chips };
}
function render(rows) {
  $("chat-messages").replaceChildren();
  for (const r of rows) if (!r.message && r.role !== "summary" && r.text) card(r.role, r.text, r.tools);
  if (!$("chat-messages").childElementCount) card("assistant", scope ? `想了解 ${scope} 的狀態或戰鬥紀錄嗎？` : "我可以讀取角色狀態與戰鬥紀錄。想先了解誰的近況？");
  scroll();
}
async function roster() {
  const state = await invoke("get_state");
  const signed = state.profiles.filter((p) => p.info);
  characters = signed.map((p) => p.info.name);
  let groups = [];
  try { groups = JSON.parse(localStorage.getItem("roIdleTray.groups")) ?? []; } catch {}
  if (!Array.isArray(groups)) groups = [];
  const assigned = new Set();
  const labels = [];
  const context = [];
  for (const g of groups) {
    if (typeof g?.name !== "string" || !Array.isArray(g.members)) continue;
    const members = signed.filter((p) => g.members.includes(p.n));
    if (!members.length) continue;
    members.forEach((p) => assigned.add(p.n));
    labels.push(node("span", "chat-chip", `${g.name} · ${members.length} 人`));
    context.push({group:g.name, characters:members.map((p) => p.info.name)});
  }
  const novices = signed.filter((p) => /初學者/.test(p.info.class ?? ""));
  const solo = signed.filter((p) => !assigned.has(p.n));
  if (novices.length) labels.push(node("span", "chat-chip", `初心者 · ${novices.length} 人`));
  if (solo.length) labels.push(node("span", "chat-chip", `單練 · ${solo.length} 人`));
  labels.push(...signed.map(({info:c}) => node("span", "chat-chip", `${c.name} · Lv${c.base ?? "?"} · ${c.running ? "掛機中" : "已停止"}`)));
  groupContext = JSON.stringify(context);
  while (new TextEncoder().encode(groupContext).length > 2000) {
    context.pop(); groupContext = JSON.stringify(context);
  }
  $("chat-status").replaceChildren(...labels);
  const idling = signed.filter((p) => p.info.running).length;
  $("chat-roster-sum").textContent = `${signed.length} 角色 · ${idling} 掛機中${groups.length ? ` · ${context.length} 群組` : ""}`;
}
async function memory() {
  const info = await invoke("chat_memory", { character: scope });
  $("chat-memory").textContent = `已記住 ${info.count} 則${info.fact ? ` · ${info.fact}` : ""}`;
}
async function show(assistant, character = null) {
  if (assistant && character !== scope) {
    if (busy) { showPanel("assistant"); error("回答中，請稍候再切換"); return; }
    scope = character; loaded = false; error();
  }
  showPanel(assistant ? "assistant" : "list");
  if (!assistant) return;
  $("chat-title").textContent = scope ? `✦ ${scope}` : "✦ 助理";
  $("chat-all").hidden = !scope;
  $("chat-roster").hidden = !!scope;
  $("chat-input-label").textContent = scope ? `問 ${scope} 的事` : "詢問角色近況 · @ 選擇角色";
  try {
    await roster();
    await memory();
    if (!loaded) { render(await invoke("chat_history", { character: scope })); loaded = true; }
    $("chat-input").focus();
  } catch (e) { error(String(e)); }
}
$("assistant-fab").addEventListener("click", () => show($("assistant").hidden || scope !== null, null));
$("chat-all").addEventListener("click", () => show(true, null));
// A row's ✦ button in the character list.
document.addEventListener("ask-character", (e) => show(true, e.detail));
$("chat-close").addEventListener("click", () => { show(false); $("assistant-fab").focus(); });
$("assistant").addEventListener("keydown", (e) => { if (e.key === "Escape") { show(false); $("assistant-fab").focus(); } });
function setBusy(value) {
  busy = value;
  $("chat-send").disabled = value;
  $("chat-new").disabled = value;
  $("chat-input").disabled = value;
  $("chat-send").textContent = value ? "回答中…" : "送出";
}
$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("chat-input").value.trim();
  if (!text || busy) return;
  setBusy(true); error();
  card("user", text);
  const answer = card("assistant", "讀取中…");
  let content = "";
  const onEvent = new Channel();
  onEvent.onmessage = (event) => {
    if (event.kind === "text") { content += event.text; answer.body.textContent = content; }
    if (event.kind === "tool") answer.chips.add(event.name);
    scroll();
  };
  try {
    render(await invoke("chat_send", { text, character: scope, groups: scope ? null : groupContext, onEvent }));
    await memory();
    $("chat-input").value = "";
  } catch (e) {
    error(String(e));
    // Reload disk truth, including partial failures, without leaving an invented answer onscreen.
    try { render(await invoke("chat_history", { character: scope })); } catch { answer.box.remove(); }
  } finally { setBusy(false); $("chat-input").focus(); }
});
$("chat-new").addEventListener("click", async () => {
  if (busy) return;
  try { await invoke("chat_new", { character: scope }); render([]); error(); $("chat-input").focus(); }
  catch (e) { error(String(e)); }
});
for (const text of ["誰的狀況最差？", "今晚怎麼排？", "最近為什麼死亡？"]) {
  const button = node("button", "btn", text);
  button.type = "button";
  button.addEventListener("click", () => { if (!busy) { $("chat-input").value = text; $("chat-input").focus(); } });
  $("chat-suggestions").append(button);
}

// Complete the @ fragment at the caret without replacing the surrounding question.
const mentions = node("div", "row");
mentions.id = "chat-mentions";
mentions.setAttribute("aria-label", "角色名稱建議");
$("chat-form").before(mentions);
$("chat-input").removeAttribute("list");
$("chat-input").addEventListener("input", () => {
  mentions.replaceChildren();
  const input = $("chat-input");
  const end = input.selectionStart;
  const match = /@([^@\s]*)$/.exec(input.value.slice(0, end));
  if (!match) return;
  for (const name of characters.filter((n) => n.includes(match[1]))) {
    const button = node("button", "btn", name);
    button.type = "button";
    button.addEventListener("click", () => {
      const start = end - match[0].length;
      input.setRangeText(`@${name} `, start, end, "end");
      mentions.replaceChildren(); input.focus();
    });
    mentions.append(button);
  }
});
