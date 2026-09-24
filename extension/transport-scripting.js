import { openTabNear, moveAgentGroup } from "../src/tab-helpers.js";

// Pages Chrome does not let extensions script.
const RESTRICTED_URL = /^(chrome|chrome-extension|chrome-untrusted|devtools|edge|view-source|about):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;
// chrome.tabs.captureVisibleTab allows two captures per second.
const CAPTURE_INTERVAL_MS = 550;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reaches pages through chrome.scripting and chrome.tabs, without the debugger. The agent
// works only in the tabs of the window its side panel belongs to, so an incognito window's
// agent never sees normal tabs and the reverse. Tab ids are chrome.tabs ids as strings.
export class ScriptingTransport {
  constructor({ windowId }) {
    this.windowId = windowId;
    this.lastCapture = 0;
  }

  // The agent may open only web pages.
  checkUrl(url) {
    if (url === "about:blank" || /^https?:\/\//i.test(url)) return;
    throw new Error("The agent can open only web pages (http or https addresses).");
  }

  async pages() {
    const own = chrome.runtime.getURL("");
    const tabs = (await chrome.tabs.query({ windowId: this.windowId })).filter((t) => !(t.url || t.pendingUrl || "").startsWith(own));
    return tabs.map((t) => ({ id: String(t.id), title: t.title || "", url: t.url || t.pendingUrl || "" }));
  }

  async createBlank() {
    const tab = await chrome.tabs.create({ windowId: this.windowId, url: "about:blank", active: true });
    return String(tab.id);
  }

  async activeId() {
    const [tab] = await chrome.tabs.query({ windowId: this.windowId, active: true });
    return tab ? String(tab.id) : null;
  }

  // Runs a self-contained page function in the tab's top frame, in the extension's isolated
  // world (the page cannot see or tamper with it), and returns its result.
  async call(id, fn, args = []) {
    const tab = await chrome.tabs.get(Number(id));
    const url = tab.url || tab.pendingUrl || "";
    if (url !== "about:blank" && RESTRICTED_URL.test(url)) {
      throw new Error("This is a browser page (such as chrome:// or the Chrome Web Store) that extensions cannot control. Navigate to a website first.");
    }
    let results;
    try {
      results = await chrome.scripting.executeScript({ target: { tabId: Number(id) }, func: fn, args });
    } catch (err) {
      throw new Error(`Could not reach this page: ${err.message}`);
    }
    const [first] = results ?? [];
    if (first?.error) throw new Error(String(first.error.message ?? first.error));
    return first?.result;
  }

  // A JPEG of the visible part of the tab, scaled to maxWidth CSS pixels at most.
  async screenshot(id, maxWidth) {
    await this.activate(id);
    const wait = this.lastCapture + CAPTURE_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCapture = Date.now();
    const { windowId } = await chrome.tabs.get(Number(id));
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
    const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const viewport = await this.call(id, () => ({ w: innerWidth, h: innerHeight }));
    const width = Math.min(viewport.w, maxWidth);
    const height = Math.round((image.height * width) / image.width);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: btoa(binary), width, height, cssPerPixel: viewport.w / width };
  }

  async navigate(id, url) {
    await chrome.tabs.update(Number(id), { url });
  }

  // Goes one step back or forward in the tab's history.
  async history(id, direction) {
    try {
      await (direction === "back" ? chrome.tabs.goBack(Number(id)) : chrome.tabs.goForward(Number(id)));
    } catch {
      throw new Error(`No ${direction} history entry`);
    }
  }

  // Resolves when the tab has finished loading, or after timeoutMs.
  async waitForLoad(id, timeoutMs) {
    const start = Date.now();
    await sleep(250);
    while (Date.now() - start < timeoutMs) {
      const tab = await chrome.tabs.get(Number(id)).catch(() => null);
      if (!tab) return;
      if (tab.status === "complete") return;
      await sleep(200);
    }
  }

  async openTab({ openerId, url = "about:blank" }) {
    return String(await openTabNear(openerId ? Number(openerId) : null, url, this.windowId));
  }

  async activate(id) {
    await chrome.tabs.update(Number(id), { active: true });
  }

  async close(id) {
    await chrome.tabs.remove(Number(id));
  }

  async highlight(id) {
    await moveAgentGroup(id ? Number(id) : null, `window-${this.windowId}`);
  }
}
