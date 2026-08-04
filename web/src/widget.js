import html2canvas from "html2canvas";

const ENDPOINT = "__AGENTNUDGE_ENDPOINT__";
const ALLOWED_ORIGIN = "__AGENTNUDGE_ORIGIN__";
const SESSION_ID = "__AGENTNUDGE_SESSION__";
const SESSION_TOKEN = "__AGENTNUDGE_TOKEN__";
const HOST_ID = "agentnudge-widget";
const INK_COLOR = "#dc5835";
const INK_WIDTH = 4;

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
  .launcher, .panel, .draw-toolbar { position: relative; z-index: 2; }
  .launcher:focus-visible, button:focus-visible, textarea:focus-visible {
    outline: 3px solid rgba(80, 98, 20, .35);
    outline-offset: 2px;
  }

  .panel {
    width: min(370px, calc(100vw - 28px));
    max-height: min(680px, calc(100vh - 28px));
    overflow: auto;
    border: 1px solid #d8d5ca;
    border-radius: 14px;
    background: #fffdf7;
    box-shadow: 0 10px 34px rgba(20, 20, 18, .2);
    padding: 14px;
  }

  .panel[hidden], .launcher[hidden], .review[hidden],
  .annotation-summary[hidden], .draw-toolbar[hidden] { display: none; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .title { font-size: 15px; font-weight: 760; letter-spacing: -.01em; }
  .close { border: 0; background: transparent; cursor: pointer; color: #5d5b54; padding: 4px; }
  .hint { margin: 6px 0 10px; color: #67645c; font-size: 12px; }

  textarea {
    display: block;
    width: 100%;
    min-height: 76px;
    resize: vertical;
    border: 1px solid #c9c5b9;
    border-radius: 9px;
    background: white;
    color: #1b1b1a;
    padding: 9px 10px;
  }

  .field-label { display: block; margin: 0 0 6px; color: #67645c; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .tools, .actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 10px; }
  button.tool, button.secondary, button.primary, button.remove-sticky {
    border-radius: 999px;
    padding: 7px 10px;
    cursor: pointer;
    border: 1px solid #c9c5b9;
    background: #fff;
    color: #1b1b1a;
  }
  button.tool:hover, button.secondary:hover, button.remove-sticky:hover { background: #f3f0e7; }
  button.tool[data-active="true"] { border-color: #536514; background: #f1ffb7; }
  button.primary { border-color: #1b1b1a; background: #1b1b1a; color: white; margin-left: auto; }
  button.primary:hover { background: #363632; }
  button:disabled { cursor: default; opacity: .55; }

  .annotation-summary {
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
    z-index: 1;
  }
  .overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .hover-box { fill: rgba(164, 194, 56, .12); stroke: #61751a; stroke-width: 2; stroke-dasharray: 6 4; }
  .pending-box { fill: rgba(239, 111, 67, .10); stroke: #dc5835; stroke-width: 3; }
  .annotation-box { fill: rgba(239, 111, 67, .08); stroke: #dc5835; stroke-width: 2.5; }
  .annotation-pin { fill: #dc5835; stroke: white; stroke-width: 2; }
  .annotation-number { fill: white; font: 800 11px ui-sans-serif, -apple-system, sans-serif; text-anchor: middle; dominant-baseline: central; }
  .drawing-stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; }

  .sticky-layer { position: absolute; inset: 0; pointer-events: none; }
  .sticky-card {
    position: fixed;
    width: min(230px, calc(100vw - 24px));
    padding: 10px 11px;
    border: 1px solid #c6a946;
    border-radius: 9px;
    background: #fff4b8;
    color: #292511;
    box-shadow: 0 5px 18px rgba(45, 38, 10, .18);
    pointer-events: auto;
  }
  .sticky-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
  .sticky-number { width: 22px; height: 22px; display: grid; place-items: center; flex: none; border-radius: 50%; background: #dc5835; color: white; font-size: 11px; font-weight: 800; }
  .sticky-target { min-width: 0; flex: 1; color: #776a2a; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sticky-message { font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; white-space: pre-wrap; }
  .sticky-card textarea { min-height: 86px; resize: vertical; border-color: #c6a946; background: #fffdf1; }
  .sticky-card .actions { margin-top: 7px; }
  button.remove-sticky { border: 0; padding: 2px 4px; background: transparent; color: #776a2a; font-size: 11px; }

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

  .draw-toolbar {
    position: fixed;
    left: 50%;
    top: 18px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px;
    border: 1px solid #1b1b1a;
    border-radius: 999px;
    background: #fffdf7;
    box-shadow: 0 3px 14px rgba(20, 20, 18, .16);
    pointer-events: auto;
  }
  .draw-toolbar span { padding: 0 5px 0 7px; font-size: 12px; font-weight: 750; }
  .draw-toolbar button { margin: 0; }
`;

class AgentNudgeWidget extends HTMLElement {
  constructor() {
    super();
    this.mode = "idle";
    this.comments = [];
    this.strokes = [];
    this.commentCounter = 0;
    this.draftSelection = null;
    this.draftElement = null;
    this.draftPosition = null;
    this.draftMessage = "";
    this.hoverRect = null;
    this.dragStart = null;
    this.pointerTarget = null;
    this.currentStroke = null;
    this.preview = null;
    this.suppressNextClick = false;
    this.abort = new AbortController();

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${css}</style>
      <button class="launcher" type="button" aria-label="Open AgentNudge feedback">N</button>
      <section class="panel" role="dialog" aria-label="Send feedback to the working agent" hidden>
        <div class="head">
          <div class="title">Comment on this page</div>
          <button class="close" type="button" aria-label="Close feedback">Close</button>
        </div>
        <p class="hint">Attach comments to anything on the page, draw directly over it, then send everything together.</p>
        <label class="field-label" for="agentnudge-overall">Overall note (optional)</label>
        <textarea id="agentnudge-overall" class="overall" maxlength="10000" placeholder="Anything the agent should know about the page as a whole…"></textarea>
        <div class="tools" aria-label="Annotation tools">
          <button class="tool comment-mode" type="button">Comments</button>
          <button class="tool draw-mode" type="button">Draw</button>
          <button class="secondary clear-all" type="button">Clear all</button>
        </div>
        <div class="annotation-summary" hidden></div>
        <p class="status" aria-live="polite"></p>
        <div class="actions compose-actions">
          <button class="primary review-button" type="button">Review and send</button>
        </div>
        <div class="review" hidden>
          <img alt="Exact annotated screenshot that will be shared with the agent">
          <p class="review-note">Sticky notes and drawings are included exactly as shown. Inputs and marked redaction regions are masked.</p>
          <div class="actions">
            <button class="secondary back" type="button">Back</button>
            <button class="primary send" type="button">Send all feedback</button>
          </div>
        </div>
      </section>
      <div class="overlay" aria-hidden="true">
        <svg>
          <rect class="hover-box" visibility="hidden"></rect>
          <rect class="pending-box" visibility="hidden"></rect>
          <g class="annotation-layer"></g>
          <g class="drawing-layer"></g>
        </svg>
        <div class="sticky-layer"></div>
        <div class="mode-pill" hidden></div>
      </div>
      <div class="draw-toolbar" role="toolbar" aria-label="Drawing controls" hidden>
        <span>Drawing</span>
        <button class="secondary undo-stroke" type="button">Undo</button>
        <button class="primary finish-drawing" type="button">Done</button>
      </div>
    `;

    this.root = root;
    this.launcher = root.querySelector(".launcher");
    this.panel = root.querySelector(".panel");
    this.overall = root.querySelector(".overall");
    this.annotationSummary = root.querySelector(".annotation-summary");
    this.status = root.querySelector(".status");
    this.review = root.querySelector(".review");
    this.previewImage = root.querySelector(".review img");
    this.reviewButton = root.querySelector(".review-button");
    this.sendButton = root.querySelector(".send");
    this.hoverBox = root.querySelector(".hover-box");
    this.pendingBox = root.querySelector(".pending-box");
    this.annotationLayer = root.querySelector(".annotation-layer");
    this.drawingLayer = root.querySelector(".drawing-layer");
    this.stickyLayer = root.querySelector(".sticky-layer");
    this.modePill = root.querySelector(".mode-pill");
    this.drawToolbar = root.querySelector(".draw-toolbar");
  }

  connectedCallback() {
    const signal = this.abort.signal;
    this.launcher.addEventListener("click", () => this.open(), { signal });
    this.root.querySelector(".close").addEventListener("click", () => this.close(), { signal });
    this.root.querySelector(".comment-mode").addEventListener("click", () => this.toggleCommentMode(), { signal });
    this.root.querySelector(".draw-mode").addEventListener("click", () => this.beginDrawMode(), { signal });
    this.root.querySelector(".clear-all").addEventListener("click", () => this.clearAll(), { signal });
    this.root.querySelector(".undo-stroke").addEventListener("click", () => this.undoStroke(), { signal });
    this.root.querySelector(".finish-drawing").addEventListener("click", () => this.finishDrawing(), { signal });
    this.reviewButton.addEventListener("click", () => this.makePreview(), { signal });
    this.root.querySelector(".back").addEventListener("click", () => this.leaveReview(), { signal });
    this.sendButton.addEventListener("click", () => this.send(), { signal });
    this.overall.addEventListener("input", () => this.invalidatePreview(), { signal });

    document.addEventListener("pointerdown", (event) => this.onPointerDown(event), { capture: true, signal });
    document.addEventListener("pointermove", (event) => this.onPointerMove(event), { capture: true, signal });
    document.addEventListener("pointerup", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("pointercancel", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("click", (event) => this.onDocumentClick(event), { capture: true, signal });
    document.addEventListener("keydown", (event) => this.onKeyDown(event), { capture: true, signal });
    window.addEventListener("resize", () => this.refreshElementRects(), { signal });
    window.addEventListener("scroll", () => this.refreshElementRects(), { signal, passive: true });
  }

  disconnectedCallback() {
    this.abort.abort();
  }

  open() {
    this.launcher.hidden = true;
    this.panel.hidden = false;
    queueMicrotask(() => this.overall.focus());
  }

  close() {
    this.cancelActiveMode();
    this.panel.hidden = true;
    this.launcher.hidden = false;
  }

  toggleCommentMode() {
    if (this.draftPosition) {
      this.setStatus("Save or cancel the open sticky note first.", true);
      this.focusDraft();
      return;
    }
    if (this.mode === "comment") {
      this.cancelActiveMode();
      this.setStatus("Comments mode finished. Review the page or keep drawing.");
      return;
    }
    this.invalidatePreview();
    this.mode = "comment";
    this.dragStart = null;
    this.pointerTarget = null;
    this.hoverRect = null;
    this.setStatus("Comments mode: click anything, click near a drawing, or drag around an area.");
    this.render();
  }

  beginDrawMode() {
    if (this.draftPosition) {
      this.setStatus("Save or cancel the open sticky note first.", true);
      this.focusDraft();
      return;
    }
    this.invalidatePreview();
    this.mode = "draw";
    this.currentStroke = null;
    this.panel.hidden = true;
    this.drawToolbar.hidden = false;
    this.setStatus("");
    this.render();
  }

  finishDrawing() {
    this.mode = "idle";
    this.currentStroke = null;
    this.drawToolbar.hidden = true;
    this.panel.hidden = false;
    this.setStatus(this.strokes.length ? "Drawing added. Add more feedback or review the batch." : "");
    this.render();
  }

  undoStroke() {
    if (this.strokes.length) {
      this.strokes.pop();
      this.invalidatePreview();
      this.render();
    }
  }

  cancelActiveMode() {
    if (this.mode === "draw") {
      this.drawToolbar.hidden = true;
      this.panel.hidden = false;
    }
    this.mode = "idle";
    this.dragStart = null;
    this.pointerTarget = null;
    this.currentStroke = null;
    this.hoverRect = null;
    this.setStatus("");
    this.render();
  }

  cancelCommentDraft() {
    this.draftSelection = null;
    this.draftElement = null;
    this.draftPosition = null;
    this.draftMessage = "";
    this.invalidatePreview();
    this.setStatus("");
    this.render();
  }

  clearAll() {
    this.cancelActiveMode();
    this.comments = [];
    this.strokes = [];
    this.commentCounter = 0;
    this.draftSelection = null;
    this.draftElement = null;
    this.draftPosition = null;
    this.draftMessage = "";
    this.overall.value = "";
    this.invalidatePreview();
    this.setStatus("All feedback cleared.");
    this.render();
  }

  onPointerDown(event) {
    if (this.mode === "idle" || event.composedPath().includes(this)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = true;

    if (this.mode === "comment") {
      if (this.draftPosition) {
        this.setStatus("Save or cancel the open sticky note first.", true);
        this.focusDraft();
        return;
      }
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.pointerTarget = target;
      this.draftSelection = null;
      const meaningful = meaningfulTarget(target);
      this.hoverRect = meaningful ? plainRect(meaningful.getBoundingClientRect()) : null;
      this.renderOverlay();
      return;
    }

    if (this.mode === "draw") {
      this.currentStroke = {
        points: [{ x: event.clientX, y: event.clientY }],
        color: INK_COLOR,
        width: INK_WIDTH,
      };
      this.strokes.push(this.currentStroke);
      this.renderOverlay();
    }
  }

  onPointerMove(event) {
    if (this.mode === "comment") {
      if (this.dragStart) {
        event.preventDefault();
        const distance = Math.hypot(event.clientX - this.dragStart.x, event.clientY - this.dragStart.y);
        if (distance >= 6) {
          this.hoverRect = null;
          this.draftSelection = {
            kind: "region",
            rect: rectFromPoints(this.dragStart, { x: event.clientX, y: event.clientY }),
            element: null,
          };
        }
        this.renderOverlay();
      } else {
        const target = event.target instanceof Element ? event.target : null;
        if (target && !event.composedPath().includes(this)) {
          const meaningful = meaningfulTarget(target);
          this.hoverRect = meaningful ? plainRect(meaningful.getBoundingClientRect()) : null;
          this.renderOverlay();
        }
      }
      return;
    }

    if (this.mode === "draw" && this.currentStroke) {
      event.preventDefault();
      const point = { x: event.clientX, y: event.clientY };
      const last = this.currentStroke.points.at(-1);
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1.5) {
        this.currentStroke.points.push(point);
        this.renderDrawingLayer();
      }
    }
  }

  onPointerUp(event) {
    if (this.mode === "comment" && this.dragStart) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const distance = Math.hypot(event.clientX - this.dragStart.x, event.clientY - this.dragStart.y);
      const position = { x: event.clientX, y: event.clientY };
      if (distance >= 8 && this.draftSelection) {
        this.draftElement = null;
      } else {
        const target = nearDrawing(position, this.strokes) ? null : meaningfulTarget(this.pointerTarget);
        this.draftElement = target;
        this.draftSelection = target ? {
          kind: "element",
          rect: plainRect(target.getBoundingClientRect()),
          element: describeElement(target),
        } : null;
      }
      this.draftPosition = position;
      this.draftMessage = "";
      this.dragStart = null;
      this.pointerTarget = null;
      this.hoverRect = null;
      this.setStatus(`Sticky placed ${this.draftSelection ? `beside ${selectionLabel(this.draftSelection)}` : "on the page"}.`);
      this.render();
      this.focusDraft();
      return;
    }

    if (this.mode === "draw" && this.currentStroke) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.currentStroke.points.length === 1) {
        const point = this.currentStroke.points[0];
        this.currentStroke.points.push({ x: point.x + 0.01, y: point.y + 0.01 });
      }
      this.currentStroke = null;
      this.invalidatePreview();
      this.render();
    }
  }

  onDocumentClick(event) {
    if (!this.suppressNextClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = false;
  }

  onKeyDown(event) {
    if (event.key !== "Escape" || this.mode === "idle") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.mode === "draw") this.finishDrawing();
    else this.cancelActiveMode();
  }

  saveComment(messageValue) {
    if (!this.draftPosition) return;
    const message = messageValue.trim();
    if (!message) {
      this.setStatus("Write something on the sticky note first.", true);
      this.focusDraft();
      return;
    }
    this.commentCounter += 1;
    this.comments.push({
      id: `comment-${this.commentCounter}`,
      message,
      position: { ...this.draftPosition },
      selection: this.draftSelection ? structuredClone(this.draftSelection) : null,
      element: this.draftElement,
    });
    this.draftSelection = null;
    this.draftElement = null;
    this.draftPosition = null;
    this.draftMessage = "";
    this.invalidatePreview();
    this.setStatus("Sticky saved. Comments mode is still on—click or drag to add another.");
    this.render();
  }

  removeComment(id) {
    this.comments = this.comments.filter((comment) => comment.id !== id);
    this.invalidatePreview();
    this.setStatus("Sticky removed.");
    this.render();
  }

  focusDraft() {
    queueMicrotask(() => this.stickyLayer.querySelector(".sticky-card[data-draft] textarea")?.focus());
  }

  refreshElementRects() {
    for (const comment of this.comments) this.currentCommentRect(comment);
    if (this.draftSelection && this.draftElement?.isConnected) {
      this.draftSelection.rect = plainRect(this.draftElement.getBoundingClientRect());
    }
    this.invalidatePreview();
    this.render();
  }

  currentCommentRect(comment) {
    if (!comment.selection) return null;
    if (comment.element?.isConnected) {
      comment.selection.rect = plainRect(comment.element.getBoundingClientRect());
    }
    return comment.selection.rect;
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
    if (this.draftPosition) {
      this.setStatus("Save or cancel the open sticky note first.", true);
      this.focusDraft();
      return;
    }
    if (!this.overall.value.trim() && this.comments.length === 0 && this.strokes.length === 0) {
      this.setStatus("Add a comment, draw on the page, or write an overall note first.", true);
      return;
    }

    this.cancelActiveMode();
    this.reviewButton.disabled = true;
    this.setStatus("Capturing the annotated page…");
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
    this.strokes.forEach((stroke) => drawStroke(context, stroke));
    this.comments.forEach((comment, index) => {
      drawSticky(
        context,
        comment,
        this.currentCommentRect(comment),
        this.stickyPositionFor(comment),
        index + 1,
      );
    });
    context.restore();
    return canvas.toDataURL("image/png");
  }

  buildPayload(screenshotDataUrl) {
    return {
      sessionId: SESSION_ID,
      message: this.overall.value.trim(),
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
      comments: this.comments.map((comment) => ({
        id: comment.id,
        message: comment.message,
        position: { ...comment.position },
        selection: comment.selection ? {
          kind: comment.selection.kind,
          rect: { ...this.currentCommentRect(comment) },
          element: comment.selection.element ? { ...comment.selection.element } : null,
        } : null,
      })),
      drawings: structuredClone(this.strokes),
      screenshotDataUrl,
    };
  }

  async send() {
    if (!this.preview) return;
    this.sendButton.disabled = true;
    this.setStatus("Sending the full batch to the waiting agent…");
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
      this.setStatus("Sent. The waiting agent has every comment and drawing.");
      this.overall.disabled = true;
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
    this.root.querySelector(".comment-mode").dataset.active = String(this.mode === "comment");
    this.root.querySelector(".draw-mode").dataset.active = String(this.mode === "draw");

    const parts = [];
    if (this.comments.length) parts.push(`${this.comments.length} ${this.comments.length === 1 ? "comment" : "comments"}`);
    if (this.strokes.length) parts.push(`${this.strokes.length} drawing ${this.strokes.length === 1 ? "stroke" : "strokes"}`);
    this.annotationSummary.hidden = parts.length === 0;
    this.annotationSummary.textContent = parts.length ? `${parts.join(" · ")} ready to send together.` : "";

    this.renderOverlay();
  }

  renderOverlay() {
    setRect(this.hoverBox, this.hoverRect, Boolean(this.hoverRect));
    setRect(this.pendingBox, this.draftSelection?.rect, Boolean(this.draftSelection));
    this.renderAnnotationLayer();
    this.renderDrawingLayer();
    this.renderStickyLayer();

    const label = this.mode === "comment" ? "Comments mode · click anywhere or drag an area · Esc to finish" : null;
    this.modePill.hidden = !label || this.mode === "draw";
    this.modePill.textContent = label || "";
  }

  renderAnnotationLayer() {
    this.annotationLayer.replaceChildren();
    this.comments.forEach((comment, index) => {
      const rect = this.currentCommentRect(comment);
      if (rect) {
        this.annotationLayer.append(svgElement("rect", {
          class: "annotation-box",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          rx: 5,
        }));
      }
      const pinX = rect ? Math.max(13, rect.x + 4) : comment.position.x;
      const pinY = rect ? Math.max(13, rect.y + 4) : comment.position.y;
      const pin = svgElement("circle", { class: "annotation-pin", cx: pinX, cy: pinY, r: 12 });
      const number = svgElement("text", { class: "annotation-number", x: pinX, y: pinY });
      number.textContent = String(index + 1);
      this.annotationLayer.append(pin, number);
    });
  }

  renderDrawingLayer() {
    this.drawingLayer.replaceChildren(...this.strokes.map((stroke) => {
      return svgElement("path", {
        class: "drawing-stroke",
        d: strokePath(stroke.points),
        stroke: stroke.color,
        "stroke-width": stroke.width,
      });
    }));
  }

  renderStickyLayer() {
    const cards = this.comments.map((comment, index) => {
      const card = stickyCard({
        number: index + 1,
        message: comment.message,
        target: selectionLabel(comment.selection),
        position: this.stickyPositionFor(comment),
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-sticky";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove sticky ${index + 1}`);
      remove.addEventListener("click", () => this.removeComment(comment.id));
      card.querySelector(".sticky-head").append(remove);
      return card;
    });

    if (this.draftPosition) {
      const draft = stickyCard({
        number: this.comments.length + 1,
        message: null,
        target: selectionLabel(this.draftSelection),
        position: this.stickyPositionFor({
          position: this.draftPosition,
          selection: this.draftSelection,
          element: this.draftElement,
        }),
        draft: true,
      });
      const textarea = document.createElement("textarea");
      textarea.maxLength = 5000;
      textarea.placeholder = "Leave a comment…";
      textarea.setAttribute("aria-label", "Sticky note comment");
      textarea.value = this.draftMessage;
      textarea.addEventListener("input", () => {
        this.draftMessage = textarea.value;
        this.invalidatePreview();
      });
      const actions = document.createElement("div");
      actions.className = "actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => this.cancelCommentDraft());
      const save = document.createElement("button");
      save.type = "button";
      save.className = "primary";
      save.textContent = "Comment";
      save.addEventListener("click", () => this.saveComment(textarea.value));
      actions.append(cancel, save);
      draft.append(textarea, actions);
      cards.push(draft);
    }
    this.stickyLayer.replaceChildren(...cards);
  }

  stickyPositionFor(comment) {
    const rect = comment.selection ? this.currentCommentRect(comment) : null;
    return placeSticky(comment.position, rect);
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

function meaningfulTarget(element) {
  const target = element.closest(
    "button, a, p, h1, h2, h3, h4, h5, h6, li, img, input, textarea, select, article, section, [role], [data-agentnudge-comment-target]",
  );
  if (!target || target === document.body || target === document.documentElement) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width > window.innerWidth * 0.92 && rect.height > window.innerHeight * 0.75) return null;
  return target;
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

function selectionLabel(selection) {
  if (!selection) return "Free sticky";
  if (selection.kind === "region") {
    return `${Math.round(selection.rect.width)} × ${Math.round(selection.rect.height)} area`;
  }
  const element = selection.element;
  return element?.accessibleName ? `${element.tag} “${element.accessibleName}”` : element?.tag || "element";
}

function stickyCard({ number, message, target, position, draft = false }) {
  const card = document.createElement("section");
  card.className = "sticky-card";
  card.style.left = `${position.x}px`;
  card.style.top = `${position.y}px`;
  if (draft) card.dataset.draft = "true";
  const head = document.createElement("div");
  head.className = "sticky-head";
  const badge = document.createElement("span");
  badge.className = "sticky-number";
  badge.textContent = String(number);
  const targetLabel = document.createElement("span");
  targetLabel.className = "sticky-target";
  targetLabel.textContent = target;
  head.append(badge, targetLabel);
  card.append(head);
  if (message !== null) {
    const copy = document.createElement("div");
    copy.className = "sticky-message";
    copy.textContent = message;
    card.append(copy);
  }
  return card;
}

function placeSticky(position, rect) {
  const width = Math.min(230, window.innerWidth - 24);
  const anchorX = rect ? rect.x + rect.width : position.x;
  let x = anchorX + 14;
  if (x + width > window.innerWidth - 12) {
    x = (rect ? rect.x : position.x) - width - 14;
  }
  x = Math.max(12, Math.min(x, window.innerWidth - width - 12));
  const anchorY = rect ? rect.y : position.y;
  const y = Math.max(12, Math.min(anchorY, window.innerHeight - 150));
  return { x, y };
}

function nearDrawing(point, strokes) {
  return strokes.some((stroke) => {
    if (stroke.points.length === 1) return pointDistance(point, stroke.points[0]) <= 12;
    return stroke.points.slice(1).some((end, index) => {
      return pointToSegmentDistance(point, stroke.points[index], end) <= Math.max(10, stroke.width + 6);
    });
  });
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return pointDistance(point, start);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return pointDistance(point, { x: start.x + amount * dx, y: start.y + amount * dy });
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

function rectFromPoints(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
  };
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

function svgElement(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function strokePath(points) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function drawSticky(context, comment, rect, cardPosition, number) {
  const pinX = rect ? Math.max(13, rect.x + 4) : comment.position.x;
  const pinY = rect ? Math.max(13, rect.y + 4) : comment.position.y;
  context.save();
  if (rect) {
    context.fillStyle = "rgba(239, 111, 67, .10)";
    context.strokeStyle = INK_COLOR;
    context.lineWidth = 2.5;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  context.beginPath();
  context.arc(pinX, pinY, 12, 0, Math.PI * 2);
  context.fillStyle = INK_COLOR;
  context.fill();
  context.strokeStyle = "white";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "white";
  context.font = "800 11px ui-sans-serif, -apple-system, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number), pinX, pinY + 0.5);

  const cardWidth = Math.min(230, window.innerWidth - 24);
  const textWidth = cardWidth - 22;
  context.font = "12px ui-sans-serif, -apple-system, sans-serif";
  const lines = wrapCanvasText(context, comment.message, textWidth).slice(0, 18);
  const cardHeight = 45 + Math.max(1, lines.length) * 17;
  context.fillStyle = "#fff4b8";
  context.strokeStyle = "#c6a946";
  context.lineWidth = 1;
  roundedRect(context, cardPosition.x, cardPosition.y, cardWidth, cardHeight, 9);
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(cardPosition.x + 22, cardPosition.y + 21, 11, 0, Math.PI * 2);
  context.fillStyle = INK_COLOR;
  context.fill();
  context.fillStyle = "white";
  context.font = "800 11px ui-sans-serif, -apple-system, sans-serif";
  context.fillText(String(number), cardPosition.x + 22, cardPosition.y + 21.5);
  context.fillStyle = "#776a2a";
  context.font = "10px ui-sans-serif, -apple-system, sans-serif";
  context.textAlign = "left";
  const target = selectionLabel(comment.selection);
  context.fillText(target.slice(0, 30), cardPosition.x + 40, cardPosition.y + 21.5);
  context.fillStyle = "#292511";
  context.font = "12px ui-sans-serif, -apple-system, sans-serif";
  lines.forEach((line, index) => context.fillText(line, cardPosition.x + 11, cardPosition.y + 42 + index * 17));
  context.restore();
}

function wrapCanvasText(context, value, maxWidth) {
  const lines = [];
  for (const paragraph of String(value).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line || " ");
  }
  return lines;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function drawStroke(context, stroke) {
  if (!stroke.points.length) return;
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  }
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
