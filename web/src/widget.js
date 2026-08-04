import html2canvas from "html2canvas";

const ENDPOINT = "__AGENTNUDGE_ENDPOINT__";
const ALLOWED_ORIGIN = "__AGENTNUDGE_ORIGIN__";
const SESSION_ID = "__AGENTNUDGE_SESSION__";
const SESSION_TOKEN = "__AGENTNUDGE_TOKEN__";
const HOST_ID = "agentnudge-widget";

const css = String.raw`
  :host {
    all: initial;
    position: fixed;
    inset: auto 18px 18px auto;
    z-index: 2147483647;
    color: #1b1b1a;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.4;
  }

  * { box-sizing: border-box; }
  button, textarea { font: inherit; }

  .launcher {
    width: 38px;
    height: 38px;
    border: 1px solid #1b1b1a;
    border-radius: 50%;
    background: #fffdf7;
    color: #1b1b1a;
    cursor: pointer;
    display: grid;
    place-items: center;
    box-shadow: 0 3px 14px rgba(20, 20, 18, .16);
    font-weight: 750;
  }

  .launcher:hover { background: #f1ffb7; }
  .launcher, .panel { position: relative; z-index: 1; }
  .launcher:focus-visible, button:focus-visible, textarea:focus-visible {
    outline: 3px solid rgba(80, 98, 20, .35);
    outline-offset: 2px;
  }

  .panel {
    width: min(340px, calc(100vw - 28px));
    max-height: min(640px, calc(100vh - 28px));
    overflow: auto;
    border: 1px solid #d8d5ca;
    border-radius: 14px;
    background: #fffdf7;
    box-shadow: 0 10px 34px rgba(20, 20, 18, .2);
    padding: 14px;
  }

  .panel[hidden], .launcher[hidden], .review[hidden], .evidence[hidden] { display: none; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .title { font-size: 15px; font-weight: 760; letter-spacing: -.01em; }
  .close { border: 0; background: transparent; cursor: pointer; color: #5d5b54; padding: 4px; }
  .hint { margin: 6px 0 10px; color: #67645c; font-size: 12px; }

  textarea {
    display: block;
    width: 100%;
    min-height: 92px;
    resize: vertical;
    border: 1px solid #c9c5b9;
    border-radius: 9px;
    background: white;
    color: #1b1b1a;
    padding: 9px 10px;
  }

  .tools, .actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 10px; }
  button.tool, button.secondary, button.primary {
    border-radius: 999px;
    padding: 7px 10px;
    cursor: pointer;
    border: 1px solid #c9c5b9;
    background: #fff;
    color: #1b1b1a;
  }
  button.tool:hover, button.secondary:hover { background: #f3f0e7; }
  button.tool[data-active="true"] { border-color: #536514; background: #f1ffb7; }
  button.primary { border-color: #1b1b1a; background: #1b1b1a; color: white; margin-left: auto; }
  button.primary:hover { background: #363632; }
  button:disabled { cursor: default; opacity: .55; }

  .evidence {
    margin-top: 10px;
    padding: 9px 10px;
    border-left: 3px solid #a4c238;
    background: #f5f8e8;
    color: #3e4721;
    font-size: 12px;
  }

  .status { min-height: 18px; margin: 8px 0 0; color: #67645c; font-size: 12px; }
  .status[data-error="true"] { color: #a12b20; }
  .review { margin-top: 10px; }
  .review img { display: block; width: 100%; border: 1px solid #d8d5ca; border-radius: 9px; background: #eee; }
  .review-note { margin: 7px 0 0; color: #67645c; font-size: 11px; }

  .overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 0;
  }
  .overlay svg { width: 100%; height: 100%; overflow: visible; }
  .hover-box { fill: rgba(164, 194, 56, .12); stroke: #61751a; stroke-width: 2; stroke-dasharray: 6 4; }
  .selection-box { fill: rgba(239, 111, 67, .10); stroke: #dc5835; stroke-width: 3; }
  .arrow-line { stroke: #dc5835; stroke-width: 4; stroke-linecap: round; }

  .mode-pill {
    position: fixed;
    left: 50%;
    top: 18px;
    transform: translateX(-50%);
    padding: 7px 11px;
    border: 1px solid #1b1b1a;
    border-radius: 999px;
    background: #fffdf7;
    color: #1b1b1a;
    box-shadow: 0 3px 14px rgba(20, 20, 18, .16);
    font-size: 12px;
    font-weight: 680;
  }
  .mode-pill[hidden] { display: none; }
`;

class AgentNudgeWidget extends HTMLElement {
  constructor() {
    super();
    this.mode = "idle";
    this.selection = null;
    this.selectedElement = null;
    this.arrow = null;
    this.hoverRect = null;
    this.dragStart = null;
    this.preview = null;
    this.suppressNextClick = false;
    this.abort = new AbortController();

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${css}</style>
      <button class="launcher" type="button" aria-label="Open AgentNudge feedback">N</button>
      <section class="panel" role="dialog" aria-label="Send feedback to the working agent" hidden>
        <div class="head">
          <div class="title">Nudge the agent</div>
          <button class="close" type="button" aria-label="Close feedback">Close</button>
        </div>
        <p class="hint">Say what should change. Visual context is optional.</p>
        <textarea maxlength="10000" placeholder="This button should be over there…" aria-label="Feedback message"></textarea>
        <div class="tools" aria-label="Visual context tools">
          <button class="tool pick" type="button">Pick element</button>
          <button class="tool region" type="button">Select area</button>
          <button class="tool move" type="button">Move this</button>
          <button class="secondary clear" type="button">Clear visual</button>
        </div>
        <div class="evidence" hidden></div>
        <p class="status" aria-live="polite"></p>
        <div class="actions compose-actions">
          <button class="primary review-button" type="button">Review</button>
        </div>
        <div class="review" hidden>
          <img alt="Exact screenshot that will be shared with the agent">
          <p class="review-note">Inputs and marked redaction regions are masked. Page content is sent as untrusted evidence.</p>
          <div class="actions">
            <button class="secondary back" type="button">Back</button>
            <button class="primary send" type="button">Send feedback</button>
          </div>
        </div>
      </section>
      <div class="overlay" aria-hidden="true">
        <svg>
          <defs>
            <marker id="agentnudge-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#dc5835"></path>
            </marker>
          </defs>
          <rect class="hover-box" visibility="hidden"></rect>
          <rect class="selection-box" visibility="hidden"></rect>
          <line class="arrow-line" marker-end="url(#agentnudge-arrowhead)" visibility="hidden"></line>
        </svg>
        <div class="mode-pill" hidden></div>
      </div>
    `;

    this.root = root;
    this.launcher = root.querySelector(".launcher");
    this.panel = root.querySelector(".panel");
    this.textarea = root.querySelector("textarea");
    this.status = root.querySelector(".status");
    this.evidence = root.querySelector(".evidence");
    this.review = root.querySelector(".review");
    this.previewImage = root.querySelector(".review img");
    this.reviewButton = root.querySelector(".review-button");
    this.sendButton = root.querySelector(".send");
    this.hoverBox = root.querySelector(".hover-box");
    this.selectionBox = root.querySelector(".selection-box");
    this.arrowLine = root.querySelector(".arrow-line");
    this.modePill = root.querySelector(".mode-pill");
  }

  connectedCallback() {
    const signal = this.abort.signal;
    this.launcher.addEventListener("click", () => this.open(), { signal });
    this.root.querySelector(".close").addEventListener("click", () => this.close(), { signal });
    this.root.querySelector(".pick").addEventListener("click", () => this.beginMode("element"), { signal });
    this.root.querySelector(".region").addEventListener("click", () => this.beginMode("region"), { signal });
    this.root.querySelector(".move").addEventListener("click", () => this.beginMode("move-source"), { signal });
    this.root.querySelector(".clear").addEventListener("click", () => this.clearVisual(), { signal });
    this.reviewButton.addEventListener("click", () => this.makePreview(), { signal });
    this.root.querySelector(".back").addEventListener("click", () => this.leaveReview(), { signal });
    this.sendButton.addEventListener("click", () => this.send(), { signal });
    this.textarea.addEventListener("input", () => this.invalidatePreview(), { signal });

    document.addEventListener("pointerdown", (event) => this.onPointerDown(event), { capture: true, signal });
    document.addEventListener("pointermove", (event) => this.onPointerMove(event), { capture: true, signal });
    document.addEventListener("pointerup", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("click", (event) => this.onDocumentClick(event), { capture: true, signal });
    document.addEventListener("keydown", (event) => this.onKeyDown(event), { capture: true, signal });
    window.addEventListener("resize", () => this.refreshSelectionRect(), { signal });
    window.addEventListener("scroll", () => this.refreshSelectionRect(), { signal, passive: true });
  }

  disconnectedCallback() {
    this.abort.abort();
  }

  open() {
    this.launcher.hidden = true;
    this.panel.hidden = false;
    queueMicrotask(() => this.textarea.focus());
  }

  close() {
    this.cancelMode();
    this.panel.hidden = true;
    this.launcher.hidden = false;
  }

  beginMode(mode) {
    this.invalidatePreview();
    this.mode = mode;
    this.dragStart = null;
    if (mode !== "move-target") this.hoverRect = null;
    if (mode === "element") this.setStatus("Click an element on the page. Press Escape to cancel.");
    if (mode === "region") this.setStatus("Drag a rectangle on the page. Press Escape to cancel.");
    if (mode === "move-source") {
      this.selection = null;
      this.selectedElement = null;
      this.arrow = null;
      this.setStatus("Click the thing that should move.");
    }
    this.render();
  }

  cancelMode() {
    this.mode = "idle";
    this.dragStart = null;
    this.hoverRect = null;
    this.setStatus("");
    this.render();
  }

  clearVisual() {
    this.cancelMode();
    this.selection = null;
    this.selectedElement = null;
    this.arrow = null;
    this.invalidatePreview();
    this.render();
  }

  onPointerDown(event) {
    if (this.mode === "idle" || event.composedPath().includes(this)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = true;

    if (this.mode === "region") {
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.selection = {
        kind: "region",
        rect: { x: event.clientX, y: event.clientY, width: 1, height: 1 },
        element: null,
      };
      this.selectedElement = null;
      this.arrow = null;
      this.render();
      return;
    }

    if (this.mode === "element") {
      this.selectElement(target);
      this.mode = "idle";
      this.setStatus("Element selected.");
      this.render();
      return;
    }

    if (this.mode === "move-source") {
      this.selectElement(target);
      this.mode = "move-target";
      this.setStatus("Now click where it should move.");
      this.render();
      return;
    }

    if (this.mode === "move-target" && this.selection) {
      const rect = this.currentSelectionRect();
      this.arrow = {
        start: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        end: { x: event.clientX, y: event.clientY },
      };
      this.mode = "idle";
      this.hoverRect = null;
      this.setStatus("Move destination selected.");
      this.render();
    }
  }

  onPointerMove(event) {
    if (this.dragStart && this.mode === "region") {
      event.preventDefault();
      const x = Math.min(this.dragStart.x, event.clientX);
      const y = Math.min(this.dragStart.y, event.clientY);
      this.selection.rect = {
        x,
        y,
        width: Math.max(1, Math.abs(event.clientX - this.dragStart.x)),
        height: Math.max(1, Math.abs(event.clientY - this.dragStart.y)),
      };
      this.render();
      return;
    }

    if (["element", "move-source"].includes(this.mode)) {
      const target = event.target instanceof Element ? event.target : null;
      if (target && !event.composedPath().includes(this)) {
        this.hoverRect = plainRect(target.getBoundingClientRect());
        this.renderOverlay();
      }
    }

    if (this.mode === "move-target" && this.selection) {
      const rect = this.currentSelectionRect();
      this.arrow = {
        start: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        end: { x: event.clientX, y: event.clientY },
      };
      this.renderOverlay();
    }
  }

  onPointerUp(event) {
    if (!this.dragStart || this.mode !== "region") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dragStart = null;
    if (this.selection.rect.width < 8 || this.selection.rect.height < 8) {
      this.selection = null;
      this.setStatus("Drag a larger area.", true);
    } else {
      this.mode = "idle";
      this.setStatus("Area selected.");
    }
    this.render();
  }

  onDocumentClick(event) {
    if (!this.suppressNextClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = false;
  }

  onKeyDown(event) {
    if (event.key === "Escape" && this.mode !== "idle") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancelMode();
    }
  }

  selectElement(element) {
    this.selectedElement = element;
    this.selection = {
      kind: "element",
      rect: plainRect(element.getBoundingClientRect()),
      element: describeElement(element),
    };
    this.arrow = null;
    this.hoverRect = null;
    this.invalidatePreview();
  }

  refreshSelectionRect() {
    if (!this.selection || !this.selectedElement || !this.selectedElement.isConnected) return;
    const previous = this.selection.rect;
    const next = plainRect(this.selectedElement.getBoundingClientRect());
    this.selection.rect = next;
    if (this.arrow) {
      const dx = next.x + next.width / 2 - (previous.x + previous.width / 2);
      const dy = next.y + next.height / 2 - (previous.y + previous.height / 2);
      this.arrow.start = { x: this.arrow.start.x + dx, y: this.arrow.start.y + dy };
    }
    this.invalidatePreview();
    this.render();
  }

  currentSelectionRect() {
    if (this.selectedElement?.isConnected) {
      this.selection.rect = plainRect(this.selectedElement.getBoundingClientRect());
    }
    return this.selection.rect;
  }

  invalidatePreview() {
    this.preview = null;
    this.review.hidden = true;
    this.root.querySelector(".compose-actions").hidden = false;
  }

  leaveReview() {
    this.review.hidden = true;
    this.root.querySelector(".compose-actions").hidden = false;
  }

  async makePreview() {
    const message = this.textarea.value.trim();
    if (!message) {
      this.setStatus("Write a feedback message first.", true);
      this.textarea.focus();
      return;
    }

    this.cancelMode();
    this.reviewButton.disabled = true;
    this.setStatus("Capturing the visible page…");
    try {
      const screenshotDataUrl = await this.captureScreenshot();
      this.preview = this.buildPayload(screenshotDataUrl);
      this.previewImage.src = screenshotDataUrl;
      this.root.querySelector(".compose-actions").hidden = true;
      this.review.hidden = false;
      this.setStatus("Review exactly what the agent will receive.");
    } catch (error) {
      console.error("AgentNudge screenshot failed", error);
      this.setStatus("Could not capture this page. Cross-origin media may be blocking the screenshot.", true);
    } finally {
      this.reviewButton.disabled = false;
    }
  }

  async captureScreenshot() {
    const canvas = await html2canvas(document.documentElement, {
      backgroundColor: getComputedStyle(document.documentElement).backgroundColor || "#ffffff",
      logging: false,
      useCORS: true,
      allowTaint: false,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      ignoreElements: (element) => element === this,
      onclone: (cloneDocument) => {
        cloneDocument.getElementById(HOST_ID)?.remove();
        for (const input of cloneDocument.querySelectorAll("input")) {
          input.value = "[redacted]";
          input.setAttribute("value", "[redacted]");
          input.removeAttribute("checked");
        }
        for (const textarea of cloneDocument.querySelectorAll("textarea")) {
          textarea.value = "[redacted]";
          textarea.textContent = "[redacted]";
        }
        for (const node of cloneDocument.querySelectorAll("[data-agentnudge-redact]")) {
          node.textContent = "[redacted]";
          node.removeAttribute("src");
          node.removeAttribute("href");
        }
      },
    });

    const context = canvas.getContext("2d");
    const scaleX = canvas.width / window.innerWidth;
    const scaleY = canvas.height / window.innerHeight;
    context.save();
    context.scale(scaleX, scaleY);
    if (this.selection) drawSelection(context, this.currentSelectionRect());
    if (this.arrow) drawArrow(context, this.arrow.start, this.arrow.end);
    context.restore();
    return canvas.toDataURL("image/png");
  }

  buildPayload(screenshotDataUrl) {
    const selection = this.selection
      ? {
          kind: this.selection.kind,
          rect: { ...this.currentSelectionRect() },
          element: this.selection.element ? { ...this.selection.element } : null,
        }
      : null;
    return {
      sessionId: SESSION_ID,
      message: this.textarea.value.trim(),
      page: {
        url: `${location.origin}${location.pathname}`,
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      selection,
      arrow: this.arrow ? structuredClone(this.arrow) : null,
      screenshotDataUrl,
    };
  }

  async send() {
    if (!this.preview) return;
    this.sendButton.disabled = true;
    this.setStatus("Sending to the waiting agent…");
    try {
      const response = await fetch(`${ENDPOINT}/submit`, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-AgentNudge-Token": SESSION_TOKEN,
        },
        body: JSON.stringify(this.preview),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      this.setStatus("Sent. The waiting agent has the evidence.");
      this.textarea.disabled = true;
      this.root.querySelectorAll("button:not(.close)").forEach((button) => { button.disabled = true; });
    } catch (error) {
      console.error("AgentNudge submission failed", error);
      this.setStatus(`Could not send feedback: ${error.message}`, true);
      this.sendButton.disabled = false;
    }
  }

  setStatus(message, error = false) {
    this.status.textContent = message;
    this.status.dataset.error = String(error);
  }

  render() {
    this.root.querySelector(".pick").dataset.active = String(this.mode === "element");
    this.root.querySelector(".region").dataset.active = String(this.mode === "region");
    this.root.querySelector(".move").dataset.active = String(["move-source", "move-target"].includes(this.mode));
    if (this.selection) {
      this.evidence.hidden = false;
      if (this.selection.kind === "element") {
        const element = this.selection.element;
        this.evidence.textContent = this.arrow
          ? `Move ${element.tag}${element.accessibleName ? ` “${element.accessibleName}”` : ""} to the arrow destination.`
          : `Selected ${element.tag}${element.accessibleName ? ` “${element.accessibleName}”` : ""}.`;
      } else {
        const rect = this.selection.rect;
        this.evidence.textContent = `Selected area ${Math.round(rect.width)} × ${Math.round(rect.height)}.`;
      }
    } else {
      this.evidence.hidden = true;
      this.evidence.textContent = "";
    }
    this.renderOverlay();
  }

  renderOverlay() {
    setRect(this.hoverBox, this.hoverRect, Boolean(this.hoverRect));
    const selectionRect = this.selection ? this.currentSelectionRect() : null;
    setRect(this.selectionBox, selectionRect, Boolean(selectionRect));
    if (this.arrow) {
      setLine(this.arrowLine, this.arrow.start, this.arrow.end);
      this.arrowLine.setAttribute("visibility", "visible");
    } else {
      this.arrowLine.setAttribute("visibility", "hidden");
    }
    const label = {
      element: "Click an element",
      region: "Drag to select an area",
      "move-source": "Click the thing that should move",
      "move-target": "Click its new destination",
    }[this.mode];
    this.modePill.hidden = !label;
    this.modePill.textContent = label || "";
  }
}

function describeElement(element) {
  const classes = Array.from(element.classList || []).slice(0, 20);
  const text = element.matches("input, textarea, [contenteditable]")
    ? null
    : normalizedText(element.textContent).slice(0, 500) || null;
  const accessibleName = normalizedText(
    element.getAttribute("aria-label") || element.getAttribute("title") || text || "",
  ).slice(0, 300) || null;
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    classes,
    role: element.getAttribute("role") || implicitRole(element),
    accessibleName,
    text,
    selector: cssSelector(element),
  };
}

function implicitRole(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "textarea") return "textbox";
  if (tag === "input") return element.type === "checkbox" ? "checkbox" : "textbox";
  if (tag === "img") return "img";
  return null;
}

function cssSelector(element) {
  if (element.id) return `#${escapeCss(element.id)}`;
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
    let part = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((value) => value.tagName === current.tagName)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    if (current === document.body) break;
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function escapeCss(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function plainRect(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function setRect(node, rect, visible) {
  node.setAttribute("visibility", visible ? "visible" : "hidden");
  if (!rect) return;
  node.setAttribute("x", rect.x);
  node.setAttribute("y", rect.y);
  node.setAttribute("width", rect.width);
  node.setAttribute("height", rect.height);
  node.setAttribute("rx", 5);
}

function setLine(node, start, end) {
  node.setAttribute("x1", start.x);
  node.setAttribute("y1", start.y);
  node.setAttribute("x2", end.x);
  node.setAttribute("y2", end.y);
}

function drawSelection(context, rect) {
  context.save();
  context.fillStyle = "rgba(239, 111, 67, .12)";
  context.strokeStyle = "#dc5835";
  context.lineWidth = 3;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

function drawArrow(context, start, end) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = 13;
  context.save();
  context.strokeStyle = "#dc5835";
  context.fillStyle = "#dc5835";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
  context.restore();
}

if (location.origin !== ALLOWED_ORIGIN) {
  console.warn(`AgentNudge refused to start on ${location.origin}; the waiting CLI allows ${ALLOWED_ORIGIN}.`);
} else if (!document.getElementById(HOST_ID)) {
  if (!customElements.get("agent-nudge-widget")) customElements.define("agent-nudge-widget", AgentNudgeWidget);
  const widget = document.createElement("agent-nudge-widget");
  widget.id = HOST_ID;
  document.documentElement.append(widget);
}
