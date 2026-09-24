import { createController } from "../src/controller.js";
import { Browser } from "../src/browser-tools.js";
import { ScriptingTransport } from "./transport-scripting.js";
import { loadConfig, saveConfig, loadUsage, saveUsage, sessions } from "./storage.js";

// The whole agent runs inside the side panel page: the panel's window is the agent's
// workspace, and closing the panel ends its task. The UI (ui/app.js) talks to the
// controller in-page through globalThis.agentHost.

const win = await chrome.windows.getCurrent();

const controller = createController({
  loadConfig,
  saveConfig,
  loadUsage,
  saveUsage,
  sessions,
  ensureBrowser: async (agent) => {
    agent.browser ??= new Browser(new ScriptingTransport({ windowId: win.id }));
  },
});

// Settings changed in another window's panel.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.config) controller.refreshConfig();
});

// Closing the panel stops the task and removes the Agent group.
addEventListener("pagehide", () => {
  controller.agent.stop();
  controller.agent.browser?.endTask();
});

globalThis.agentHost = {
  incognito: win.incognito,
  connect(onEvent) {
    // Events are cloned so the UI never shares objects with the agent's history.
    const client = { send: (event) => queueMicrotask(() => onEvent(structuredClone(event))) };
    const receive = controller.connect(client);
    return { send: (msg) => receive(structuredClone(msg)) };
  },
};

await import("../ui/app.js");
