// The assistant window: mounts the one assistant (bubble.js) and feeds it the roster and panel groups.
const { invoke } = window.__TAURI__.core;
let names = [];
let groupContext = "";
let summary = "";
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
const skills = await fetch("game-data.json").then(r => {
  if (!r.ok) throw new Error(`Skill names unavailable: HTTP ${r.status}`);
  return r.json();
}).then(data => data.skills).catch(e => { console.error(e); return []; });
const assistant = window.roIdleAssistant(document.getElementById("assistant"), {
  skills, roster: () => names, groups: () => groupContext, summary: () => summary,
  onClose: () => window.__TAURI__.window.getCurrentWindow().hide(),
});
// ponytail: one ask at a time; a click during a slow roster load just queues behind it.
let pending = Promise.resolve();
const ask = (who) => (pending = pending.then(async () => {
  try { await roster(); } catch {}
  await assistant.ask(who);
}));
ask(window.ROIDLE_ASK ?? null);
window.__TAURI__.event.listen("ask-character", (e) => ask(e.payload));
