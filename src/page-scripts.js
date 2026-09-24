// Functions serialized with Function.prototype.toString() and run inside the page.
// Each one must be fully self-contained: no imports, no closures over module scope.

// Builds a compact, indented outline of the page. Elements that can be acted on get a
// stable ref id (ref_N) that the other tools accept in place of coordinates.
export function readPageScript(interactiveOnly, maxChars) {
  const store = (window.__agentRefStore ||= { seq: 0, map: new Map() });
  const refFor = (el) => {
    if (!el.__agentRef) {
      el.__agentRef = "ref_" + ++store.seq;
      store.map.set(el.__agentRef, new WeakRef(el));
    }
    return el.__agentRef;
  };

  const INTERACTIVE_SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=tab]",
    "[role=menuitem]", "[role=option]", "[role=switch]", "[role=combobox]", "[role=textbox]",
    "[role=searchbox]", "[role=slider]", "[contenteditable='']", "[contenteditable=true]",
    "[onclick]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const STRUCTURAL = {
    H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
    NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
    FORM: "form", DIALOG: "dialog", TABLE: "table", UL: "list", OL: "list", LI: "listitem",
    IMG: "img", LABEL: "label", P: "paragraph",
  };
  const IMPLICIT = {
    A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", SUMMARY: "button",
  };

  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || s.display === "contents";
  };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (el.tagName === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      if (["checkbox", "radio"].includes(t)) return t;
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "range") return "slider";
      if (t === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return IMPLICIT[el.tagName] || STRUCTURAL[el.tagName] || el.tagName.toLowerCase();
  };

  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (clean(text)) return clean(text);
    }
    if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
    const attr = el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title");
    if (attr) return clean(attr);
    if (el.tagName === "INPUT" && ["submit", "button", "reset"].includes(el.type)) return clean(el.value);
    return clean(el.innerText || el.textContent || "");
  };

  const lines = [];
  let size = 0;
  let truncated = false;

  const push = (line) => {
    if (size + line.length > maxChars) {
      truncated = true;
      return;
    }
    lines.push(line);
    size += line.length + 1;
  };

  const describe = (el, role, interactive) => {
    let line = role;
    const name = clip(nameOf(el), interactive ? 100 : 200);
    if (name) line += ` "${name.replace(/"/g, "'")}"`;
    if (interactive) line += ` [${refFor(el)}]`;
    if (el.tagName === "A" && el.getAttribute("href")) line += ` href="${clip(el.getAttribute("href"), 120)}"`;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.type && el.tagName === "INPUT") line += ` type=${el.type}`;
      if (["checkbox", "radio"].includes(el.type)) line += el.checked ? " checked" : " unchecked";
      else if (el.value) line += ` value="${clip(el.value, 80)}"`;
    }
    if (el.tagName === "SELECT") {
      const opts = [...el.options].map((o) => (o.selected ? `*${clean(o.text)}` : clean(o.text)));
      line += ` options=[${clip(opts.join(" | "), 300)}]`;
    }
    if (el.disabled) line += " disabled";
    if (el.getAttribute("aria-expanded")) line += ` expanded=${el.getAttribute("aria-expanded")}`;
    return line;
  };

  const walk = (root, depth) => {
    for (const el of root.children) {
      if (truncated) return;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"].includes(el.tagName.toUpperCase())) continue;
      if (!isVisible(el)) continue;

      const interactive = el.matches(INTERACTIVE_SELECTOR);
      const structural = !interactiveOnly && STRUCTURAL[el.tagName] !== undefined;
      const leafText =
        !interactiveOnly &&
        !interactive &&
        el.children.length === 0 &&
        clean(el.textContent).length > 0;

      let nextDepth = depth;
      if (interactive || structural || leafText) {
        const role = leafText && !structural ? "text" : roleOf(el);
        push("  ".repeat(depth) + describe(el, role, interactive));
        nextDepth = depth + 1;
      }
      // Interactive elements' text is already in their name; don't repeat it.
      if (!interactive || el.children.length > 3) walk(el, nextDepth);
      if (el.shadowRoot) walk(el.shadowRoot, nextDepth);
    }
  };

  walk(document.body || document.documentElement, 0);

  return {
    url: location.href,
    title: document.title,
    viewport: `${innerWidth}x${innerHeight}`,
    scroll: `${Math.round(scrollX)},${Math.round(scrollY)} of ${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
    tree: lines.join("\n") + (truncated ? "\n[truncated: page outline exceeded the size limit; use find or scroll]" : ""),
  };
}

// Scrolls a ref'd element into view and returns its center in CSS pixels.
export function refCenterScript(ref) {
  const el = window.__agentRefStore?.map.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: `${ref} not found; call read_page again to refresh refs` };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

export function formInputScript(ref, value) {
  const el = window.__agentRefStore?.map.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: `${ref} not found; call read_page again to refresh refs` };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.focus();
  const fire = () => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  if (el.tagName === "SELECT") {
    const want = String(value).toLowerCase();
    const opt = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want);
    if (!opt) return { error: `No option "${value}". Options: ${[...el.options].map((o) => o.text.trim()).join(", ")}` };
    el.value = opt.value;
    fire();
    return { ok: `Selected "${opt.text.trim()}"` };
  }
  if (el.type === "checkbox" || el.type === "radio") {
    const want = value === true || value === "true" || value === "on" || value === 1;
    if (el.checked !== want) el.click();
    return { ok: `${el.type} is now ${el.checked ? "checked" : "unchecked"}` };
  }
  if (el.isContentEditable) {
    el.textContent = String(value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return { ok: "Set content" };
  }
  if ("value" in el) {
    // Use the native setter so frameworks (React etc.) observe the change.
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    fire();
    return { ok: `Set value to "${String(value).slice(0, 80)}"` };
  }
  return { error: `${ref} is not a form field` };
}

export function pageTextScript(maxChars) {
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const text = (root?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    url: location.href,
    title: document.title,
    source: root === document.body ? "body" : root.tagName.toLowerCase(),
    text: text.length > maxChars ? text.slice(0, maxChars) + "\n[truncated]" : text,
  };
}

// Describes the element a ref names, or the element at a CSS-pixel point, so safety
// checks can see what an action will actually hit.
export function describeTargetScript(ref, x, y) {
  const el = ref ? window.__agentRefStore?.map.get(ref)?.deref() : document.elementFromPoint(x, y);
  if (!el) return null;
  const target = el.closest("a,button,input,select,textarea,label,[role],[onclick]") || el;
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const name =
    target.getAttribute("aria-label") || target.getAttribute("placeholder") || target.value || target.innerText || target.getAttribute("title") || "";
  const tag = target.tagName.toLowerCase();
  const role = target.getAttribute("role") || (tag === "input" ? `input[type=${target.type}]` : tag);
  const form = target.form?.getAttribute("action");
  return [
    `${role} "${clean(name)}"`,
    target.getAttribute("href") && `href=${clean(target.getAttribute("href"))}`,
    form && `form action=${clean(form)}`,
  ]
    .filter(Boolean)
    .join(" ");
}

// Skips YouTube video ads: fast-forwards ad playback (muted), clicks Skip, and closes
// overlay ads. Installed on every document in the agent's tabs; inert off YouTube.
export function youtubeAdSkipperScript() {
  if (!/(^|\.)youtube\.com$/.test(location.hostname) || window.__agentAdSkipper) return;
  window.__agentAdSkipper = true;
  let mutedByUs = false;
  setInterval(() => {
    const player = document.querySelector(".html5-video-player");
    const video = player?.querySelector("video");
    if (player?.classList.contains("ad-showing") && video) {
      if (!video.muted) {
        video.muted = true;
        mutedByUs = true;
      }
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
      document
        .querySelectorAll(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, [id^='skip-button'] button")
        .forEach((b) => b.click());
    } else if (mutedByUs && video) {
      video.muted = false;
      mutedByUs = false;
    }
    document.querySelectorAll(".ytp-ad-overlay-close-button").forEach((b) => b.click());
  }, 400);
}

// Removes full-screen interstitial ads (Google "vignette" ads and similar fixed overlays
// served from ad frames) that sit on top of the page and swallow clicks.
export function adOverlayRemoverScript() {
  if (window.__agentAdOverlayRemover) return;
  window.__agentAdOverlayRemover = true;
  const AD_FRAME = /googlesyndication|doubleclick|googleads|adservice|amazon-adsystem|taboola|outbrain/;
  const coversViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= innerWidth * 0.6 && r.height >= innerHeight * 0.6;
  };
  const sweep = () => {
    const vignettes = document.querySelectorAll("ins.adsbygoogle[data-vignette-loaded], ins.adsbygoogle[data-anchor-status]");
    let removed = 0;
    for (const el of vignettes) {
      if (coversViewport(el) || el.getAttribute("data-vignette-loaded")) {
        el.remove();
        removed++;
      }
    }
    for (const frame of document.querySelectorAll("iframe")) {
      if (!AD_FRAME.test(frame.src || frame.id || "") || !coversViewport(frame)) continue;
      let el = frame;
      while (el.parentElement && el.parentElement !== document.body && getComputedStyle(el).position !== "fixed") el = el.parentElement;
      if (getComputedStyle(el).position === "fixed") {
        el.remove();
        removed++;
      }
    }
    if (removed) {
      document.documentElement.style.overflow = "";
      document.body && (document.body.style.overflow = "");
      if (location.hash === "#google_vignette") history.replaceState(null, "", location.pathname + location.search);
    }
  };
  setInterval(sweep, 700);
  addEventListener("hashchange", sweep);
}

// Reports what actually sits on top of a ref'd element's center, so a click that would
// land on an overlay fails loudly instead of hitting the overlay.
export function hitTestScript(ref) {
  const el = window.__agentRefStore?.map.get(ref)?.deref();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!top || el === top || el.contains(top) || top.contains(el)) return null;
  if (el.labels && [...el.labels].some((l) => l === top || l.contains(top))) return null;
  const desc = top.tagName.toLowerCase() + (top.id ? `#${top.id}` : "") + (top.src ? ` src=${String(top.src).slice(0, 80)}` : "");
  return desc;
}

// Whether typing would go into a password field: the ref'd element, or the focused one.
export function passwordTargetScript(ref) {
  const el = ref ? window.__agentRefStore?.map.get(ref)?.deref() : document.activeElement;
  return Boolean(el && el.tagName === "INPUT" && el.type === "password");
}

// Viewport size in CSS pixels, for mapping screenshot coordinates.
export function viewportScript() {
  return { w: innerWidth, h: innerHeight };
}

// Whether the document has finished loading.
export function readyStateScript() {
  return document.readyState;
}

// Input is replayed as DOM events rather than through the debugger. Each
// function also performs the default action a real input would have (focusing, submitting,
// moving the caret), because synthetic events do not trigger most of them.

// Clicks at a point in CSS pixels. button: "left" or "right"; count: 1 to 3; modifiers: bit
// mask (1 alt, 2 ctrl, 4 meta, 8 shift).
export function clickScript(x, y, button, count, modifiers) {
  const el = document.elementFromPoint(x, y);
  if (!el) return { error: `Nothing at (${x}, ${y}); take a new screenshot` };
  const right = button === "right";
  const base = {
    bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y,
    button: right ? 2 : 0, altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), metaKey: !!(modifiers & 4), shiftKey: !!(modifiers & 8),
  };
  const pointer = (type, buttons) => el.dispatchEvent(new PointerEvent(type, { ...base, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  const mouse = (type, detail, buttons) => el.dispatchEvent(new MouseEvent(type, { ...base, detail, buttons }));
  pointer("pointerover", 0);
  mouse("mouseover", 0, 0);
  pointer("pointermove", 0);
  mouse("mousemove", 0, 0);
  for (let i = 1; i <= count; i++) {
    pointer("pointerdown", right ? 2 : 1);
    if (mouse("mousedown", i, right ? 2 : 1) && i === 1) {
      const focusable = el.closest("input, textarea, select, button, a[href], [tabindex], [contenteditable=''], [contenteditable=true]");
      if (focusable) focusable.focus({ preventScroll: true });
      else document.activeElement?.blur?.();
    }
    pointer("pointerup", 0);
    mouse("mouseup", i, 0);
    if (right) mouse("contextmenu", i, 0);
    // click() runs the element's activation behavior (links, checkboxes, submit buttons).
    else if (i === 1) {
      if (el instanceof HTMLElement) el.click();
      else el.dispatchEvent(new MouseEvent("click", { ...base, detail: 1 }));
    }
  }
  if (!right && count >= 2) mouse("dblclick", 2, 0);
  const field = el.closest("input, textarea");
  if (count === 3 || (count === 2 && field)) {
    if (field && typeof field.select === "function") field.select();
    else {
      const block = el.closest("p, li, td, th, h1, h2, h3, h4, h5, h6, div") || el;
      getSelection().selectAllChildren(block);
    }
  }
  return { ok: true };
}

// Moves the pointer onto the element at a point.
export function hoverScript(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return { error: `Nothing at (${x}, ${y}); take a new screenshot` };
  const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };
  el.dispatchEvent(new PointerEvent("pointerover", { ...init, pointerType: "mouse" }));
  el.dispatchEvent(new PointerEvent("pointerenter", { ...init, bubbles: false, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mouseover", init));
  el.dispatchEvent(new MouseEvent("mouseenter", { ...init, bubbles: false }));
  el.dispatchEvent(new PointerEvent("pointermove", { ...init, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mousemove", init));
  return { ok: true };
}

// Drags from one point to another, with HTML drag and drop when the source is draggable.
export function dragScript(fromX, fromY, toX, toY) {
  const source = document.elementFromPoint(fromX, fromY);
  if (!source) return { error: "Nothing at the drag start; take a new screenshot" };
  const init = (x, y, buttons) => ({ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, buttons });
  const at = (x, y) => document.elementFromPoint(x, y) || document.body;
  source.dispatchEvent(new PointerEvent("pointerdown", { ...init(fromX, fromY, 1), pointerType: "mouse", isPrimary: true }));
  source.dispatchEvent(new MouseEvent("mousedown", init(fromX, fromY, 1)));
  const draggable = source.closest("[draggable=true]");
  const data = draggable ? new DataTransfer() : null;
  if (draggable) draggable.dispatchEvent(new DragEvent("dragstart", { ...init(fromX, fromY, 1), dataTransfer: data }));
  for (let i = 1; i <= 10; i++) {
    const x = fromX + ((toX - fromX) * i) / 10;
    const y = fromY + ((toY - fromY) * i) / 10;
    const over = at(x, y);
    over.dispatchEvent(new PointerEvent("pointermove", { ...init(x, y, 1), pointerType: "mouse", isPrimary: true }));
    over.dispatchEvent(new MouseEvent("mousemove", init(x, y, 1)));
    if (draggable) over.dispatchEvent(new DragEvent("dragover", { ...init(x, y, 1), dataTransfer: data }));
  }
  const target = at(toX, toY);
  if (draggable) {
    target.dispatchEvent(new DragEvent("drop", { ...init(toX, toY, 0), dataTransfer: data }));
    draggable.dispatchEvent(new DragEvent("dragend", { ...init(toX, toY, 0), dataTransfer: data }));
  }
  target.dispatchEvent(new PointerEvent("pointerup", { ...init(toX, toY, 0), pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", init(toX, toY, 0)));
  return { ok: true };
}

// Inserts text at the caret of the focused field, as typing would.
export function typeScript(text) {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (el?.tagName === "IFRAME") {
    try {
      el = el.contentDocument.activeElement;
    } catch {
      return { error: "The focused field is inside a frame from another site, which the agent cannot type into." };
    }
  }
  const editableInput = el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes(el.type)));
  if (editableInput) {
    let start = el.value.length;
    let end = start;
    try {
      start = el.selectionStart ?? start;
      end = el.selectionEnd ?? end;
    } catch {}
    if (!el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: text }))) return { ok: true };
    // The prototype setter updates the value in a way frameworks such as React notice.
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    try {
      el.setSelectionRange(start + text.length, start + text.length);
    } catch {}
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    return { ok: true };
  }
  if (el?.isContentEditable) {
    el.ownerDocument.execCommand("insertText", false, text);
    return { ok: true };
  }
  return { error: "No text field is focused. Click the field first, or use form_input with its ref." };
}

// Presses keys: a list of { key, code, keyCode, text, modifiers } (modifiers as in clickScript).
export function keysScript(keys) {
  const deepActive = () => {
    let el = document.activeElement || document.body;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el || document.body;
  };
  const isTextField = (el) =>
    el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes(el.type));
  const setValue = (el, value, caret) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    try {
      el.setSelectionRange(caret, caret);
    } catch {}
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  };
  const tabbables = () =>
    [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex], [contenteditable=''], [contenteditable=true]")].filter(
      (e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden",
    );
  for (const k of keys) {
    const el = deepActive();
    const init = {
      key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true, composed: true,
      altKey: !!(k.modifiers & 1), ctrlKey: !!(k.modifiers & 2), metaKey: !!(k.modifiers & 4), shiftKey: !!(k.modifiers & 8),
    };
    const allowed = el.dispatchEvent(new KeyboardEvent("keydown", init));
    if (allowed && k.text) el.dispatchEvent(new KeyboardEvent("keypress", { ...init, charCode: k.text.charCodeAt(0) }));
    if (allowed) {
      const command = init.ctrlKey || init.metaKey;
      const field = isTextField(el) ? el : null;
      let start = 0;
      let end = 0;
      try {
        start = field?.selectionStart ?? field?.value.length ?? 0;
        end = field?.selectionEnd ?? start;
      } catch {
        start = end = field?.value.length ?? 0;
      }
      if (command && k.key.toLowerCase() === "a") {
        if (field) field.select();
        else if (el.isContentEditable) el.ownerDocument.execCommand("selectAll");
        else getSelection().selectAllChildren(document.body);
      } else if (command && k.key.toLowerCase() === "z") {
        document.execCommand("undo");
      } else if (command) {
        // Other shortcuts (copy, paste, browser commands) have no page-level default.
      } else if (k.key === "Enter") {
        if (el.tagName === "TEXTAREA") setValue(el, el.value.slice(0, start) + "\n" + el.value.slice(end), start + 1);
        else if (el.isContentEditable) document.execCommand("insertParagraph");
        else if (field && field.form) field.form.requestSubmit();
        else if (el.matches?.("a[href], button, [role=button], [role=link], summary")) el.click();
      } else if (k.key === "Tab") {
        const list = tabbables();
        const next = list[(list.indexOf(el) + (init.shiftKey ? -1 : 1) + list.length) % list.length];
        next?.focus();
      } else if (k.key === "Backspace" || k.key === "Delete") {
        if (field) {
          const from = start !== end ? start : k.key === "Backspace" ? Math.max(0, start - 1) : start;
          const to = start !== end ? end : k.key === "Backspace" ? start : Math.min(field.value.length, start + 1);
          setValue(field, field.value.slice(0, from) + field.value.slice(to), from);
        } else if (el.isContentEditable) document.execCommand(k.key === "Backspace" ? "delete" : "forwardDelete");
      } else if (k.text && (field || el.isContentEditable)) {
        if (field) setValue(field, field.value.slice(0, start) + k.text + field.value.slice(end), start + k.text.length);
        else document.execCommand("insertText", false, k.text);
      } else if (k.key === " " && el.matches?.("button, [role=button], input[type=checkbox], input[type=radio]")) {
        el.click();
      } else if (!field && !el.isContentEditable) {
        const page = innerHeight * 0.9;
        const scroll = { ArrowDown: [0, 40], ArrowUp: [0, -40], ArrowRight: [40, 0], ArrowLeft: [-40, 0], PageDown: [0, page], PageUp: [0, -page], " ": [0, init.shiftKey ? -page : page] }[k.key];
        if (scroll) scrollBy(scroll[0], scroll[1]);
        else if (k.key === "Home") scrollTo(scrollX, 0);
        else if (k.key === "End") scrollTo(scrollX, document.documentElement.scrollHeight);
      }
    }
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }
  return { ok: true };
}

// Scrolls the scrollable area under a point (or the page) by dx, dy CSS pixels.
export function scrollScript(x, y, dx, dy) {
  let el = document.elementFromPoint(x, y);
  el?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy }));
  while (el && el !== document.body && el !== document.documentElement) {
    const s = getComputedStyle(el);
    const scrollsY = dy && /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
    const scrollsX = dx && /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
    if (scrollsY || scrollsX) {
      el.scrollBy(dx, dy);
      return { ok: true };
    }
    el = el.parentElement;
  }
  scrollBy(dx, dy);
  return { ok: true };
}
