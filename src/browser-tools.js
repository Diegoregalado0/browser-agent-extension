import {
  readPageScript,
  refCenterScript,
  formInputScript,
  pageTextScript,
  describeTargetScript,
  youtubeAdSkipperScript,
  adOverlayRemoverScript,
  hitTestScript,
  viewportScript,
  readyStateScript,
  clickScript,
  hoverScript,
  dragScript,
  typeScript,
  keysScript,
  scrollScript,
} from "./page-scripts.js";
import { sleep } from "./limits.js";

// Screenshots are scaled to at most this width; coordinates the model sends back are in
// screenshot pixels and are mapped to CSS pixels before input is dispatched.
const SCREENSHOT_MAX_WIDTH = 1280;
const PAGE_OUTLINE_MAX_CHARS = 40000;
const PAGE_TEXT_MAX_CHARS = 60000;
const LOAD_TIMEOUT_MS = 20000;

export const BROWSER_TOOL_DEFS = [
  {
    name: "browser",
    description:
      "Mouse, keyboard and screenshot control inside the current browser tab's page. Coordinates are pixels in the most " +
      "recent browser screenshot (origin top-left). For clicks and hover you may pass a ref from read_page/find instead of " +
      "a coordinate. Take a screenshot to see the page, and again after actions whose effect you need to verify.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "screenshot", "left_click", "right_click", "double_click", "triple_click", "hover",
            "type", "key", "scroll", "left_click_drag", "wait",
          ],
        },
        coordinate: { type: "array", items: { type: "number" }, description: "[x, y] in screenshot pixels" },
        ref: { type: "string", description: "Element ref such as ref_12, as an alternative to coordinate" },
        start_coordinate: { type: "array", items: { type: "number" }, description: "Drag start [x, y]" },
        text: {
          type: "string",
          description: "For type: text to insert. For key: space-separated keys or chords, e.g. 'Enter' or 'cmd+a Backspace'.",
        },
        modifiers: { type: "string", description: "Modifier chord held during a click, e.g. 'cmd' or 'shift'" },
        scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
        scroll_amount: { type: "number", description: "Scroll ticks (default 3, about 100px each)" },
        duration: { type: "number", description: "Seconds to wait (wait action, max 10)" },
      },
      required: ["action"],
    },
  },
  {
    name: "navigate",
    description:
      "Load a URL, or pass 'back' / 'forward' to move through history. Waits for the page to load. Reuses the current tab " +
      "when this task opened it; set new_tab to keep the current tab as it is and load the URL in a new one. Tabs this " +
      "task did not open are never reused.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, new_tab: { type: "boolean", description: "Open in a new tab (default false)" } },
      required: ["url"],
    },
  },
  {
    name: "read_page",
    description:
      "Return an outline of the current page (roles, names, values) with refs for actionable elements. Use filter " +
      "'interactive' for only controls. Refs stay valid until the page navigates.",
    input_schema: { type: "object", properties: { filter: { type: "string", enum: ["all", "interactive"] } } },
  },
  {
    name: "find",
    description: "Search the page outline for elements whose role, name, or attributes match the query words. Returns matching lines with refs.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "form_input",
    description: "Set a form control by ref: text for inputs/textareas, option text or value for selects, true/false for checkboxes and radios.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: ["string", "boolean", "number"] } },
      required: ["ref", "value"],
    },
  },
  {
    name: "get_page_text",
    description: "Return the readable text of the current page (article or main content when present). Best for reading long content.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "tabs",
    description: "List, open, switch to, or close tabs in the agent browser. Switching makes that tab the target of all page tools.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "switch", "close"] },
        tab_id: { type: "string", description: "Tab id from list" },
        url: { type: "string", description: "For create" },
      },
      required: ["action"],
    },
  },
];

// Keeps huge data: URLs and tracking-laden links from flooding tool output.
function shortUrl(url) {
  return url.length > 200 ? url.slice(0, 200) + "…" : url;
}

function normalizeUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

const MODIFIER_BITS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, super: 4, shift: 8 };

function parseModifiers(chord) {
  if (!chord) return 0;
  return chord.toLowerCase().split("+").reduce((bits, m) => bits | (MODIFIER_BITS[m.trim()] || 0), 0);
}

const NAMED_KEYS = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};
for (let i = 1; i <= 12; i++) NAMED_KEYS[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

function describeKey(token) {
  const parts = token.split("+");
  const base = parts.pop();
  const modifiers = parseModifiers(parts.join("+"));
  const named = NAMED_KEYS[base.toLowerCase()];
  let def;
  if (named) def = { ...named };
  else if (base.length === 1) {
    const upper = base.toUpperCase();
    const code = /[a-z]/i.test(base) ? `Key${upper}` : /\d/.test(base) ? `Digit${base}` : undefined;
    def = { key: base, code, keyCode: upper.charCodeAt(0), text: base };
  } else throw new Error(`Unknown key "${base}"`);

  if (modifiers & (2 | 4)) delete def.text;
  return { ...def, modifiers };
}

export class Browser {
  // transport: ScriptingTransport (chrome.scripting and chrome.tabs). Tab ids come from it.
  constructor(transport) {
    this.transport = transport;
    // While a task runs with highlighting on, its current tab sits in an "Agent" tab group.
    this.highlighting = false;
    this.highlightQueue = Promise.resolve();
    // Tabs opened during the current task; the agent may navigate and close only these.
    this.taskTabs = new Set();
    this.currentId = null;
    this.skipYoutubeAds = false;
    this.cssPerPixel = null;
  }

  // Every change of the tab the tools act on goes through here, so the highlight follows.
  #setCurrent(id) {
    if (id === this.currentId) return;
    this.currentId = id;
    this.cssPerPixel = null;
    if (this.highlighting) this.#highlight();
  }

  // Moves the "Agent" tab group to the current tab, or removes it when no task runs.
  // Calls are queued so quick tab switches apply in order.
  #highlight() {
    const id = this.highlighting ? this.currentId : null;
    this.highlightQueue = this.highlightQueue.then(() => this.transport.highlight(id).catch(() => {}));
    return this.highlightQueue;
  }

  pages() {
    return this.transport.pages();
  }

  async currentPage() {
    const pages = await this.pages();
    const page = pages.find((p) => p.id === this.currentId);
    if (page) return page;
    if (!pages[0]) pages.push({ id: await this.transport.createBlank(), title: "", url: "about:blank" });
    this.#setCurrent(pages[0].id);
    return pages[0];
  }

  async currentUrl() {
    return (await this.currentPage()).url;
  }

  // Called at the start of every task: tabs from earlier tasks and the user's own tabs
  // become protected, so this task opens new tabs instead of taking them over.
  // Also points the agent at the tab the user is looking at, so "this page" means it,
  // and with highlight on, marks the tab the agent works in with an "Agent" tab group.
  async startTask({ highlight = false } = {}) {
    this.taskTabs.clear();
    this.highlighting = highlight;
    const active = await this.transport.activeId();
    if (active) this.#setCurrent(active);
    if (highlight) await this.#highlight();
  }

  async endTask() {
    if (!this.highlighting) return;
    this.highlighting = false;
    await this.#highlight();
  }

  #isBlank(page) {
    return /^(about:blank|chrome:\/\/new-tab-page\/?|chrome:\/\/newtab\/?)$/.test(page.url);
  }

  // Opens a tab for this task as a tab in the current tab's window, next to it, and
  // makes it current.
  async #openTaskTab(url = "about:blank") {
    this.transport.checkUrl(url);
    const id = await this.transport.openTab({ openerId: this.currentId, url });
    this.#setCurrent(id);
    this.taskTabs.add(id);
    await this.bringToFront();
    return id;
  }

  // Turns the YouTube ad skipper and ad overlay remover on or off. They are injected into
  // the agent's tab after each page load.
  setAdSkipping(enabled) {
    this.skipYoutubeAds = enabled;
  }

  // Runs a page function from page-scripts.js in the current tab.
  async callInPage(fn, ...args) {
    const { id } = await this.currentPage();
    return this.transport.call(id, fn, args);
  }

  async bringToFront() {
    const { id } = await this.currentPage();
    await this.transport.activate(id);
  }

  async waitForLoad() {
    const { id } = await this.currentPage();
    await this.transport.waitForLoad(id, LOAD_TIMEOUT_MS);
    if (this.skipYoutubeAds) {
      await this.callInPage(youtubeAdSkipperScript).catch(() => {});
      await this.callInPage(adOverlayRemoverScript).catch(() => {});
    }
  }

  // After an action that may navigate, waits for any load it started.
  async #settle() {
    await sleep(300);
    const state = await this.callInPage(readyStateScript).catch(() => "loading");
    if (state !== "complete") await this.waitForLoad();
  }

  async screenshot() {
    const { id } = await this.currentPage();
    const shot = await this.transport.screenshot(id, SCREENSHOT_MAX_WIDTH);
    this.cssPerPixel = shot.cssPerPixel;
    return shot;
  }

  async #point(input, key = "coordinate") {
    if (input.ref && key === "coordinate") {
      const res = await this.callInPage(refCenterScript, input.ref);
      if (res.error) throw new Error(res.error);
      if (["left_click", "right_click", "double_click", "triple_click"].includes(input.action)) {
        const cover = await this.callInPage(hitTestScript, input.ref);
        if (cover) {
          throw new Error(
            `${input.ref} is covered by another element (${cover}), probably an ad or popup overlay. ` +
              "Take a screenshot, close or dismiss the overlay, then retry.",
          );
        }
      }
      return res;
    }
    const coord = input[key];
    if (!Array.isArray(coord) || coord.length !== 2) throw new Error(`${key} [x, y] or ref is required for ${input.action}`);
    if (!this.cssPerPixel) {
      const vp = await this.callInPage(viewportScript);
      this.cssPerPixel = vp.w / Math.min(vp.w, SCREENSHOT_MAX_WIDTH);
    }
    return { x: Math.round(coord[0] * this.cssPerPixel), y: Math.round(coord[1] * this.cssPerPixel) };
  }

  // Runs an input page function and turns its { error } result into an exception.
  async #input(fn, ...args) {
    const res = await this.callInPage(fn, ...args);
    if (res?.error) throw new Error(res.error);
  }

  async #pageAction(input) {
    switch (input.action) {
      case "screenshot": {
        const shot = await this.screenshot();
        return [
          { type: "image", mediaType: "image/jpeg", data: shot.data },
          { type: "text", text: `Browser screenshot ${shot.width}x${shot.height}` },
        ];
      }
      case "left_click":
      case "right_click":
      case "double_click":
      case "triple_click": {
        const p = await this.#point(input);
        const button = input.action === "right_click" ? "right" : "left";
        const count = { double_click: 2, triple_click: 3 }[input.action] || 1;
        await this.#input(clickScript, p.x, p.y, button, count, parseModifiers(input.modifiers));
        await this.#settle();
        return `${input.action} at ${input.ref || JSON.stringify(input.coordinate)}`;
      }
      case "hover": {
        const p = await this.#point(input);
        await this.#input(hoverScript, p.x, p.y);
        return `Hovered ${input.ref || JSON.stringify(input.coordinate)}`;
      }
      case "left_click_drag": {
        const from = await this.#point(input, "start_coordinate");
        const to = await this.#point(input);
        await this.#input(dragScript, from.x, from.y, to.x, to.y);
        return "Dragged";
      }
      case "type": {
        if (typeof input.text !== "string") throw new Error("text is required for type");
        await this.#input(typeScript, input.text);
        return `Typed ${input.text.length} characters`;
      }
      case "key": {
        if (!input.text) throw new Error("text is required for key");
        await this.#input(keysScript, input.text.trim().split(/\s+/).map(describeKey));
        await this.#settle();
        return `Pressed ${input.text}`;
      }
      case "scroll": {
        const vp = await this.callInPage(viewportScript);
        const p = input.coordinate || input.ref ? await this.#point(input) : { x: vp.w / 2, y: vp.h / 2 };
        const delta = (input.scroll_amount ?? 3) * 100;
        const dir = input.scroll_direction || "down";
        const dx = dir === "left" ? -delta : dir === "right" ? delta : 0;
        const dy = dir === "up" ? -delta : dir === "down" ? delta : 0;
        await this.#input(scrollScript, p.x, p.y, dx, dy);
        await sleep(250);
        return `Scrolled ${dir}`;
      }
      case "wait": {
        const secs = Math.min(Math.max(input.duration ?? 2, 0), 10);
        await sleep(secs * 1000);
        return `Waited ${secs}s`;
      }
      default:
        throw new Error(`Unknown action ${input.action}`);
    }
  }

  async #tabs(input) {
    switch (input.action) {
      case "list": {
        const pages = await this.pages();
        return pages
          .map((p) => `${p.id === this.currentId ? "* " : "  "}${p.id}: ${p.title} | ${shortUrl(p.url)}${this.taskTabs.has(p.id) ? " [opened this task]" : ""}`)
          .join("\n");
      }
      case "create": {
        const id = await this.#openTaskTab(input.url ? normalizeUrl(input.url) : undefined);
        if (input.url) await this.waitForLoad();
        return `Opened tab ${id} and made it the current tab`;
      }
      case "switch": {
        if (!input.tab_id) throw new Error("tab_id is required");
        const tabId = String(input.tab_id);
        if (!(await this.pages()).some((p) => p.id === tabId)) throw new Error(`No tab ${tabId}`);
        this.#setCurrent(tabId);
        const page = await this.currentPage();
        await this.bringToFront();
        return `Current tab is now ${page.id}: ${page.title} | ${shortUrl(page.url)}`;
      }
      case "close": {
        const id = input.tab_id ? String(input.tab_id) : this.currentId;
        if (!this.taskTabs.has(id)) {
          throw new Error("You can only close tabs you opened during this task. Leave other tabs open; switch away from them instead.");
        }
        await this.transport.close(id);
        this.taskTabs.delete(id);
        if (id === this.currentId) this.#setCurrent(null);
        return `Closed tab ${id}`;
      }
      default:
        throw new Error(`Unknown tabs action ${input.action}`);
    }
  }

  // Returns tool output: a string or an array of text/image blocks.
  async run(name, input) {
    const output = await this.#run(name, input);
    await this.highlightQueue;
    return output;
  }

  async #run(name, input) {
    switch (name) {
      case "browser":
        return this.#pageAction(input);
      case "navigate": {
        let note = "";
        if (input.url !== "back" && input.url !== "forward") {
          this.transport.checkUrl(normalizeUrl(input.url));
          const page = await this.currentPage();
          if (input.new_tab) {
            const id = await this.#openTaskTab();
            note = ` (new tab ${id}; previous tab ${page.id} unchanged)`;
          } else if (this.taskTabs.has(page.id)) {
            // Already this task's tab.
          } else if (this.#isBlank(page)) {
            this.taskTabs.add(page.id);
          } else {
            const id = await this.#openTaskTab();
            note = ` (new tab ${id}, because tab ${page.id} was not opened by this task; it is unchanged)`;
          }
        }
        const { id } = await this.currentPage();
        if (input.url === "back" || input.url === "forward") await this.transport.history(id, input.url);
        else await this.transport.navigate(id, normalizeUrl(input.url));
        this.cssPerPixel = null;
        await this.waitForLoad();
        const page = await this.currentPage();
        return `Loaded: ${shortUrl(page.title)} | ${shortUrl(page.url)}${note}`;
      }
      case "read_page": {
        const res = await this.callInPage(readPageScript, input.filter === "interactive", PAGE_OUTLINE_MAX_CHARS);
        return `URL: ${shortUrl(res.url)}\nTitle: ${res.title}\nViewport: ${res.viewport}, scroll ${res.scroll}\n\n${res.tree}`;
      }
      case "find": {
        const res = await this.callInPage(readPageScript, false, 200000);
        const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
        const matches = res.tree
          .split("\n")
          .map((l) => l.trim())
          .map((line) => ({ line, score: words.filter((w) => line.toLowerCase().includes(w)).length }))
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 25);
        return matches.length ? matches.map((m) => m.line).join("\n") : `No elements matched "${input.query}"`;
      }
      case "form_input": {
        const res = await this.callInPage(formInputScript, input.ref, input.value);
        if (res.error) throw new Error(res.error);
        return res.ok;
      }
      case "get_page_text": {
        const res = await this.callInPage(pageTextScript, PAGE_TEXT_MAX_CHARS);
        return `URL: ${shortUrl(res.url)}\nTitle: ${res.title}\nSource: <${res.source}>\n\n${res.text}`;
      }
      case "tabs":
        return this.#tabs(input);
      default:
        throw new Error(`Unknown browser tool ${name}`);
    }
  }

  // What a browser/form_input action will hit, for safety checks. Null when unknown.
  async describeTarget(input) {
    try {
      if (input.ref) return await this.callInPage(describeTargetScript, input.ref, 0, 0);
      if (Array.isArray(input.coordinate) && this.cssPerPixel) {
        const [x, y] = input.coordinate.map((v) => Math.round(v * this.cssPerPixel));
        return await this.callInPage(describeTargetScript, null, x, y);
      }
    } catch {}
    return null;
  }
}

// The origin a tool call acts on, for site permission checks; null when it touches no page.
export function originForToolCall(name, input, currentUrl) {
  if (name === "tabs" || (name === "browser" && input.action === "wait")) return null;
  const url = name === "navigate" && !["back", "forward"].includes(input.url) ? normalizeUrl(input.url) : currentUrl;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
