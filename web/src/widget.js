import html2canvas from "html2canvas";
import { paintMessageAttachments } from "./annotation-overlay.js";
import {
  browserCommandRequestUrl,
  createPageId,
  performBrowserAction,
  safePageUrl,
} from "./browser-control.js";
import { replyImageLabel, replyImageRequestUrl } from "./reply-images.js";
import iconUndo from "@tabler/icons/outline/arrow-back-up.svg";
import iconRedo from "@tabler/icons/outline/arrow-forward-up.svg";
import iconCheck from "@tabler/icons/outline/check.svg";
import iconMessage from "@tabler/icons/outline/message-dots.svg";
import iconPencil from "@tabler/icons/outline/pencil.svg";
import iconPointer from "@tabler/icons/outline/pointer.svg";
import iconRectangle from "@tabler/icons/outline/square-dashed.svg";
import iconSend from "@tabler/icons/outline/send.svg";
import iconX from "@tabler/icons/outline/x.svg";

const ENDPOINT = "__AGENTNUDGE_ENDPOINT__";
const ALLOWED_ORIGIN = "__AGENTNUDGE_ORIGIN__";
const SESSION_ID = "__AGENTNUDGE_SESSION__";
const BROWSER_TOKEN = "__AGENTNUDGE_BROWSER_TOKEN__";
const BROWSER_CONTROL_ENABLED = Boolean(__AGENTNUDGE_BROWSER_CONTROL__);
const PAGE_ID = createPageId();
const HOST_ID = "agentnudge-widget";
const INK_COLOR = "#df5b39";
const INK_WIDTH = 4;

const css = String.raw`
  :host {
    --paper: #faf9f5;
    --panel: #fffefa;
    --raised: #ffffff;
    --soft: #f1efe9;
    --soft-hover: #e9e6de;
    --text: #24231f;
    --muted: #77736a;
    --faint: #a29d92;
    --line: #ddd9cf;
    --accent: #df5b39;
    --accent-soft: #fbe7df;
    --accent-text: #8f321c;
    --pick: #68812b;
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    color: var(--text);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.4;
    pointer-events: none;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --paper: #1f201e;
      --panel: #242522;
      --raised: #2b2c28;
      --soft: #30312d;
      --soft-hover: #3a3b36;
      --text: #f4f1e9;
      --muted: #bbb6aa;
      --faint: #8e8a80;
      --line: #484943;
      --accent-soft: #563126;
      --accent-text: #ffb29c;
    }
  }

  * { box-sizing: border-box; }
  button, textarea { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; }

  .launcher {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 4;
    width: 46px;
    height: 46px;
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--text) 82%, transparent);
    border-radius: 50%;
    background: var(--paper);
    color: var(--text);
    box-shadow: 0 7px 24px rgb(24 22 18 / .18);
    cursor: pointer;
    pointer-events: auto;
    transition: transform 220ms cubic-bezier(.2,.8,.2,1), opacity 160ms ease, background 140ms ease;
  }
  .launcher:hover { background: var(--raised); transform: translateY(-1px); }
  .launcher:active { transform: scale(.96); }
  .launcher svg { width: 21px; height: 21px; }
  .shell[data-open="true"] .launcher { opacity: 0; transform: translateX(16px) scale(.82); pointer-events: none; }

  .sidebar {
    position: fixed;
    z-index: 3;
    top: 12px;
    right: 12px;
    bottom: 12px;
    width: min(390px, calc(100vw - 24px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: color-mix(in srgb, var(--panel) 97%, transparent);
    box-shadow: 0 24px 70px rgb(24 22 18 / .24), 0 2px 8px rgb(24 22 18 / .08);
    backdrop-filter: blur(18px) saturate(120%);
    -webkit-backdrop-filter: blur(18px) saturate(120%);
    opacity: 0;
    transform: translateX(24px) scale(.985);
    transform-origin: right center;
    pointer-events: none;
    transition: opacity 180ms ease, transform 280ms cubic-bezier(.2,.8,.2,1);
  }
  .shell[data-open="true"] .sidebar { opacity: 1; transform: translateX(0) scale(1); pointer-events: auto; }
  .shell[data-capturing="true"] .sidebar { opacity: 0; transform: translateX(calc(100% + 26px)); pointer-events: none; }

  .header {
    min-height: 58px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 10px 10px 16px;
    border-bottom: 1px solid var(--line);
  }
  .brand-mark { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; background: var(--accent); color: #fffaf6; }
  .brand-mark svg { width: 16px; height: 16px; }
  .brand { min-width: 0; flex: 1; }
  .brand strong { display: block; font-size: 13px; font-weight: 720; letter-spacing: -.01em; }
  .connection { display: flex; align-items: center; gap: 5px; margin-top: 1px; color: var(--muted); font-size: 10px; }
  .connection::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #7d9a34; box-shadow: 0 0 0 2px rgb(125 154 52 / .13); }
  .connection[data-error="true"]::before { background: var(--accent); }

  .icon-button {
    position: relative;
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 120ms ease;
  }
  .icon-button:hover { background: var(--soft); color: var(--text); }
  .icon-button:active { transform: scale(.95); }
  .icon-button[data-active="true"] { background: var(--accent-soft); color: var(--accent); }
  .icon-button:disabled { opacity: .35; cursor: default; }
  .icon-button svg { width: 18px; height: 18px; display: block; }
  .icon-button:focus-visible, .launcher:focus-visible, textarea:focus-visible, .attachment-chip:focus-visible, .reply-image-card:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 72%, transparent);
    outline-offset: 2px;
  }

  .messages {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 18px 15px 22px;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }
  .empty { min-height: 100%; display: grid; place-content: center; justify-items: center; padding: 32px; text-align: center; color: var(--muted); }
  .empty-mark { width: 42px; height: 42px; display: grid; place-items: center; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--raised); color: var(--accent); box-shadow: 0 4px 18px rgb(24 22 18 / .07); }
  .empty-mark svg { width: 20px; height: 20px; }
  .empty strong { color: var(--text); font-size: 14px; font-weight: 680; }
  .empty p { max-width: 230px; margin: 6px 0 0; font-size: 12px; line-height: 1.5; }

  .message { display: flex; flex-direction: column; align-items: flex-start; margin: 0 0 18px; }
  .message.user { align-items: flex-end; }
  .message-label { margin: 0 5px 5px; color: var(--faint); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .bubble { max-width: 88%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 14px 14px 14px 4px; background: var(--raised); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 2px 7px rgb(24 22 18 / .04); }
  .user .bubble { border-color: color-mix(in srgb, var(--accent) 22%, var(--line)); border-radius: 14px 14px 4px 14px; background: var(--accent-soft); color: var(--accent-text); box-shadow: none; }
  .message-attachments { width: min(88%, 310px); display: flex; flex-wrap: wrap; justify-content: inherit; gap: 6px; margin-top: 7px; }
  .message-attachment { min-width: 0; max-width: 100%; display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 4px 8px 4px 4px; background: var(--panel); color: var(--muted); cursor: pointer; }
  .message-attachment:hover, .message-attachment[data-active="true"] { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); color: var(--text); }
  .attachment-number { width: 20px; height: 20px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: #fffaf6; font-size: 10px; font-weight: 800; }
  .message-attachment span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
  .reply-reference { max-width: 88%; margin: -1px 5px 6px; color: var(--faint); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reply-images { width: min(88%, 310px); display: grid; grid-template-columns: repeat(auto-fit, minmax(126px, 1fr)); gap: 7px; margin-top: 7px; }
  .reply-image-card { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; padding: 0; background: var(--raised); color: var(--text); text-align: left; cursor: zoom-in; box-shadow: 0 2px 7px rgb(24 22 18 / .04); }
  .reply-image-card:hover { border-color: color-mix(in srgb, var(--accent) 44%, var(--line)); }
  .reply-image-media { height: 112px; display: grid; place-items: center; overflow: hidden; background: var(--soft); color: var(--faint); font-size: 10px; }
  .reply-image-media img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .reply-image-media img:not([src]) { visibility: hidden; }
  .reply-image-name { display: block; overflow: hidden; padding: 7px 8px; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

  .image-viewer { position: fixed; z-index: 8; inset: 0; display: grid; place-items: center; padding: 28px; background: rgb(18 17 15 / .78); opacity: 0; pointer-events: none; transition: opacity 150ms ease; }
  .image-viewer[data-open="true"] { opacity: 1; pointer-events: auto; }
  .image-viewer-card { position: relative; width: min(900px, 94vw); max-height: 90vh; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; border: 1px solid rgb(255 255 255 / .22); border-radius: 16px; background: var(--panel); box-shadow: 0 30px 90px rgb(0 0 0 / .4); }
  .image-viewer-media { min-height: 180px; display: grid; place-items: center; overflow: auto; background: #161613; color: #ddd8ce; }
  .image-viewer-media img { display: block; max-width: 100%; max-height: calc(90vh - 54px); object-fit: contain; }
  .image-viewer-media img:not([src]) { display: none; }
  .image-viewer-caption { min-width: 0; overflow: hidden; padding: 11px 52px 11px 14px; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .image-viewer-close { position: absolute; z-index: 1; right: 8px; bottom: 7px; background: var(--soft); color: var(--text); }

  .composer-wrap { padding: 0 10px 10px; }
  .composer {
    border: 1px solid var(--line);
    border-radius: 15px;
    background: var(--raised);
    box-shadow: 0 5px 20px rgb(24 22 18 / .07);
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }
  .composer:focus-within { border-color: color-mix(in srgb, var(--accent) 48%, var(--line)); box-shadow: 0 7px 24px rgb(24 22 18 / .09); }
  .draft-attachments { display: flex; gap: 6px; padding: 9px 9px 0; overflow-x: auto; scrollbar-width: none; }
  .draft-attachments:empty { display: none; }
  .draft-attachments::-webkit-scrollbar { display: none; }
  .attachment-chip { min-width: 0; max-width: 210px; flex: none; display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 3px 4px 3px 3px; background: var(--soft); color: var(--text); cursor: pointer; }
  .attachment-chip > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
  .chip-remove { width: 20px; height: 20px; display: grid; place-items: center; border: 0; border-radius: 50%; padding: 0; background: transparent; color: var(--faint); cursor: pointer; }
  .chip-remove:hover { background: var(--soft-hover); color: var(--text); }
  .chip-remove svg { width: 12px; height: 12px; }
  .composer textarea { display: block; width: 100%; height: 46px; min-height: 46px; max-height: 150px; resize: none; overflow-y: hidden; border: 0; padding: 12px 13px 5px; background: transparent; color: var(--text); line-height: 1.45; }
  .composer textarea::placeholder { color: var(--faint); }
  .composer textarea:focus { outline: 0; }
  .composer-actions { min-height: 45px; display: flex; align-items: center; padding: 4px 5px 5px; }
  .tool-group { display: flex; align-items: center; gap: 1px; }
  .tool-group .icon-button { width: 32px; height: 32px; }
  .send-button { width: 34px; height: 34px; margin-left: auto; display: grid; place-items: center; border: 0; border-radius: 10px; background: var(--accent); color: #fffaf6; cursor: pointer; transition: transform 120ms ease, opacity 120ms ease; }
  .send-button:hover { transform: translateY(-1px); }
  .send-button:active { transform: scale(.95); }
  .send-button:disabled { opacity: .42; cursor: default; transform: none; }
  .send-button svg { width: 17px; height: 17px; transform: translateX(1px); }
  .composer-status { min-height: 14px; margin: 5px 4px 0; color: var(--muted); font-size: 10px; }
  .composer-status[data-error="true"] { color: var(--accent); }

  .capture-rail {
    position: fixed;
    z-index: 4;
    right: 18px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 5px;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: var(--panel);
    box-shadow: 0 9px 30px rgb(24 22 18 / .2);
    opacity: 0;
    transform: translateY(10px) scale(.94);
    pointer-events: none;
    transition: opacity 140ms ease, transform 180ms cubic-bezier(.2,.8,.2,1);
  }
  .shell[data-capturing="true"] .capture-rail { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
  .capture-mode { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; background: var(--accent-soft); color: var(--accent); }
  .capture-mode svg { width: 18px; height: 18px; }
  .capture-divider { width: 1px; height: 22px; margin: 0 2px; background: var(--line); }

  .overlay { position: fixed; inset: 0; z-index: 1; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; }
  .hover-box { fill: rgb(104 129 43 / .08); stroke: var(--pick); stroke-width: 2; stroke-dasharray: 6 4; }
  .pending-box { fill: rgb(223 91 57 / .06); stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 4; }
  .attachment-box { fill: rgb(223 91 57 / .06); stroke: var(--accent); stroke-width: 2; }
  .attachment-box.drawing { fill: none; stroke-dasharray: 4 4; opacity: .55; }
  .ink { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .pin { fill: var(--accent); stroke: #fffefa; stroke-width: 2; }
  .pin-text { fill: #fffaf6; font: 800 11px ui-sans-serif, -apple-system, sans-serif; text-anchor: middle; dominant-baseline: central; }

  @media (max-width: 520px) {
    .sidebar { inset: 7px; width: auto; border-radius: 15px; }
    .launcher { right: 14px; bottom: 14px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .launcher, .sidebar, .capture-rail { transition-duration: 1ms; }
  }
`;

class AgentNudgeWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.opened = false;
    this.mode = "idle";
    this.messages = [];
    this.cursor = 0;
    this.draftAttachments = [];
    this.attachmentCounter = 0;
    this.strokeCounter = 0;
    this.currentStroke = null;
    this.activeDrawingId = null;
    this.dragStart = null;
    this.pendingRect = null;
    this.hoverRect = null;
    this.focusedMessageId = null;
    this.suppressNextClick = false;
    this.sending = false;
    this.undoStack = [];
    this.redoStack = [];
    this.replyImageCache = new Map();
    this.abort = new AbortController();
    this.pollAbort = new AbortController();

    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="shell" data-open="false" data-capturing="false">
        <button class="launcher" type="button" aria-label="Open AgentNudge chat" title="Open chat">${iconMessage}</button>
        <aside class="sidebar" aria-label="AgentNudge chat">
          <header class="header">
            <div class="brand-mark">${iconMessage}</div>
            <div class="brand"><strong>AgentNudge</strong><span class="connection">Connected locally</span></div>
            ${iconButtonMarkup("close", "Close chat", iconX)}
          </header>
          <section class="messages" aria-live="polite"></section>
          <div class="composer-wrap">
            <div class="composer">
              <div class="draft-attachments"></div>
              <textarea aria-label="Message the agent" placeholder="Ask about this page…" rows="1"></textarea>
              <div class="composer-actions">
                <div class="tool-group" role="toolbar" aria-label="Attach page context">
                  ${iconButtonMarkup("attach-element", "Attach element", iconPointer)}
                  ${iconButtonMarkup("attach-region", "Attach region", iconRectangle)}
                  ${iconButtonMarkup("attach-drawing", "Attach drawing", iconPencil)}
                </div>
                <button class="send-button" type="button" aria-label="Send message" title="Send message">${iconSend}</button>
              </div>
            </div>
            <div class="composer-status" aria-live="polite"></div>
          </div>
        </aside>
        <div class="capture-rail" role="toolbar" aria-label="Page attachment controls">
          <div class="capture-mode"></div>
          <div class="capture-divider"></div>
          ${iconButtonMarkup("capture-undo", "Undo last attachment action", iconUndo)}
          ${iconButtonMarkup("capture-redo", "Redo attachment action", iconRedo)}
          ${iconButtonMarkup("capture-finish", "Finish attaching", iconCheck)}
        </div>
        <svg class="overlay" aria-hidden="true"></svg>
        <div class="image-viewer" data-open="false" role="dialog" aria-modal="true" aria-label="Attached image preview">
          <div class="image-viewer-card">
            <div class="image-viewer-media"><span>Loading image…</span><img alt=""></div>
            <div class="image-viewer-caption"></div>
            ${iconButtonMarkup("image-viewer-close", "Close image preview", iconX)}
          </div>
        </div>
      </div>
    `;
    this.shell = this.shadowRoot.querySelector(".shell");
    this.sidebar = this.shadowRoot.querySelector(".sidebar");
    this.messagesNode = this.shadowRoot.querySelector(".messages");
    this.textarea = this.shadowRoot.querySelector("textarea");
    this.draftNode = this.shadowRoot.querySelector(".draft-attachments");
    this.statusNode = this.shadowRoot.querySelector(".composer-status");
    this.connectionNode = this.shadowRoot.querySelector(".connection");
    this.sendButton = this.shadowRoot.querySelector(".send-button");
    this.overlay = this.shadowRoot.querySelector(".overlay");
    this.captureModeNode = this.shadowRoot.querySelector(".capture-mode");
    this.imageViewer = this.shadowRoot.querySelector(".image-viewer");
    this.imageViewerImage = this.shadowRoot.querySelector(".image-viewer img");
    this.imageViewerStatus = this.shadowRoot.querySelector(".image-viewer-media span");
    this.imageViewerCaption = this.shadowRoot.querySelector(".image-viewer-caption");
  }

  connectedCallback() {
    const { signal } = this.abort;
    this.shadowRoot.querySelector(".launcher").addEventListener("click", () => this.open(), { signal });
    this.shadowRoot.querySelector(".close").addEventListener("click", () => this.close(), { signal });
    this.shadowRoot.querySelector(".attach-element").addEventListener("click", () => this.startCapture("element"), { signal });
    this.shadowRoot.querySelector(".attach-region").addEventListener("click", () => this.startCapture("region"), { signal });
    this.shadowRoot.querySelector(".attach-drawing").addEventListener("click", () => this.startCapture("drawing"), { signal });
    this.shadowRoot.querySelector(".capture-undo").addEventListener("click", () => this.undoCapture(), { signal });
    this.shadowRoot.querySelector(".capture-redo").addEventListener("click", () => this.redoCapture(), { signal });
    this.shadowRoot.querySelector(".capture-finish").addEventListener("click", () => this.finishCapture(), { signal });
    this.shadowRoot.querySelector(".image-viewer-close").addEventListener("click", () => this.closeReplyImage(), { signal });
    this.imageViewer.addEventListener("click", (event) => {
      if (event.target === this.imageViewer) this.closeReplyImage();
    }, { signal });
    this.sendButton.addEventListener("click", () => this.send(), { signal });
    this.textarea.addEventListener("input", () => this.onTextInput(), { signal });
    this.textarea.addEventListener("keydown", (event) => this.onComposerKeyDown(event), { signal });
    document.addEventListener("pointerdown", (event) => this.onPointerDown(event), { capture: true, signal });
    document.addEventListener("pointermove", (event) => this.onPointerMove(event), { capture: true, signal });
    document.addEventListener("pointerup", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("pointercancel", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("click", (event) => this.onDocumentClick(event), { capture: true, signal });
    document.addEventListener("keydown", (event) => this.onGlobalKeyDown(event), { capture: true, signal });
    window.addEventListener("resize", () => this.renderOverlay(), { signal });
    window.addEventListener("scroll", () => this.renderOverlay(), { signal, passive: true });
    this.renderAll();
    this.pollConversation();
    if (BROWSER_CONTROL_ENABLED) this.pollBrowserCommands();
  }

  disconnectedCallback() {
    this.abort.abort();
    this.pollAbort.abort();
    for (const record of this.replyImageCache.values()) {
      if (record.url) URL.revokeObjectURL(record.url);
    }
    this.replyImageCache.clear();
  }

  open() {
    this.opened = true;
    this.renderShell();
    queueMicrotask(() => this.textarea.focus());
  }

  close() {
    if (this.mode !== "idle") this.finishCapture();
    this.opened = false;
    this.focusedMessageId = null;
    this.renderAll();
  }

  startCapture(mode) {
    if (this.sending) return;
    this.opened = true;
    this.mode = mode;
    this.dragStart = null;
    this.pendingRect = null;
    this.hoverRect = null;
    this.focusedMessageId = null;
    this.activeDrawingId = null;
    this.captureModeNode.innerHTML = mode === "element" ? iconPointer : mode === "region" ? iconRectangle : iconPencil;
    this.setStatus(mode === "element" ? "Select an element on the page." : mode === "region" ? "Drag around the area to attach." : "Draw on the page, then press Done.");
    this.renderAll();
  }

  finishCapture() {
    this.mode = "idle";
    this.currentStroke = null;
    this.activeDrawingId = null;
    this.dragStart = null;
    this.pendingRect = null;
    this.hoverRect = null;
    this.setStatus("");
    this.renderAll();
    queueMicrotask(() => this.textarea.focus());
  }

  undoCapture() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(structuredClone(this.draftAttachments));
    this.restoreDraft(previous);
  }

  redoCapture() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.draftAttachments));
    this.restoreDraft(next);
  }

  onPointerDown(event) {
    if (this.mode === "idle" || event.composedPath().includes(this)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const point = { x: event.clientX, y: event.clientY };
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = true;

    if (this.mode === "element") {
      const element = meaningfulTarget(target);
      if (!element) return;
      this.addAttachment({
        kind: "element",
        rect: plainRect(element.getBoundingClientRect()),
        element: describeElement(element),
        strokes: [],
      });
      this.finishCapture();
      return;
    }
    if (this.mode === "region") {
      this.dragStart = point;
      this.pendingRect = null;
      return;
    }
    if (this.mode === "drawing") {
      let attachment = this.draftAttachments.find((value) => value.id === this.activeDrawingId);
      if (!attachment) {
        attachment = this.addAttachment({ kind: "drawing", rect: null, element: null, strokes: [] });
        this.activeDrawingId = attachment.id;
      } else {
        this.pushUndo();
      }
      this.strokeCounter += 1;
      this.currentStroke = {
        id: `stroke-${this.strokeCounter}`,
        points: [point],
        color: INK_COLOR,
        width: INK_WIDTH,
      };
      attachment.strokes.push(this.currentStroke);
      this.renderOverlay();
    }
  }

  onPointerMove(event) {
    if (this.mode === "idle" || event.composedPath().includes(this)) return;
    const point = { x: event.clientX, y: event.clientY };
    if (this.mode === "element") {
      const target = event.target instanceof Element ? meaningfulTarget(event.target) : null;
      this.hoverRect = target ? plainRect(target.getBoundingClientRect()) : null;
      this.renderOverlay();
      return;
    }
    if (this.mode === "region" && this.dragStart) {
      event.preventDefault();
      this.pendingRect = rectFromPoints(this.dragStart, point);
      this.renderOverlay();
      return;
    }
    if (this.mode === "drawing" && this.currentStroke) {
      event.preventDefault();
      const last = this.currentStroke.points.at(-1);
      if (!last || pointDistance(point, last) >= 1.5) {
        this.currentStroke.points.push(point);
        this.renderOverlay();
      }
    }
  }

  onPointerUp(event) {
    const point = { x: event.clientX, y: event.clientY };
    if (this.mode === "region" && this.dragStart) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = this.pendingRect || rectFromPoints(this.dragStart, point);
      this.dragStart = null;
      this.pendingRect = null;
      if (rect.width >= 6 && rect.height >= 6) this.addAttachment({ kind: "region", rect, element: null, strokes: [] });
      this.finishCapture();
      return;
    }
    if (this.mode === "drawing" && this.currentStroke) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.currentStroke.points.length === 1) {
        const first = this.currentStroke.points[0];
        this.currentStroke.points.push({ x: first.x + .01, y: first.y + .01 });
      }
      const attachment = this.draftAttachments.find((value) => value.id === this.activeDrawingId);
      if (attachment) attachment.rect = drawingBounds(attachment.strokes);
      this.currentStroke = null;
      this.renderAll();
    }
  }

  onDocumentClick(event) {
    if (!this.suppressNextClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = false;
  }

  onComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  onGlobalKeyDown(event) {
    if (this.mode !== "idle" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redoCapture();
      else this.undoCapture();
      return;
    }
    if (event.key !== "Escape") return;
    if (this.imageViewer.dataset.open === "true") {
      event.preventDefault();
      this.closeReplyImage();
    } else if (this.mode !== "idle") {
      event.preventDefault();
      this.finishCapture();
    } else if (this.opened && !event.composedPath().includes(this.textarea)) {
      event.preventDefault();
      this.close();
    }
  }

  onTextInput() {
    autoSizeTextarea(this.textarea);
    this.updateSendButton();
  }

  addAttachment(value) {
    this.pushUndo();
    this.attachmentCounter += 1;
    const attachment = { id: `attachment-${this.attachmentCounter}`, ...value };
    this.draftAttachments.push(attachment);
    this.renderAll();
    return attachment;
  }

  removeAttachment(id) {
    if (!this.draftAttachments.some((value) => value.id === id)) return;
    this.pushUndo();
    this.draftAttachments = this.draftAttachments.filter((value) => value.id !== id);
    if (this.activeDrawingId === id) this.activeDrawingId = null;
    this.renderAll();
  }

  focusMessage(messageId) {
    this.focusedMessageId = this.focusedMessageId === messageId ? null : messageId;
    this.renderMessages();
    this.renderOverlay();
  }

  pushUndo() {
    this.undoStack.push(structuredClone(this.draftAttachments));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }

  restoreDraft(snapshot) {
    this.draftAttachments = structuredClone(snapshot);
    this.activeDrawingId = this.mode === "drawing"
      ? this.draftAttachments.filter((value) => value.kind === "drawing").at(-1)?.id || null
      : null;
    this.renderAll();
  }

  async pollConversation() {
    while (this.isConnected && !this.pollAbort.signal.aborted) {
      try {
        const response = await fetch(`${ENDPOINT}/conversation?after=${this.cursor}`, {
          method: "GET",
          mode: "cors",
          cache: "no-store",
          headers: { "X-AgentNudge-Token": BROWSER_TOKEN },
          signal: this.pollAbort.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
        if (Array.isArray(result.messages) && result.messages.length) {
          const nearBottom = this.messagesNode.scrollHeight - this.messagesNode.scrollTop - this.messagesNode.clientHeight < 90;
          const known = new Set(this.messages.map((value) => value.id));
          for (const message of result.messages) if (!known.has(message.id)) this.messages.push(message);
          this.messages.sort((first, second) => first.sequence - second.sequence);
          this.cursor = Math.max(this.cursor, Number(result.cursor) || 0);
          if (result.messages.some((message) => message.role === "agent")) this.setStatus("");
          this.renderMessages();
          if (nearBottom || this.opened) queueMicrotask(() => { this.messagesNode.scrollTop = this.messagesNode.scrollHeight; });
        }
        this.setConnection("Connected locally", false);
      } catch (error) {
        if (this.pollAbort.signal.aborted) return;
        console.error("AgentNudge conversation poll failed", error);
        this.setConnection("Reconnecting…", true);
        await delay(1200);
      }
    }
  }

  async pollBrowserCommands() {
    while (this.isConnected && !this.pollAbort.signal.aborted) {
      try {
        const response = await fetch(
          browserCommandRequestUrl(ENDPOINT, PAGE_ID, location, document.title),
          {
            method: "GET",
            mode: "cors",
            cache: "no-store",
            headers: { "X-AgentNudge-Token": BROWSER_TOKEN },
            signal: this.pollAbort.signal,
          },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
        if (result.status === "command" && result.command) {
          await this.handleBrowserCommand(result.command);
        }
      } catch (error) {
        if (this.pollAbort.signal.aborted) return;
        this.setConnection("Browser control reconnecting…", true);
        await delay(1200);
      }
    }
  }

  async handleBrowserCommand(command) {
    if (command.session !== SESSION_ID || command.pageId !== PAGE_ID || !command.commandId) return;
    const remaining = Math.max(1, Number(command.expiresAtUnixMs) - Date.now());
    this.setConnection("Agent is controlling this page…", false);
    let status = "completed";
    let value = null;
    let errorMessage = null;
    let afterAcknowledge = null;
    try {
      if (remaining <= 1) throw new Error("The browser action expired before it reached the page");
      const result = await performBrowserAction(command.action, {
        document,
        window,
        host: this,
        allowedOrigin: ALLOWED_ORIGIN,
        timeoutMs: remaining,
        captureScreenshot: () => this.captureScreenshot(),
      });
      value = result.value ?? null;
      afterAcknowledge = result.afterAcknowledge ?? null;
    } catch (error) {
      status = "error";
      errorMessage = truncate(error instanceof Error ? error.message : "Browser action failed", 2000);
    }

    const response = await fetch(`${ENDPOINT}/browser/commands/${encodeURIComponent(command.commandId)}`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-AgentNudge-Token": BROWSER_TOKEN,
      },
      body: JSON.stringify({
        commandId: command.commandId,
        pageId: PAGE_ID,
        status,
        value,
        error: errorMessage,
        currentUrl: safePageUrl(location),
        title: document.title,
      }),
      signal: this.pollAbort.signal,
    });
    if (!response.ok && response.status !== 410) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || result.error || `HTTP ${response.status}`);
    }
    this.setConnection("Connected locally", false);
    if (response.ok && status === "completed") afterAcknowledge?.();
  }

  async send() {
    if (this.sending) return;
    if (this.mode !== "idle") this.finishCapture();
    const text = this.textarea.value.trim();
    if (!text && this.draftAttachments.length === 0) {
      this.setStatus("Write a message or attach something from the page.", true);
      this.textarea.focus();
      return;
    }

    this.sending = true;
    this.updateSendButton();
    this.setStatus("Capturing the page…");
    try {
      const screenshotDataUrl = await this.captureScreenshot();
      this.setStatus("Sending…");
      const response = await fetch(`${ENDPOINT}/messages`, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-AgentNudge-Token": BROWSER_TOKEN,
        },
        body: JSON.stringify(this.buildPayload(text, screenshotDataUrl)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      this.focusedMessageId = result.messageId;
      this.textarea.value = "";
      this.draftAttachments = [];
      this.activeDrawingId = null;
      this.undoStack = [];
      this.redoStack = [];
      autoSizeTextarea(this.textarea);
      this.setStatus("Sent. Waiting for the agent.");
      this.renderAll();
      queueMicrotask(() => this.textarea.focus());
    } catch (error) {
      console.error("AgentNudge message failed", error);
      this.setStatus("Message could not be sent.", true);
    } finally {
      this.sending = false;
      this.updateSendButton();
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
    paintMessageAttachments({
      context,
      canvas,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      attachments: this.draftAttachments,
      resolveAttachmentRect: (attachment) => this.resolveAttachmentRect(attachment),
      paintStroke: drawStroke,
      paintMarker: drawAttachmentMarker,
    });
    return canvas.toDataURL("image/png");
  }

  buildPayload(text, screenshotDataUrl) {
    return {
      sessionId: SESSION_ID,
      text,
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
      attachments: this.draftAttachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        rect: this.resolveAttachmentRect(attachment),
        element: attachment.element ? { ...attachment.element } : null,
        strokes: structuredClone(attachment.strokes),
      })),
      screenshotDataUrl,
    };
  }

  resolveAttachmentRect(attachment) {
    if (attachment.kind === "element" && attachment.element?.selector) {
      try {
        const element = document.querySelector(attachment.element.selector);
        if (element) attachment.rect = plainRect(element.getBoundingClientRect());
      } catch {}
    }
    return attachment.rect;
  }

  visibleAttachments() {
    if (this.draftAttachments.length) return this.draftAttachments;
    if (!this.focusedMessageId) return [];
    return this.messages.find((value) => value.id === this.focusedMessageId)?.attachments || [];
  }

  renderAll() {
    this.renderShell();
    this.renderDraftAttachments();
    this.renderMessages();
    this.renderOverlay();
    this.updateSendButton();
  }

  renderShell() {
    this.shell.dataset.open = String(this.opened);
    this.shell.dataset.capturing = String(this.mode !== "idle");
    for (const mode of ["element", "region", "drawing"]) {
      this.shadowRoot.querySelector(`.attach-${mode}`).dataset.active = String(this.mode === mode);
    }
    this.shadowRoot.querySelector(".capture-undo").disabled = this.undoStack.length === 0;
    this.shadowRoot.querySelector(".capture-redo").disabled = this.redoStack.length === 0;
  }

  renderDraftAttachments() {
    this.draftNode.replaceChildren();
    this.draftAttachments.forEach((attachment, index) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      chip.tabIndex = 0;
      chip.title = attachmentLabel(attachment);
      const number = document.createElement("span");
      number.className = "attachment-number";
      number.textContent = String(index + 1);
      const label = document.createElement("span");
      label.textContent = attachmentLabel(attachment);
      const remove = document.createElement("button");
      remove.className = "chip-remove";
      remove.type = "button";
      remove.ariaLabel = `Remove ${attachmentLabel(attachment)}`;
      remove.title = "Remove attachment";
      remove.innerHTML = iconX;
      remove.addEventListener("click", () => this.removeAttachment(attachment.id));
      chip.append(number, label, remove);
      this.draftNode.append(chip);
    });
  }

  renderMessages() {
    const oldScroll = this.messagesNode.scrollTop;
    this.messagesNode.replaceChildren();
    if (!this.messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = `<div class="empty-mark">${iconMessage}</div><strong>Talk to the agent</strong><p>Ask a question or attach something directly from the page.</p>`;
      this.messagesNode.append(empty);
      return;
    }
    for (const message of this.messages) {
      const article = document.createElement("article");
      article.className = `message ${message.role}`;
      article.dataset.messageId = message.id;
      const label = document.createElement("div");
      label.className = "message-label";
      label.textContent = message.role === "agent" ? "Agent" : "You";
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = message.text || (message.imageAttachments?.length ? "Attached image" : "Attached context");
      article.append(label);
      if (message.inReplyTo) {
        const target = this.messages.find((value) => value.id === message.inReplyTo);
        const reference = document.createElement("div");
        reference.className = "reply-reference";
        reference.textContent = target?.role === "user" ? "Replying to your message" : "Replying to an earlier message";
        if (target?.text) reference.title = truncate(target.text, 120);
        article.append(reference);
      }
      article.append(bubble);
      if (message.attachments?.length) {
        const attachments = document.createElement("div");
        attachments.className = "message-attachments";
        message.attachments.forEach((attachment, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "message-attachment";
          button.dataset.active = String(this.focusedMessageId === message.id);
          button.title = "Show this attachment on the page";
          const number = document.createElement("span");
          number.className = "attachment-number";
          number.textContent = String(index + 1);
          const text = document.createElement("span");
          text.textContent = attachmentLabel(attachment);
          button.append(number, text);
          button.addEventListener("click", () => this.focusMessage(message.id));
          attachments.append(button);
        });
        article.append(attachments);
      }
      if (message.imageAttachments?.length) {
        const images = document.createElement("div");
        images.className = "reply-images";
        for (const attachment of message.imageAttachments) {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "reply-image-card";
          card.title = `Enlarge ${replyImageLabel(attachment)}`;
          const media = document.createElement("span");
          media.className = "reply-image-media";
          const loading = document.createElement("span");
          loading.textContent = "Loading image…";
          const image = document.createElement("img");
          image.alt = replyImageLabel(attachment);
          const name = document.createElement("span");
          name.className = "reply-image-name";
          name.textContent = replyImageLabel(attachment);
          media.append(loading, image);
          card.append(media, name);
          card.addEventListener("click", () => this.openReplyImage(attachment));
          images.append(card);
          this.populateReplyImage(attachment, image, loading);
        }
        article.append(images);
      }
      this.messagesNode.append(article);
    }
    this.messagesNode.scrollTop = oldScroll;
  }

  async populateReplyImage(attachment, image, status) {
    try {
      const url = await this.replyImageObjectUrl(attachment);
      if (!image.isConnected) return;
      image.src = url;
      status.remove();
    } catch (error) {
      if (!status.isConnected || this.pollAbort.signal.aborted) return;
      console.error("AgentNudge reply image failed", error);
      status.textContent = "Image unavailable";
    }
  }

  async replyImageObjectUrl(attachment) {
    const requestUrl = replyImageRequestUrl(ENDPOINT, SESSION_ID, attachment);
    if (!requestUrl) throw new Error("Invalid reply image descriptor");
    const existing = this.replyImageCache.get(attachment.id);
    if (existing) return existing.promise;

    const record = { url: null, promise: null };
    record.promise = (async () => {
      const response = await fetch(requestUrl, {
        method: "GET",
        mode: "cors",
        cache: "force-cache",
        headers: { "X-AgentNudge-Token": BROWSER_TOKEN },
        signal: this.pollAbort.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Reply asset is not an image");
      record.url = URL.createObjectURL(blob);
      return record.url;
    })();
    this.replyImageCache.set(attachment.id, record);
    try {
      return await record.promise;
    } catch (error) {
      this.replyImageCache.delete(attachment.id);
      throw error;
    }
  }

  async openReplyImage(attachment) {
    this.imageViewer.dataset.open = "true";
    this.imageViewerCaption.textContent = replyImageLabel(attachment);
    this.imageViewerImage.alt = replyImageLabel(attachment);
    this.imageViewerImage.removeAttribute("src");
    this.imageViewerStatus.textContent = "Loading image…";
    this.imageViewerStatus.hidden = false;
    try {
      const url = await this.replyImageObjectUrl(attachment);
      if (this.imageViewer.dataset.open !== "true") return;
      this.imageViewerImage.src = url;
      this.imageViewerStatus.hidden = true;
      this.shadowRoot.querySelector(".image-viewer-close").focus();
    } catch (error) {
      if (this.pollAbort.signal.aborted) return;
      console.error("AgentNudge image preview failed", error);
      this.imageViewerStatus.textContent = "Image unavailable";
    }
  }

  closeReplyImage() {
    this.imageViewer.dataset.open = "false";
    this.imageViewerImage.removeAttribute("src");
  }

  renderOverlay() {
    this.overlay.replaceChildren();
    if (this.hoverRect) this.overlay.append(rectNode(this.hoverRect, "hover-box"));
    if (this.pendingRect) this.overlay.append(rectNode(this.pendingRect, "pending-box"));
    const attachments = this.visibleAttachments();
    attachments.forEach((attachment, index) => {
      for (const stroke of attachment.strokes || []) {
        this.overlay.append(pathNode(stroke));
      }
      const rect = this.resolveAttachmentRect(attachment);
      if (!rect) return;
      if (attachment.kind !== "drawing") this.overlay.append(rectNode(rect, "attachment-box"));
      const pin = markerNodes(rect, index + 1);
      this.overlay.append(...pin);
    });
  }

  updateSendButton() {
    this.sendButton.disabled = this.sending || (!this.textarea.value.trim() && this.draftAttachments.length === 0);
  }

  setStatus(message, error = false) {
    this.statusNode.textContent = message;
    this.statusNode.dataset.error = String(error);
  }

  setConnection(message, error) {
    this.connectionNode.textContent = message;
    this.connectionNode.dataset.error = String(error);
  }
}

function iconButtonMarkup(className, label, svg) {
  return `<button class="icon-button ${className}" type="button" aria-label="${label}" title="${label}">${svg}</button>`;
}

function meaningfulTarget(element) {
  let target = element;
  while (target && target !== document.body) {
    const tag = target.tagName?.toLowerCase();
    const text = normalizedText(target.textContent);
    if (["button", "a", "input", "textarea", "select", "img", "p", "h1", "h2", "h3", "li", "article", "section", "nav"].includes(tag)
      || target.id || target.getAttribute?.("role") || (text && text.length <= 600)) break;
    target = target.parentElement;
  }
  if (!target || target === document.body || target === document.documentElement) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  if (rect.width > window.innerWidth * .96 && rect.height > window.innerHeight * .85) return null;
  return target;
}

function describeElement(element) {
  const text = normalizedText(element.textContent).slice(0, 500) || null;
  const accessibleName = normalizedText(
    element.getAttribute("aria-label")
      || (element.getAttribute("aria-labelledby") && document.getElementById(element.getAttribute("aria-labelledby"))?.textContent)
      || element.getAttribute("alt")
      || element.getAttribute("title")
      || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : "")
      || text,
  ).slice(0, 300) || null;
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: Array.from(element.classList).slice(0, 20),
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

function attachmentLabel(attachment) {
  if (attachment.kind === "drawing") {
    const count = attachment.strokes?.length || 0;
    return count === 1 ? "Drawing · 1 stroke" : `Drawing · ${count} strokes`;
  }
  if (attachment.kind === "region") {
    return attachment.rect ? `Area · ${Math.round(attachment.rect.width)}×${Math.round(attachment.rect.height)}` : "Area";
  }
  const name = attachment.element?.accessibleName || attachment.element?.text;
  return name ? `${attachment.element.tag} “${truncate(name, 34)}”` : attachment.element?.tag || "Element";
}

function truncate(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
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

function drawingBounds(strokes) {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const padding = Math.max(8, ...strokes.map((stroke) => stroke.width * 2));
  const left = Math.min(...xs) - padding;
  const top = Math.min(...ys) - padding;
  const right = Math.max(...xs) + padding;
  const bottom = Math.max(...ys) + padding;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function rectNode(rect, className) {
  return svgElement("rect", {
    class: className,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    rx: 5,
  });
}

function pathNode(stroke) {
  return svgElement("path", {
    class: "ink",
    d: strokePath(stroke.points),
    stroke: stroke.color,
    "stroke-width": stroke.width,
  });
}

function markerNodes(rect, number) {
  const x = Math.max(14, Math.min(window.innerWidth - 14, rect.x + 7));
  const y = Math.max(14, Math.min(window.innerHeight - 14, rect.y + 7));
  const circle = svgElement("circle", { class: "pin", cx: x, cy: y, r: 12 });
  const text = svgElement("text", { class: "pin-text", x, y: y + .5 });
  text.textContent = String(number);
  return [circle, text];
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

function autoSizeTextarea(textarea) {
  textarea.style.height = "46px";
  const height = Math.min(150, Math.max(46, textarea.scrollHeight));
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > 150 ? "auto" : "hidden";
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

function drawAttachmentMarker(context, attachment, rect, number) {
  if (!rect) return;
  context.save();
  if (attachment.kind !== "drawing") {
    context.fillStyle = "rgba(223, 91, 57, .07)";
    context.strokeStyle = INK_COLOR;
    context.lineWidth = 2;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  const x = Math.max(14, rect.x + 7);
  const y = Math.max(14, rect.y + 7);
  context.beginPath();
  context.arc(x, y, 12, 0, Math.PI * 2);
  context.fillStyle = INK_COLOR;
  context.fill();
  context.strokeStyle = "#fffefa";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#fffaf6";
  context.font = "800 11px ui-sans-serif, -apple-system, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number), x, y + .5);
  context.restore();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (location.origin !== ALLOWED_ORIGIN) {
  console.warn(`AgentNudge refused to start on ${location.origin}; the local session allows ${ALLOWED_ORIGIN}.`);
} else if (!document.getElementById(HOST_ID)) {
  if (!customElements.get("agent-nudge-widget")) customElements.define("agent-nudge-widget", AgentNudgeWidget);
  const widget = document.createElement("agent-nudge-widget");
  widget.id = HOST_ID;
  document.documentElement.append(widget);
}
