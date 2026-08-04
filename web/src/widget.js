import html2canvas from "html2canvas";
import { pointInClosedPath, rectanglePoints } from "./annotation-geometry.js";
import { paintAnnotationOverlay } from "./annotation-overlay.js";
import iconUndo from "@tabler/icons/outline/arrow-back-up.svg";
import iconRedo from "@tabler/icons/outline/arrow-forward-up.svg";
import iconCheck from "@tabler/icons/outline/check.svg";
import iconGrip from "@tabler/icons/outline/grip-horizontal.svg";
import iconComment from "@tabler/icons/outline/message-plus.svg";
import iconMessage from "@tabler/icons/outline/message-dots.svg";
import iconNote from "@tabler/icons/outline/note.svg";
import iconPencil from "@tabler/icons/outline/pencil.svg";
import iconPointer from "@tabler/icons/outline/pointer.svg";
import iconRectangle from "@tabler/icons/outline/square-dashed.svg";
import iconSend from "@tabler/icons/outline/send.svg";
import iconTrash from "@tabler/icons/outline/trash.svg";
import iconX from "@tabler/icons/outline/x.svg";

const ENDPOINT = "__AGENTNUDGE_ENDPOINT__";
const ALLOWED_ORIGIN = "__AGENTNUDGE_ORIGIN__";
const SESSION_ID = "__AGENTNUDGE_SESSION__";
const SESSION_TOKEN = "__AGENTNUDGE_TOKEN__";
const HOST_ID = "agentnudge-widget";
const INK_COLOR = "#dc5835";
const INK_WIDTH = 4;
const MAX_HISTORY = 80;

const css = String.raw`
  :host {
    --surface: #fbfaf6;
    --surface-raised: #ffffff;
    --surface-hover: #f0eee8;
    --text: #20201e;
    --muted: #716f68;
    --border: #d6d3ca;
    --accent: #dc5835;
    --accent-soft: #fbe5dd;
    --selection: #2563c7;
    --sticky: #fffef9;
    --sticky-text: #27251f;
    --sticky-muted: #777267;
    --sticky-hover: #f1eee6;
    all: initial;
    position: fixed;
    inset: auto 18px 18px auto;
    z-index: 2147483647;
    color: var(--text);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.4;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --surface: #20211f;
      --surface-raised: #292a27;
      --surface-hover: #353630;
      --text: #f3f1ea;
      --muted: #b8b5ac;
      --border: #4c4d48;
      --accent-soft: #593126;
    }
  }

  * { box-sizing: border-box; }
  button, textarea { font: inherit; }

  .dock {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    gap: 8px;
  }

  .tray {
    width: min(326px, calc(100vw - 78px));
    border: 1px solid var(--border);
    border-radius: 13px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    box-shadow: 0 10px 34px rgb(20 20 18 / .18);
    backdrop-filter: blur(14px) saturate(130%);
    -webkit-backdrop-filter: blur(14px) saturate(130%);
    opacity: 0;
    transform: translateX(22px) scaleX(.88);
    transform-origin: right bottom;
    clip-path: inset(0 0 0 100% round 13px);
    pointer-events: none;
    transition: opacity 180ms ease, transform 260ms cubic-bezier(.2, .8, .2, 1), clip-path 260ms cubic-bezier(.2, .8, .2, 1);
  }

  .dock[data-open="true"] .tray {
    opacity: 1;
    transform: translateX(0) scaleX(1);
    clip-path: inset(0 round 13px);
    pointer-events: auto;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    padding: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .toolbar::-webkit-scrollbar { display: none; }
  .separator { width: 1px; height: 22px; flex: none; margin: 0 2px; background: var(--border); }

  .icon-button, .launcher {
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }
  .icon-button { position: relative; }
  .icon-button:hover { background: var(--surface-hover); color: var(--text); }
  .icon-button:active, .launcher:active { transform: scale(.96); }
  .icon-button[data-active="true"] { background: var(--accent-soft); color: var(--accent); }
  .comment-toggle[data-has-content="true"]::after {
    content: "";
    position: absolute;
    right: 5px;
    top: 5px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }
  .icon-button:disabled { opacity: .32; cursor: default; }
  .icon-button:disabled:hover { background: transparent; color: var(--muted); }
  .icon-button:focus-visible, .launcher:focus-visible, textarea:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 72%, transparent);
    outline-offset: 2px;
  }
  .icon-button svg, .launcher svg, .sticky-icon svg { width: 19px; height: 19px; display: block; }

  .launcher {
    width: 42px;
    height: 42px;
    border: 1px solid var(--text);
    border-radius: 50%;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 4px 16px rgb(20 20 18 / .18);
  }
  .launcher[data-primary="true"] {
    border-color: var(--accent);
    background: var(--accent);
    color: #fffaf5;
  }
  .launcher:disabled { cursor: default; opacity: .72; }
  .launcher svg { transition: transform 220ms cubic-bezier(.2, .8, .2, 1); }
  .dock[data-open="true"] .launcher svg { transform: translateX(1px) rotate(-8deg) scale(.94); }

  .general-note {
    border-top: 1px solid var(--border);
    padding: 9px 10px 11px;
  }
  .general-note[hidden] { display: none; }
  .general-note textarea {
    display: block;
    width: 100%;
    height: 112px;
    min-height: 112px;
    max-height: min(52dvh, 380px);
    resize: none;
    overflow: hidden;
    border: 0;
    border-radius: 9px;
    padding: 10px 11px;
    background: var(--surface-hover);
    color: var(--text);
    line-height: 1.45;
    transition: background-color 160ms ease;
  }
  .general-note textarea::placeholder { color: var(--muted); opacity: .82; }
  .general-note textarea:focus { background: color-mix(in srgb, var(--surface-hover) 76%, var(--surface)); }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 1;
  }
  .overlay > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .hover-box { fill: rgb(164 194 56 / .10); stroke: #61751a; stroke-width: 2; stroke-dasharray: 6 4; }
  .pending-box { fill: rgb(37 99 199 / .08); stroke: var(--selection); stroke-width: 2; stroke-dasharray: 6 4; }
  .annotation-box { fill: rgb(220 88 53 / .07); stroke: var(--accent); stroke-width: 2; }
  .annotation-pin { fill: var(--accent); stroke: var(--surface-raised); stroke-width: 2; }
  .annotation-number { fill: #fffaf5; font: 800 11px ui-sans-serif, -apple-system, sans-serif; text-anchor: middle; dominant-baseline: central; }
  .drawing-stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .drawing-selection { fill: none; stroke: var(--selection); stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 5 4; opacity: .8; }

  .sticky-layer { position: absolute; inset: 0; pointer-events: none; }
  .sticky-card {
    position: fixed;
    left: 0;
    top: 0;
    width: min(248px, calc(100vw - 24px));
    padding: 10px 11px 12px;
    border: 0;
    border-radius: 12px;
    background: var(--sticky);
    color: var(--sticky-text);
    box-shadow: 0 12px 34px rgb(54 45 28 / .16), 0 0 0 1px rgb(76 67 49 / .12);
    pointer-events: auto;
    will-change: transform;
  }
  .sticky-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    margin: -4px -5px 6px;
    padding: 4px 5px;
    cursor: grab;
    touch-action: none;
  }
  .sticky-head:active { cursor: grabbing; }
  .sticky-number { width: 22px; height: 22px; display: grid; place-items: center; flex: none; border-radius: 50%; background: var(--accent); color: #fffaf5; font-size: 11px; font-weight: 800; }
  .sticky-target { min-width: 0; flex: 1; color: var(--sticky-muted); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sticky-icon { width: 26px; height: 26px; display: grid; place-items: center; flex: none; border: 0; border-radius: 7px; padding: 0; background: transparent; color: var(--sticky-muted); cursor: pointer; }
  .sticky-icon:hover { background: var(--sticky-hover); color: var(--sticky-text); }
  .sticky-icon svg { position: static; inset: auto; width: 16px; height: 16px; }
  .sticky-grip { cursor: grab; }
  .sticky-message { min-height: 22px; padding: 2px 1px; font-size: 13px; line-height: 1.46; overflow-wrap: anywhere; white-space: pre-wrap; cursor: text; user-select: text; }
  .sticky-card textarea {
    display: block;
    width: 100%;
    min-height: 54px;
    max-height: min(42dvh, 320px);
    resize: none;
    border: 0;
    border-radius: 6px;
    padding: 7px 8px;
    background: var(--sticky-hover);
    color: var(--sticky-text);
    line-height: 1.46;
  }
  .sticky-card[data-error="true"] textarea { outline: 2px solid var(--accent); }
  .sticky-actions { display: flex; justify-content: flex-end; gap: 4px; margin-top: 7px; }
  .sticky-actions .sticky-icon:last-child { background: var(--sticky-text); color: var(--sticky); }

  @media (prefers-reduced-motion: reduce) {
    .tray, .launcher svg, .icon-button, .general-note textarea { transition: none; }
  }
`;

class AgentNudgeWidget extends HTMLElement {
  constructor() {
    super();
    this.opened = false;
    this.mode = "idle";
    this.comments = [];
    this.strokes = [];
    this.commentCounter = 0;
    this.strokeCounter = 0;
    this.selectedStrokeIds = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.generalBeforeEdit = null;
    this.generalOpen = false;
    this.draft = null;
    this.editingCommentId = null;
    this.editingMessage = "";
    this.hoverRect = null;
    this.pendingRect = null;
    this.dragStart = null;
    this.pointerTarget = null;
    this.currentStroke = null;
    this.preview = null;
    this.suppressNextClick = false;
    this.movingSticky = false;
    this.sent = false;
    this.abort = new AbortController();

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${css}</style>
      <div class="dock" data-open="false">
        <section class="tray" aria-label="AgentNudge annotation tools">
          <div class="toolbar" role="toolbar" aria-label="Annotation modes">
            ${iconButtonMarkup("select-mode", "Select drawing", iconPointer)}
            ${iconButtonMarkup("sticky-mode", "Add sticky note", iconNote)}
            ${iconButtonMarkup("draw-mode", "Draw", iconPencil)}
            ${iconButtonMarkup("region-mode", "Mark area", iconRectangle)}
            ${iconButtonMarkup("comment-toggle", "Page comment", iconComment)}
            <span class="separator" aria-hidden="true"></span>
            ${iconButtonMarkup("undo", "Undo", iconUndo)}
            ${iconButtonMarkup("redo", "Redo", iconRedo)}
            ${iconButtonMarkup("delete-selection", "Delete selected drawing", iconTrash)}
          </div>
          <div class="general-note" hidden>
            <textarea maxlength="10000" aria-label="Page comment" placeholder="Comment on this page"></textarea>
          </div>
        </section>
        <button class="launcher" type="button" aria-label="Open annotation toolbar" aria-expanded="false" title="Open annotation toolbar">${iconMessage}</button>
      </div>
      <div class="overlay">
        <svg aria-hidden="true">
          <rect class="hover-box" visibility="hidden"></rect>
          <rect class="pending-box" visibility="hidden"></rect>
          <g class="annotation-layer"></g>
          <g class="drawing-layer"></g>
        </svg>
        <div class="sticky-layer"></div>
      </div>
      <p class="status sr-only" aria-live="polite"></p>
    `;

    this.root = root;
    this.dock = root.querySelector(".dock");
    this.launcher = root.querySelector(".launcher");
    this.general = root.querySelector(".general-note textarea");
    this.generalPanel = root.querySelector(".general-note");
    this.status = root.querySelector(".status");
    this.hoverBox = root.querySelector(".hover-box");
    this.pendingBox = root.querySelector(".pending-box");
    this.annotationLayer = root.querySelector(".annotation-layer");
    this.drawingLayer = root.querySelector(".drawing-layer");
    this.stickyLayer = root.querySelector(".sticky-layer");
  }

  connectedCallback() {
    const signal = this.abort.signal;
    this.launcher.addEventListener("click", () => this.onLauncherClick(), { signal });
    this.root.querySelector(".select-mode").addEventListener("click", () => this.setMode("select"), { signal });
    this.root.querySelector(".sticky-mode").addEventListener("click", () => this.setMode("sticky"), { signal });
    this.root.querySelector(".draw-mode").addEventListener("click", () => this.setMode("draw"), { signal });
    this.root.querySelector(".region-mode").addEventListener("click", () => this.setMode("region"), { signal });
    this.root.querySelector(".comment-toggle").addEventListener("click", () => this.toggleGeneralComment(), { signal });
    this.root.querySelector(".undo").addEventListener("click", () => this.undo(), { signal });
    this.root.querySelector(".redo").addEventListener("click", () => this.redo(), { signal });
    this.root.querySelector(".delete-selection").addEventListener("click", () => this.deleteSelectedStrokes(), { signal });

    this.general.addEventListener("focus", () => this.beginGeneralEdit(), { signal });
    this.general.addEventListener("input", () => this.onGeneralInput(), { signal });
    this.general.addEventListener("blur", () => this.finishGeneralEdit(), { signal });

    document.addEventListener("pointerdown", (event) => this.onPointerDown(event), { capture: true, signal });
    document.addEventListener("pointermove", (event) => this.onPointerMove(event), { capture: true, signal });
    document.addEventListener("pointerup", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("pointercancel", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("click", (event) => this.onDocumentClick(event), { capture: true, signal });
    document.addEventListener("keydown", (event) => this.onKeyDown(event), { capture: true, signal });
    window.addEventListener("resize", () => this.onViewportChange(), { signal });
    window.addEventListener("scroll", () => this.onViewportChange(), { signal, passive: true });
    this.render();
  }

  disconnectedCallback() {
    this.abort.abort();
  }

  toggleDock() {
    this.opened = !this.opened;
    this.mode = this.opened ? "select" : "idle";
    this.cancelTransientEditors();
    this.render();
  }

  onLauncherClick() {
    if (!this.opened) {
      this.toggleDock();
      return;
    }
    this.send();
  }

  setMode(mode) {
    if (this.sent) return;
    if (this.draft || this.editingCommentId) {
      this.setStatus("Finish the open sticky note first.");
      this.focusStickyEditor();
      return;
    }
    this.mode = mode;
    this.hoverRect = null;
    this.pendingRect = null;
    this.dragStart = null;
    this.pointerTarget = null;
    if (mode !== "select") this.selectedStrokeIds.clear();
    this.invalidatePreview();
    this.render();
  }

  toggleGeneralComment() {
    if (this.sent) return;
    this.generalOpen = !this.generalOpen;
    this.renderGeneralComment();
    if (this.generalOpen) {
      queueMicrotask(() => {
        this.general.focus();
        this.autoSizeGeneral();
      });
    }
  }

  beginGeneralEdit() {
    this.generalBeforeEdit = this.snapshot();
    this.autoSizeGeneral();
  }

  onGeneralInput() {
    this.autoSizeGeneral();
    this.invalidatePreview();
    this.root.querySelector(".comment-toggle").dataset.hasContent = String(Boolean(this.general.value.trim()));
  }

  finishGeneralEdit() {
    if (this.generalBeforeEdit && this.generalBeforeEdit.message !== this.general.value) {
      this.pushUndoSnapshot(this.generalBeforeEdit);
    }
    this.generalBeforeEdit = null;
    this.autoSizeGeneral();
    this.renderHistoryButtons();
  }

  autoSizeGeneral() {
    if (!this.generalOpen) return;
    const maximum = Math.min(380, window.innerHeight * .52);
    this.general.style.height = "112px";
    const height = Math.min(maximum, Math.max(112, this.general.scrollHeight));
    this.general.style.height = `${height}px`;
    this.general.style.overflowY = this.general.scrollHeight > maximum ? "auto" : "hidden";
  }

  onPointerDown(event) {
    if (!this.opened || this.mode === "idle" || event.composedPath().includes(this)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const point = { x: event.clientX, y: event.clientY };

    if (this.draft || this.editingCommentId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.focusStickyEditor();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = true;

    if (this.mode === "select") {
      const stroke = this.hitStroke(point);
      if (stroke) {
        if (!event.shiftKey) this.selectedStrokeIds.clear();
        if (this.selectedStrokeIds.has(stroke.id) && event.shiftKey) this.selectedStrokeIds.delete(stroke.id);
        else this.selectedStrokeIds.add(stroke.id);
      } else {
        this.selectedStrokeIds.clear();
      }
      this.render();
      return;
    }

    if (this.mode === "draw") {
      this.pushUndo();
      this.strokeCounter += 1;
      this.currentStroke = {
        id: `stroke-${this.strokeCounter}`,
        points: [point],
        color: INK_COLOR,
        width: INK_WIDTH,
      };
      this.strokes.push(this.currentStroke);
      this.renderDrawingLayer();
      return;
    }

    if (this.mode === "sticky" || this.mode === "region") {
      this.dragStart = point;
      this.pointerTarget = target;
      this.pendingRect = null;
      if (this.mode === "sticky") {
        const meaningful = meaningfulTarget(target);
        this.hoverRect = meaningful ? plainRect(meaningful.getBoundingClientRect()) : null;
      }
      this.renderOverlay();
    }
  }

  onPointerMove(event) {
    if (event.composedPath().includes(this) || this.movingSticky) return;
    const point = { x: event.clientX, y: event.clientY };
    if (this.mode === "draw" && this.currentStroke) {
      event.preventDefault();
      const last = this.currentStroke.points.at(-1);
      if (!last || pointDistance(point, last) >= 1.5) {
        this.currentStroke.points.push(point);
        this.renderDrawingLayer();
      }
      return;
    }

    if ((this.mode === "sticky" || this.mode === "region") && this.dragStart) {
      event.preventDefault();
      const distance = pointDistance(point, this.dragStart);
      if (distance >= 6) {
        this.hoverRect = null;
        this.pendingRect = rectFromPoints(this.dragStart, point);
      }
      this.renderGuides();
      return;
    }

    if (this.mode === "sticky" && !this.dragStart) {
      const target = event.target instanceof Element ? meaningfulTarget(event.target) : null;
      this.hoverRect = target ? plainRect(target.getBoundingClientRect()) : null;
      this.renderGuides();
    }
  }

  onPointerUp(event) {
    const point = { x: event.clientX, y: event.clientY };
    if (this.mode === "draw" && this.currentStroke) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.currentStroke.points.length === 1) {
        const first = this.currentStroke.points[0];
        this.currentStroke.points.push({ x: first.x + 0.01, y: first.y + 0.01 });
      }
      this.currentStroke = null;
      this.invalidatePreview();
      this.render();
      return;
    }

    if (this.mode === "region" && this.dragStart) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = this.pendingRect;
      this.selectedStrokeIds.clear();
      if (rect && rect.width >= 6 && rect.height >= 6) {
        this.pushUndo();
        this.strokeCounter += 1;
        this.strokes.push({
          id: `stroke-${this.strokeCounter}`,
          points: rectanglePoints(rect),
          color: INK_COLOR,
          width: INK_WIDTH,
        });
      }
      this.dragStart = null;
      this.pointerTarget = null;
      this.pendingRect = null;
      this.render();
      return;
    }

    if (this.mode === "sticky" && this.dragStart) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const distance = pointDistance(point, this.dragStart);
      let selection = null;
      let element = null;
      if (distance >= 8 && this.pendingRect) {
        selection = { kind: "region", rect: { ...this.pendingRect }, element: null };
      } else if (!nearDrawing(point, this.strokes)) {
        element = meaningfulTarget(this.pointerTarget);
        if (element) {
          selection = {
            kind: "element",
            rect: plainRect(element.getBoundingClientRect()),
            element: describeElement(element),
          };
        }
      }
      const cardPosition = placeSticky(point, selection?.rect || null);
      this.draft = {
        position: point,
        cardPosition,
        selection,
        element,
        message: "",
        error: false,
      };
      this.dragStart = null;
      this.pointerTarget = null;
      this.hoverRect = null;
      this.pendingRect = null;
      this.render();
      this.focusStickyEditor();
    }
  }

  onDocumentClick(event) {
    if (!this.suppressNextClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = false;
  }

  onKeyDown(event) {
    const path = event.composedPath();
    const isTyping = path.some((node) => node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement);

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !isTyping) {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && !isTyping && this.selectedStrokeIds.size) {
      event.preventDefault();
      this.deleteSelectedStrokes();
      return;
    }
    if (event.key !== "Escape") return;
    if (this.draft) {
      event.preventDefault();
      this.cancelDraft();
    } else if (this.editingCommentId) {
      event.preventDefault();
      this.cancelEditComment();
    } else if (this.generalOpen) {
      event.preventDefault();
      this.generalOpen = false;
      this.renderGeneralComment();
    } else if (this.opened) {
      event.preventDefault();
      this.opened = false;
      this.mode = "idle";
      this.selectedStrokeIds.clear();
      this.render();
    }
  }

  saveDraft(messageValue) {
    if (!this.draft) return;
    const message = messageValue.trim();
    if (!message) {
      this.draft.error = true;
      this.renderStickyLayer();
      this.focusStickyEditor();
      return;
    }
    this.pushUndo();
    this.commentCounter += 1;
    this.comments.push({
      id: `comment-${this.commentCounter}`,
      message,
      position: { ...this.draft.position },
      cardPosition: { ...this.draft.cardPosition },
      selection: this.draft.selection ? structuredClone(this.draft.selection) : null,
      element: this.draft.element,
    });
    this.draft = null;
    this.invalidatePreview();
    this.render();
  }

  cancelDraft() {
    this.draft = null;
    this.hoverRect = null;
    this.pendingRect = null;
    this.render();
  }

  startEditComment(comment) {
    if (this.draft) return;
    this.editingCommentId = comment.id;
    this.editingMessage = comment.message;
    this.renderStickyLayer();
    this.focusStickyEditor();
  }

  saveEditComment(id, messageValue) {
    const comment = this.comments.find((value) => value.id === id);
    const message = messageValue.trim();
    if (!comment || !message) {
      this.setStatus("A sticky note cannot be empty.");
      this.focusStickyEditor();
      return;
    }
    if (message !== comment.message) {
      this.pushUndo();
      comment.message = message;
      this.invalidatePreview();
    }
    this.editingCommentId = null;
    this.editingMessage = "";
    this.render();
  }

  cancelEditComment() {
    this.editingCommentId = null;
    this.editingMessage = "";
    this.renderStickyLayer();
  }

  removeComment(id) {
    if (!this.comments.some((comment) => comment.id === id)) return;
    this.pushUndo();
    this.comments = this.comments.filter((comment) => comment.id !== id);
    if (this.editingCommentId === id) this.editingCommentId = null;
    this.invalidatePreview();
    this.render();
  }

  beginStickyDrag(event, comment, card) {
    if (event.target.closest("button") || this.editingCommentId === comment.id) return;
    const before = this.snapshot();
    this.trackCardDrag(event, card, comment.cardPosition, (position) => {
      comment.cardPosition = position;
      this.invalidatePreview();
    }, (moved) => {
      if (moved) this.pushUndoSnapshot(before);
      this.renderHistoryButtons();
    });
  }

  deleteSelectedStrokes() {
    if (!this.selectedStrokeIds.size) return;
    this.pushUndo();
    this.strokes = this.strokes.filter((stroke) => !this.selectedStrokeIds.has(stroke.id));
    this.selectedStrokeIds.clear();
    this.invalidatePreview();
    this.render();
  }

  hitStroke(point) {
    return [...this.strokes].reverse().find((stroke) => strokeHitDistance(point, stroke) <= Math.max(8, stroke.width + 5)) || null;
  }

  snapshot() {
    return {
      message: this.general?.value || "",
      comments: this.comments.map((comment) => ({
        id: comment.id,
        message: comment.message,
        position: { ...comment.position },
        cardPosition: { ...comment.cardPosition },
        selection: comment.selection ? structuredClone(comment.selection) : null,
      })),
      strokes: structuredClone(this.strokes),
    };
  }

  pushUndo() {
    this.pushUndoSnapshot(this.snapshot());
  }

  pushUndoSnapshot(snapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.renderHistoryButtons();
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.restore(previous);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  restore(snapshot) {
    this.general.value = snapshot.message;
    this.comments = snapshot.comments.map((comment) => ({
      ...structuredClone(comment),
      element: resolveCommentElement(comment),
    }));
    this.strokes = structuredClone(snapshot.strokes);
    this.selectedStrokeIds.clear();
    this.cancelTransientEditors();
    this.invalidatePreview();
    this.autoSizeGeneral();
    this.render();
  }

  cancelTransientEditors() {
    this.draft = null;
    this.editingCommentId = null;
    this.editingMessage = "";
    this.dragStart = null;
    this.pointerTarget = null;
    this.hoverRect = null;
    this.pendingRect = null;
    this.currentStroke = null;
  }

  currentCommentRect(comment) {
    if (!comment.selection) return null;
    if (comment.element?.isConnected) {
      comment.selection.rect = plainRect(comment.element.getBoundingClientRect());
    }
    return comment.selection.rect;
  }

  onViewportChange() {
    for (const comment of this.comments) this.currentCommentRect(comment);
    if (this.draft?.element?.isConnected) {
      this.draft.selection.rect = plainRect(this.draft.element.getBoundingClientRect());
    }
    this.invalidatePreview();
    this.renderGuides();
    this.renderAnnotationLayer();
  }

  invalidatePreview() {
    this.preview = null;
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
    paintAnnotationOverlay({
      context,
      canvas,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      strokes: this.strokes,
      comments: this.comments,
      resolveCommentRect: (comment) => this.currentCommentRect(comment),
      paintStroke: drawStroke,
      paintSticky: drawSticky,
    });
    return canvas.toDataURL("image/png");
  }

  buildPayload(screenshotDataUrl) {
    return {
      sessionId: SESSION_ID,
      message: this.general.value.trim(),
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
        cardPosition: { ...comment.cardPosition },
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
    if (this.sent || !this.finishEditorsForSend()) return;
    if (!this.general.value.trim() && this.comments.length === 0 && this.strokes.length === 0) {
      this.setStatus("Add feedback before sending.");
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.dock.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(0)" }], { duration: 180 });
      }
      return;
    }
    this.launcher.disabled = true;
    this.setStatus("Capturing feedback.");
    try {
      const screenshotDataUrl = await this.captureScreenshot();
      this.preview = this.buildPayload(screenshotDataUrl);
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
      this.sent = true;
      this.setStatus("Feedback sent.");
      this.render();
    } catch (error) {
      console.error("AgentNudge submission failed", error);
      this.setStatus("Feedback could not be sent.");
      this.launcher.disabled = false;
    }
  }

  finishEditorsForSend() {
    if (this.draft) {
      if (!this.draft.message.trim()) {
        this.setStatus("Write the open sticky note before sending.");
        this.focusStickyEditor();
        return false;
      }
      this.saveDraft(this.draft.message);
    }
    if (this.editingCommentId) {
      if (!this.editingMessage.trim()) {
        this.setStatus("A sticky note cannot be empty.");
        this.focusStickyEditor();
        return false;
      }
      this.saveEditComment(this.editingCommentId, this.editingMessage);
    }
    return true;
  }

  focusStickyEditor() {
    queueMicrotask(() => this.stickyLayer.querySelector("textarea")?.focus());
  }

  setStatus(message) {
    this.status.textContent = message;
    this.dock.title = message;
  }

  render() {
    this.dock.dataset.open = String(this.opened);
    this.launcher.dataset.primary = String(this.opened);
    this.launcher.innerHTML = this.sent ? iconCheck : (this.opened ? iconSend : iconMessage);
    const launcherLabel = this.sent ? "Feedback sent" : (this.opened ? "Send feedback" : "Open annotation toolbar");
    this.launcher.setAttribute("aria-expanded", String(this.opened));
    this.launcher.setAttribute("aria-label", launcherLabel);
    this.launcher.title = launcherLabel;
    this.launcher.disabled = this.sent;
    for (const mode of ["select", "sticky", "draw", "region"]) {
      const button = this.root.querySelector(`.${mode}-mode`);
      button.dataset.active = String(this.mode === mode);
      button.setAttribute("aria-pressed", String(this.mode === mode));
    }
    this.root.querySelectorAll(".toolbar .icon-button").forEach((button) => {
      if (!button.matches(".undo, .redo, .delete-selection")) button.disabled = this.sent;
    });
    this.general.disabled = this.sent;
    this.renderGeneralComment();
    this.renderHistoryButtons();
    this.renderOverlay();
  }

  renderHistoryButtons() {
    this.root.querySelector(".undo").disabled = this.sent || this.undoStack.length === 0;
    this.root.querySelector(".redo").disabled = this.sent || this.redoStack.length === 0;
    this.root.querySelector(".delete-selection").disabled = this.sent || this.selectedStrokeIds.size === 0;
  }

  renderGeneralComment() {
    const button = this.root.querySelector(".comment-toggle");
    this.generalPanel.hidden = !this.generalOpen;
    button.dataset.active = String(this.generalOpen);
    button.dataset.hasContent = String(Boolean(this.general.value.trim()));
    button.setAttribute("aria-pressed", String(this.generalOpen));
    button.disabled = this.sent;
    if (this.generalOpen) this.autoSizeGeneral();
  }

  renderOverlay() {
    this.renderGuides();
    this.renderAnnotationLayer();
    this.renderDrawingLayer();
    this.renderStickyLayer();
    this.renderHistoryButtons();
  }

  renderGuides() {
    setRect(this.hoverBox, this.hoverRect, Boolean(this.hoverRect));
    setRect(this.pendingBox, this.pendingRect, Boolean(this.pendingRect));
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
    const nodes = [];
    for (const stroke of this.strokes) {
      if (this.selectedStrokeIds.has(stroke.id)) {
        nodes.push(svgElement("path", {
          class: "drawing-selection",
          d: strokePath(stroke.points),
          "stroke-width": stroke.width + 7,
        }));
      }
      nodes.push(svgElement("path", {
        class: "drawing-stroke",
        d: strokePath(stroke.points),
        stroke: stroke.color,
        "stroke-width": stroke.width,
      }));
    }
    this.drawingLayer.replaceChildren(...nodes);
  }

  renderStickyLayer() {
    const cards = this.comments.map((comment, index) => this.savedStickyCard(comment, index + 1));
    if (this.draft) cards.push(this.draftStickyCard());
    this.stickyLayer.replaceChildren(...cards);
  }

  savedStickyCard(comment, number) {
    const editing = this.editingCommentId === comment.id;
    const card = baseStickyCard(number, selectionLabel(comment.selection), comment.cardPosition);
    const head = card.querySelector(".sticky-head");
    const grip = document.createElement("span");
    grip.className = "sticky-icon sticky-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.innerHTML = iconGrip;
    head.append(grip);

    if (!editing) {
      const remove = createIconButton("Delete sticky", iconTrash, "sticky-icon");
      remove.addEventListener("pointerdown", (event) => event.stopPropagation());
      remove.addEventListener("click", () => this.removeComment(comment.id));
      head.append(remove);
      const copy = document.createElement("div");
      copy.className = "sticky-message";
      copy.textContent = comment.message;
      copy.title = "Double-click to edit";
      copy.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        this.startEditComment(comment);
      });
      card.append(copy);
    } else {
      const textarea = document.createElement("textarea");
      textarea.maxLength = 5000;
      textarea.value = this.editingMessage;
      textarea.setAttribute("aria-label", "Edit sticky note");
      textarea.addEventListener("input", () => {
        this.editingMessage = textarea.value;
        autoSizeTextarea(textarea);
      });
      textarea.addEventListener("blur", () => {
        if (textarea.value.trim()) this.saveEditComment(comment.id, textarea.value);
        else this.cancelEditComment();
      }, { once: true });
      textarea.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          textarea.blur();
        }
      });
      card.append(textarea);
      queueMicrotask(() => autoSizeTextarea(textarea));
    }

    head.addEventListener("pointerdown", (event) => this.beginStickyDrag(event, comment, card));
    return card;
  }

  draftStickyCard() {
    const card = baseStickyCard(this.comments.length + 1, selectionLabel(this.draft.selection), this.draft.cardPosition);
    card.dataset.draft = "true";
    card.dataset.error = String(Boolean(this.draft.error));
    const head = card.querySelector(".sticky-head");
    const grip = document.createElement("span");
    grip.className = "sticky-icon sticky-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.innerHTML = iconGrip;
    head.append(grip);
    head.addEventListener("pointerdown", (event) => this.beginDraftDrag(event, card));
    const textarea = document.createElement("textarea");
    textarea.maxLength = 5000;
    textarea.value = this.draft.message;
    textarea.setAttribute("aria-label", "New sticky note");
    textarea.addEventListener("input", () => {
      this.draft.message = textarea.value;
      this.draft.error = false;
      card.dataset.error = "false";
      this.invalidatePreview();
      autoSizeTextarea(textarea);
    });
    textarea.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") this.saveDraft(textarea.value);
    });
    const actions = document.createElement("div");
    actions.className = "sticky-actions";
    const cancel = createIconButton("Cancel sticky", iconX, "sticky-icon");
    cancel.addEventListener("click", () => this.cancelDraft());
    const save = createIconButton("Save sticky", iconCheck, "sticky-icon");
    save.addEventListener("click", () => this.saveDraft(textarea.value));
    actions.append(cancel, save);
    card.append(textarea, actions);
    queueMicrotask(() => autoSizeTextarea(textarea));
    return card;
  }

  beginDraftDrag(event, card) {
    if (event.target.closest("button")) return;
    this.trackCardDrag(event, card, this.draft.cardPosition, (position) => {
      this.draft.cardPosition = position;
      this.invalidatePreview();
    }, () => this.focusStickyEditor());
  }

  trackCardDrag(event, card, startPosition, onMove, onFinish) {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    const origin = { ...startPosition };
    let moved = false;
    let finished = false;
    this.movingSticky = true;
    card.dataset.dragging = "true";

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (Math.hypot(dx, dy) > 2) moved = true;
      const position = clampCardPosition({
        x: origin.x + dx,
        y: origin.y + dy,
      });
      onMove(position);
      card.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    };
    const up = (upEvent) => {
      if (finished || upEvent.pointerId !== pointerId) return;
      finished = true;
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      delete card.dataset.dragging;
      this.movingSticky = false;
      onFinish(moved);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
  }
}

function iconButtonMarkup(className, label, svg, extraClass = "") {
  return `<button class="icon-button ${className} ${extraClass}" type="button" aria-label="${label}" title="${label}">${svg}</button>`;
}

function createIconButton(label, svg, className = "icon-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = svg;
  return button;
}

function baseStickyCard(number, target, position) {
  const card = document.createElement("section");
  card.className = "sticky-card";
  card.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
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
  return card;
}

function resolveCommentElement(comment) {
  const selector = comment.selection?.element?.selector;
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
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
  if (rect.width > window.innerWidth * .92 && rect.height > window.innerHeight * .75) return null;
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
  if (!selection) return "";
  if (selection.kind === "region") return `${Math.round(selection.rect.width)} × ${Math.round(selection.rect.height)}`;
  const element = selection.element;
  return element?.accessibleName ? `${element.tag} “${element.accessibleName}”` : element?.tag || "";
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

function placeSticky(position, rect) {
  const width = Math.min(248, window.innerWidth - 24);
  const anchorX = rect ? rect.x + rect.width : position.x;
  let x = anchorX + 14;
  if (x + width > window.innerWidth - 12) x = (rect ? rect.x : position.x) - width - 14;
  return clampCardPosition({ x, y: rect ? rect.y : position.y });
}

function clampCardPosition(position) {
  const width = Math.min(248, window.innerWidth - 24);
  return {
    x: Math.max(12, Math.min(position.x, window.innerWidth - width - 12)),
    y: Math.max(12, Math.min(position.y, window.innerHeight - 100)),
  };
}

function nearDrawing(point, strokes) {
  return strokes.some((stroke) => strokeHitDistance(point, stroke) <= Math.max(10, stroke.width + 6));
}

function strokeHitDistance(point, stroke) {
  if (pointInClosedPath(point, stroke.points)) return 0;
  if (stroke.points.length === 1) return pointDistance(point, stroke.points[0]);
  return Math.min(...stroke.points.slice(1).map((end, index) => pointToSegmentDistance(point, stroke.points[index], end)));
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

function drawSticky(context, comment, rect, cardPosition, number) {
  const pinX = rect ? Math.max(13, rect.x + 4) : comment.position.x;
  const pinY = rect ? Math.max(13, rect.y + 4) : comment.position.y;
  context.save();
  if (rect) {
    context.fillStyle = "rgba(220, 88, 53, .09)";
    context.strokeStyle = INK_COLOR;
    context.lineWidth = 2;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  context.beginPath();
  context.arc(pinX, pinY, 12, 0, Math.PI * 2);
  context.fillStyle = INK_COLOR;
  context.fill();
  context.strokeStyle = "#fffaf5";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#fffaf5";
  context.font = "800 11px ui-sans-serif, -apple-system, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number), pinX, pinY + .5);

  const cardWidth = Math.min(248, window.innerWidth - 24);
  const textWidth = cardWidth - 22;
  context.font = "12px ui-sans-serif, -apple-system, sans-serif";
  const lines = wrapCanvasText(context, comment.message, textWidth).slice(0, 18);
  const cardHeight = 45 + Math.max(1, lines.length) * 17;
  context.shadowColor = "rgba(54, 45, 28, .16)";
  context.shadowBlur = 22;
  context.shadowOffsetY = 8;
  context.fillStyle = "#fffef9";
  context.strokeStyle = "#d8d3c7";
  context.lineWidth = 1;
  roundedRect(context, cardPosition.x, cardPosition.y, cardWidth, cardHeight, 9);
  context.fill();
  context.shadowColor = "transparent";
  context.stroke();
  context.beginPath();
  context.arc(cardPosition.x + 22, cardPosition.y + 21, 11, 0, Math.PI * 2);
  context.fillStyle = INK_COLOR;
  context.fill();
  context.fillStyle = "#fffaf5";
  context.font = "800 11px ui-sans-serif, -apple-system, sans-serif";
  context.fillText(String(number), cardPosition.x + 22, cardPosition.y + 21.5);
  context.fillStyle = "#27251f";
  context.font = "12px ui-sans-serif, -apple-system, sans-serif";
  context.textAlign = "left";
  lines.forEach((line, index) => context.fillText(line, cardPosition.x + 11, cardPosition.y + 42 + index * 17));
  context.restore();
}

function autoSizeTextarea(textarea) {
  const maximum = Math.min(320, window.innerHeight * .42);
  textarea.style.height = "54px";
  const height = Math.min(maximum, Math.max(54, textarea.scrollHeight));
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > maximum ? "auto" : "hidden";
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

if (location.origin !== ALLOWED_ORIGIN) {
  console.warn(`AgentNudge refused to start on ${location.origin}; the waiting CLI allows ${ALLOWED_ORIGIN}.`);
} else if (!document.getElementById(HOST_ID)) {
  if (!customElements.get("agent-nudge-widget")) customElements.define("agent-nudge-widget", AgentNudgeWidget);
  const widget = document.createElement("agent-nudge-widget");
  widget.id = HOST_ID;
  document.documentElement.append(widget);
}
