// Mounts the one assistant (bubble.js) and feeds it the roster and panel groups.
import { showPanel } from "./panel.js";
const { invoke } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);
let names = [];
let groupContext = "";
let summary = "";
let assistant = null;
async function roster() {
  const state = await invoke("get_state");
  const signed = state.profiles.filter((p) => p.info);
  names = signed.map((p) => p.info.name);
  let groups = [];
  try { groups = JSON.parse(localStorage.getItem("roIdleTray.groups")) ?? []; } catch {}
  if (!Array.isArray(groups)) groups = [];
  const context = [];
  for (const g of groups) {
    if (typeof g?.name !== "string" || !Array.isArray(g.members)) continue;
    const members = signed.filter((p) => g.members.includes(p.n));
    if (members.length) context.push({ group: g.name, characters: members.map((p) => p.info.name) });
  }
  groupContext = JSON.stringify(context);
  while (new TextEncoder().encode(groupContext).length > 2000) { context.pop(); groupContext = JSON.stringify(context); }
  const idling = signed.filter((p) => p.info.running).length;
  summary = `${signed.length} 角色 · ${idling} 掛機中${context.length ? ` · ${context.length} 群組` : ""}`;
}
const close = () => { show(false); $("assistant-fab").focus(); };
async function show(open, who = null) {
  showPanel(open ? "assistant" : "list");
  if (!open) return;
  try { await roster(); } catch {}
  assistant ??= window.roIdleAssistant($("assistant"), { roster: () => names, groups: () => groupContext, summary: () => summary, onClose: close });
  await assistant.ask(who);
}
$("assistant-fab").addEventListener("click", () => show($("assistant").hidden));
// A row's ✦ button, or a game window's bubble (via Rust), asks about one character.
document.addEventListener("ask-character", (e) => show(true, e.detail));
window.__TAURI__.event?.listen("ask-character", (e) => show(true, e.payload));
