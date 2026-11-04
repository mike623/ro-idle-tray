// The panel's ✦ 助理 button and each row's ✦ open the one assistant window beside the panel.
const open = (character = null) => window.__TAURI__.core.invoke("open_assistant", { character }).catch(() => {});
document.getElementById("assistant-fab").addEventListener("click", () => open());
document.addEventListener("ask-character", (e) => open(e.detail));
