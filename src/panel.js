let current = "list";
let previous = "list";
export function showPanel(name) {
  if (name === "ai" && current !== "ai") previous = current;
  current = name;
  // The assistant floats over the character list; settings replace both.
  document.querySelector(".stage").hidden = name === "ai";
  document.getElementById("ai").hidden = name !== "ai";
  document.getElementById("assistant").hidden = name !== "assistant";
  document.getElementById("assistant-fab").setAttribute("aria-expanded", String(name === "assistant"));
  document.getElementById("ai-open").setAttribute("aria-expanded", String(name === "ai"));
}
export function closeSettings() { showPanel(previous); }
