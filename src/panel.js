let current = "list";
let previous = "list";
export function showPanel(name) {
  if (name === "ai" && current !== "ai") previous = current;
  current = name;
  for (const id of ["list", "assistant", "ai"]) document.getElementById(id).hidden = id !== name;
  document.querySelector(".chat-tabs").hidden = name === "ai";
  document.getElementById("ai-open").setAttribute("aria-expanded", String(name === "ai"));
  document.getElementById("characters-tab").setAttribute("aria-pressed", String(name === "list"));
  document.getElementById("assistant-tab").setAttribute("aria-pressed", String(name === "assistant"));
}
export function closeSettings() { showPanel(previous); }
