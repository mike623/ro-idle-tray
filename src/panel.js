let current = "list";
let previous = "list";
export function showPanel(name) {
  if (name === "ai" && current !== "ai") previous = current;
  current = name;
  // Settings replace the character list.
  document.querySelector(".stage").hidden = name === "ai";
  document.getElementById("ai").hidden = name !== "ai";
  document.getElementById("ai-open").setAttribute("aria-expanded", String(name === "ai"));
}
export function closeSettings() { showPanel(previous); }
