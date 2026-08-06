import html2canvas from "html2canvas";
import { pointInClosedPath } from "./annotation-geometry.js";
import { renderMarkdown } from "./markdown.js";
import { paintReviewMarks } from "./review-capture.js";
import {
  buildGroupedReviewPayload,
  buildThreadQuestionPayload,
  beginThreadQuestion,
  createReviewThread,
  drawingBounds,
  referenceLabel,
  reviewDraftUrl,
  reviewThreadConversationUrl,
  reviewThreadMessagesUrl,
  threadDisplayText,
} from "./review-thread-model.js";
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
const SESSION_ID = "__AGENTNUDGE_SESSION__";
const BROWSER_TOKEN = "__AGENTNUDGE_BROWSER_TOKEN__";
const RUNTIME_ENABLED = Boolean(__AGENTNUDGE_RUNTIME_ENABLED__);
const CHAT_HOST_ID = "agentnudge-widget";
export const REVIEW_HOST_ID = "agentnudge-review-widget";
const INK_WIDTH = 4;
const MAX_HISTORY = 80;

const css = String.raw`
  :host {
    --surface: #fbfaf6;
    --raised: #fffefa;
    --hover: #f1efe9;
    --text: #25241f;
    --muted: #747168;
    --faint: #9b978d;
    --border: #d8d4ca;
    --shadow: 0 14px 42px rgb(31 27 20 / .18);
    all: initial;
    position: fixed;
    inset: auto 18px 18px auto;
    z-index: 2147483647;
    display: none;
    color: var(--text);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.4;
  }
  :host([active]) { display: block; }

  @media (prefers-color-scheme: dark) {
    :host {
      --surface: #20211f;
      --raised: #2b2c29;
      --hover: #363732;
      --text: #f2f0e9;
      --muted: #bbb7ad;
      --faint: #858279;
      --border: #4c4d47;
      --shadow: 0 16px 46px rgb(0 0 0 / .34);
    }
  }

  * { box-sizing: border-box; }
  button, textarea { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; }

  .dock { position: relative; z-index: 5; display: flex; align-items: flex-end; gap: 8px; }
  .control-column { width: min(380px, calc(100vw - 78px)); display: grid; gap: 7px; }
  .tray {
    border: 1px solid var(--border);
    border-radius: 13px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    box-shadow: 0 10px 34px rgb(20 20 18 / .17);
    backdrop-filter: blur(14px) saturate(130%);
    -webkit-backdrop-filter: blur(14px) saturate(130%);
  }
  .toolbar { display: flex; align-items: center; gap: 3px; min-width: 0; padding: 6px; overflow-x: auto; scrollbar-width: none; }
  .toolbar::-webkit-scrollbar { display: none; }
  .separator { width: 1px; height: 22px; flex: none; margin: 0 2px; background: var(--border); }

  .icon-button, .send-review {
    position: relative;
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    padding: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease, opacity 120ms ease;
  }
  .icon-button:hover { background: var(--hover); color: var(--text); }
  .icon-button:active, .send-review:active { transform: scale(.96); }
  .icon-button[data-active="true"] { background: color-mix(in srgb, var(--thread-color, #df5b39) 13%, transparent); color: var(--thread-color, #df5b39); }
  .icon-button:disabled, .send-review:disabled { opacity: .3; cursor: default; }
  .icon-button:focus-visible, .send-review:focus-visible, textarea:focus-visible, .pending-thread:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--thread-color, #df5b39) 72%, transparent);
    outline-offset: 2px;
  }
  .icon-button svg, .send-review svg, .thread-icon svg { width: 19px; height: 19px; display: block; }
  .send-review {
    width: 44px;
    height: 44px;
    border: 1px solid #df5b39;
    border-radius: 50%;
    background: #df5b39;
    color: #fffaf5;
    box-shadow: 0 5px 18px rgb(38 29 20 / .2);
  }

  .thread-stack {
    display: flex;
    max-height: min(36dvh, 310px);
    flex-direction: column;
    gap: 5px;
    overflow: auto;
    padding: 2px;
    scrollbar-width: thin;
  }
  .thread-stack:empty { display: none; }
  .pending-thread {
    --item-color: #df5b39;
    width: 100%;
    min-height: 48px;
    display: grid;
    grid-template-columns: 27px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border: 1px solid color-mix(in srgb, var(--item-color) 25%, var(--border));
    border-radius: 11px;
    padding: 7px 9px 7px 7px;
    background: color-mix(in srgb, var(--raised) 95%, transparent);
    color: var(--text);
    text-align: left;
    box-shadow: 0 6px 20px rgb(24 20 15 / .1);
    cursor: pointer;
    transition: transform 130ms ease, border-color 130ms ease, opacity 130ms ease;
  }
  .pending-thread:hover { transform: translateY(-1px); border-color: var(--item-color); }
  .pending-badge, .thread-number {
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--item-color, var(--thread-color));
    color: #fffaf5;
    font-weight: 800;
  }
  .pending-badge { width: 27px; height: 27px; font-size: 11px; }
  .pending-copy { min-width: 0; display: grid; gap: 1px; }
  .pending-copy strong, .pending-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pending-copy strong { font-size: 11px; font-weight: 680; }
  .pending-copy span { color: var(--muted); font-size: 9px; }
  .pending-state { width: 18px; display: grid; place-items: center; color: var(--item-color); }
  .pending-state svg { width: 15px; height: 15px; }

  .thread-layer { position: fixed; inset: 0; z-index: 4; pointer-events: none; }
  .thread-card {
    --thread-color: #df5b39;
    position: fixed;
    left: 0;
    top: 0;
    width: min(292px, calc(100vw - 24px));
    max-height: min(70dvh, 580px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--thread-color) 36%, var(--border));
    border-radius: 14px;
    background: var(--raised);
    color: var(--text);
    box-shadow: var(--shadow);
    pointer-events: auto;
    will-change: transform;
  }
  .thread-accent { height: 3px; flex: none; background: var(--thread-color); }
  .thread-head { min-height: 38px; display: flex; align-items: center; gap: 7px; padding: 7px 8px 5px 9px; cursor: grab; touch-action: none; }
  .thread-head:active { cursor: grabbing; }
  .thread-number { width: 25px; height: 25px; flex: none; font-size: 11px; }
  .thread-title { min-width: 0; flex: 1; display: grid; }
  .thread-title strong { font-size: 11px; font-weight: 700; }
  .thread-title span { color: var(--muted); font-size: 9px; }
  .thread-icon { width: 27px; height: 27px; display: grid; place-items: center; flex: none; border: 0; border-radius: 7px; padding: 0; background: transparent; color: var(--muted); cursor: pointer; }
  .thread-icon:hover { background: var(--hover); color: var(--text); }
  .thread-icon svg { width: 16px; height: 16px; }

  .reference-strip { display: flex; gap: 5px; overflow-x: auto; padding: 2px 9px 8px; scrollbar-width: none; }
  .reference-strip:empty { display: none; }
  .reference-strip::-webkit-scrollbar { display: none; }
  .reference-chip {
    max-width: 150px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 5px;
    border: 1px solid color-mix(in srgb, var(--thread-color) 27%, var(--border));
    border-radius: 999px;
    padding: 3px 7px 3px 3px;
    background: color-mix(in srgb, var(--thread-color) 7%, var(--raised));
    color: var(--muted);
    font-size: 9px;
    white-space: nowrap;
  }
  .reference-chip b { width: 21px; height: 21px; display: grid; place-items: center; border-radius: 50%; background: var(--thread-color); color: #fff; font-size: 8px; }
  .reference-chip span { overflow: hidden; text-overflow: ellipsis; }

  .thread-body { min-height: 0; overflow-y: auto; border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent); }
  .transcript { display: grid; gap: 7px; padding: 9px 9px 4px; }
  .transcript:empty { display: none; }
  .thread-message { max-width: 90%; display: grid; gap: 2px; }
  .thread-message.user { justify-self: end; }
  .thread-message.agent { justify-self: start; }
  .thread-message small { color: var(--faint); font-size: 8px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
  .thread-message.user small { text-align: right; }
  .thread-bubble { border: 1px solid var(--border); border-radius: 11px 11px 11px 4px; padding: 7px 8px; background: var(--surface); font-size: 11px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .thread-message.user .thread-bubble { border-color: color-mix(in srgb, var(--thread-color) 30%, var(--border)); border-radius: 11px 11px 4px 11px; background: color-mix(in srgb, var(--thread-color) 10%, var(--raised)); }
  .thread-message.agent .thread-bubble { white-space: normal; }
  .thread-bubble .message-markdown > :first-child { margin-top: 0; }
  .thread-bubble .message-markdown > :last-child { margin-bottom: 0; }
  .thread-bubble .message-markdown p, .thread-bubble .message-markdown ul, .thread-bubble .message-markdown ol, .thread-bubble .message-markdown pre, .thread-bubble .message-markdown blockquote { margin: 0 0 7px; }
  .thread-bubble .message-markdown ul, .thread-bubble .message-markdown ol { padding-left: 17px; }
  .thread-bubble .message-markdown code { padding: 1px 3px; border-radius: 4px; background: var(--hover); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
  .thread-bubble .message-markdown pre { overflow-x: auto; padding: 6px; border-radius: 6px; background: var(--hover); }
  .thread-bubble .message-markdown pre code { padding: 0; background: transparent; }
  .thread-bubble .message-markdown a { color: var(--thread-color); }
  .thread-context { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; }
  .thread-context span { border-radius: 999px; padding: 2px 5px; background: color-mix(in srgb, var(--thread-color) 16%, var(--raised)); color: var(--thread-color); font-size: 8px; font-weight: 800; }
  .thread-working { display: flex; align-items: center; gap: 3px; padding: 8px 9px; }
  .thread-working span { width: 5px; height: 5px; border-radius: 50%; background: var(--thread-color); animation: thread-pulse 1.1s ease-in-out infinite; }
  .thread-working span:nth-child(2) { animation-delay: 130ms; }
  .thread-working span:nth-child(3) { animation-delay: 260ms; }
  @keyframes thread-pulse { 0%, 70%, 100% { opacity: .28; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-2px); } }

  .thread-composer { padding: 7px 8px 8px; }
  .thread-composer textarea {
    display: block;
    width: 100%;
    height: 58px;
    min-height: 58px;
    max-height: 180px;
    resize: none;
    overflow: hidden;
    border: 0;
    border-radius: 9px;
    padding: 9px 10px;
    background: var(--hover);
    color: var(--text);
    font-size: 12px;
    line-height: 1.45;
  }
  .thread-composer textarea::placeholder { color: var(--muted); }
  .thread-actions { display: flex; align-items: center; gap: 5px; margin-top: 6px; }
  .thread-meta { min-width: 0; flex: 1; color: var(--muted); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ask-thread, .queue-thread { width: 31px; height: 31px; }
  .ask-thread { color: var(--thread-color); }
  .queue-thread { background: var(--thread-color); color: #fffaf5; }
  .queue-thread:hover { background: var(--thread-color); color: #fff; filter: brightness(.94); }

  .overlay { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2; overflow: visible; pointer-events: none; }
  .guide { fill: rgb(57 120 207 / .08); stroke: #3978cf; stroke-width: 2; stroke-dasharray: 6 4; }
  .selection-outline { fill: none; stroke: #2563c7; stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 5 4; opacity: .7; }
  .mark-label { fill: #fff; font: 800 9px ui-sans-serif, -apple-system, sans-serif; text-anchor: middle; dominant-baseline: central; }

  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  @media (prefers-reduced-motion: reduce) {
    .icon-button, .send-review, .pending-thread { transition: none; }
    .thread-working span { animation: none; opacity: .65; }
  }
`;

export class AgentNudgeReview extends HTMLElement {
  constructor() {
    super();
    this.opened = false;
    this.mode = "idle";
    this.threads = [];
    this.threadCounter = 0;
    this.referenceCounter = 0;
    this.strokeCounter = 0;
    this.activeThreadId = null;
    this.highlightedThreadId = null;
    this.selectedStrokeIds = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.dragStart = null;
    this.pointerTarget = null;
    this.hoverRect = null;
    this.pendingRect = null;
    this.currentStroke = null;
    this.currentStrokeThreadId = null;
    this.revealThreadAfterStroke = false;
    this.suppressNextClick = false;
    this.movingCard = false;
    this.sending = false;
    this.threadPolls = new Map();
    this.restoreComplete = false;
    this.localEdits = false;
    this.persistTimer = null;
    this.persistPromise = Promise.resolve();
    this.abort = new AbortController();

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${css}</style>
      <div class="dock">
        <div class="control-column">
          <div class="thread-stack" aria-label="Pending feedback threads"></div>
          <section class="tray" aria-label="AgentNudge comment tools">
            <div class="toolbar" role="toolbar" aria-label="Comment modes">
              ${iconButtonMarkup("chat-mode", "Open chat", iconMessage)}
              <span class="separator" aria-hidden="true"></span>
              ${iconButtonMarkup("select-mode", "Select drawing", iconPointer)}
              ${iconButtonMarkup("target-mode", "Mark an element or area", iconNote)}
              ${iconButtonMarkup("draw-mode", "Draw into active feedback", iconPencil)}
              ${iconButtonMarkup("region-mode", "Mark an area", iconRectangle)}
              ${iconButtonMarkup("page-note", "New page note", iconComment)}
              <span class="separator" aria-hidden="true"></span>
              ${iconButtonMarkup("undo", "Undo", iconUndo)}
              ${iconButtonMarkup("redo", "Redo", iconRedo)}
              ${iconButtonMarkup("delete-selection", "Delete selected drawing", iconTrash)}
            </div>
          </section>
        </div>
        <button class="send-review" type="button" aria-label="Send all feedback" title="Send all feedback">${iconSend}</button>
      </div>
      <svg class="overlay" aria-hidden="true">
        <rect class="hover-guide guide" visibility="hidden"></rect>
        <rect class="pending-guide guide" visibility="hidden"></rect>
        <g class="reference-layer"></g>
      </svg>
      <div class="thread-layer"></div>
      <p class="status sr-only" aria-live="polite"></p>
    `;

    this.root = root;
    this.dock = root.querySelector(".dock");
    this.stack = root.querySelector(".thread-stack");
    this.threadLayer = root.querySelector(".thread-layer");
    this.referenceLayer = root.querySelector(".reference-layer");
    this.hoverGuide = root.querySelector(".hover-guide");
    this.pendingGuide = root.querySelector(".pending-guide");
    this.sendButton = root.querySelector(".send-review");
    this.status = root.querySelector(".status");
  }

  connectedCallback() {
    const { signal } = this.abort;
    this.root.querySelector(".chat-mode").addEventListener("click", () => this.returnToChat(), { signal });
    this.root.querySelector(".select-mode").addEventListener("click", () => this.setMode("select"), { signal });
    this.root.querySelector(".target-mode").addEventListener("click", () => this.setMode("target"), { signal });
    this.root.querySelector(".draw-mode").addEventListener("click", () => this.setMode("draw"), { signal });
    this.root.querySelector(".region-mode").addEventListener("click", () => this.setMode("region"), { signal });
    this.root.querySelector(".page-note").addEventListener("click", () => this.createPageNote(), { signal });
    this.root.querySelector(".undo").addEventListener("click", () => this.undo(), { signal });
    this.root.querySelector(".redo").addEventListener("click", () => this.redo(), { signal });
    this.root.querySelector(".delete-selection").addEventListener("click", () => this.deleteSelectedStrokes(), { signal });
    this.sendButton.addEventListener("click", () => this.send(), { signal });
    document.addEventListener("pointerdown", (event) => this.onPointerDown(event), { capture: true, signal });
    document.addEventListener("pointermove", (event) => this.onPointerMove(event), { capture: true, signal });
    document.addEventListener("pointerup", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("pointercancel", (event) => this.onPointerUp(event), { capture: true, signal });
    document.addEventListener("click", (event) => this.onDocumentClick(event), { capture: true, signal });
    document.addEventListener("keydown", (event) => this.onKeyDown(event), { capture: true, signal });
    window.addEventListener("resize", () => this.onViewportChange(), { signal });
    window.addEventListener("scroll", () => this.onViewportChange(), { signal, passive: true });
    this.render();
    this.restoreDraft();
  }

  disconnectedCallback() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.abort.abort();
    this.threadPolls.clear();
  }

  async restoreDraft() {
    try {
      const response = await fetch(reviewDraftUrl(ENDPOINT), {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        headers: { "X-AgentNudge-Token": BROWSER_TOKEN },
        signal: this.abort.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      if (!this.localEdits) {
        const restored = normalizeReviewState(result.state);
        if (restored) {
          this.threads = restored.threads;
          this.threadCounter = restored.threadCounter;
          this.referenceCounter = restored.referenceCounter;
          this.strokeCounter = restored.strokeCounter;
          for (const thread of this.threads) {
            const messages = Array.isArray(result.conversations?.[thread.id])
              ? result.conversations[thread.id]
              : [];
            if (messages.length) {
              const referenceIds = thread.references.map((_, index) => referenceLabel(thread, index));
              thread.conversation = messages
                .filter((message) => (message.role === "user" || message.role === "agent") && typeof message.text === "string")
                .map((message) => ({
                  id: message.id,
                  sequence: Number(message.sequence) || 0,
                  role: message.role,
                  text: message.text,
                  referenceIds,
                }));
              thread.cursor = Math.max(0, ...thread.conversation.map((message) => message.sequence || 0));
              thread.asking = RUNTIME_ENABLED && thread.conversation.at(-1)?.role === "user";
            }
          }
        }
      }
    } catch (error) {
      if (!this.abort.signal.aborted) console.error("AgentNudge review draft restore failed", error);
    } finally {
      this.restoreComplete = true;
      this.render();
      for (const thread of this.threads.filter((value) => value.asking)) {
        const poll = this.pollThreadReply(thread.id, thread.cursor);
        this.threadPolls.set(thread.id, poll);
        poll
          .catch((error) => {
            if (this.abort.signal.aborted) return;
            thread.asking = false;
            this.setStatus("The embedded agent reply was interrupted.");
            this.render();
            console.error("AgentNudge restored review poll failed", error);
          })
          .finally(() => this.threadPolls.delete(thread.id));
      }
    }
  }

  schedulePersist() {
    if (!this.restoreComplete || this.abort.signal.aborted) return;
    this.localEdits = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const state = this.reviewState();
      this.persistPromise = this.persistPromise
        .then(() => this.persistReviewState(state))
        .catch((error) => {
          if (!this.abort.signal.aborted) console.error("AgentNudge review draft persistence failed", error);
        });
    }, 220);
  }

  reviewState() {
    return {
      threadCounter: this.threadCounter,
      referenceCounter: this.referenceCounter,
      strokeCounter: this.strokeCounter,
      threads: structuredClone(this.threads),
    };
  }

  async persistReviewState(state) {
    const hasThreads = state.threads.length > 0;
    const response = await fetch(reviewDraftUrl(ENDPOINT), {
      method: hasThreads ? "PUT" : "DELETE",
      mode: "cors",
      cache: "no-store",
      headers: hasThreads
        ? { "Content-Type": "application/json", "X-AgentNudge-Token": BROWSER_TOKEN }
        : { "X-AgentNudge-Token": BROWSER_TOKEN },
      body: hasThreads ? JSON.stringify({ sessionId: SESSION_ID, state }) : undefined,
      signal: this.abort.signal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || result.error || `HTTP ${response.status}`);
    }
  }

  open() {
    this.opened = true;
    this.mode = "target";
    this.setAttribute("active", "");
    this.render();
  }

  close() {
    this.opened = false;
    this.mode = "idle";
    this.selectedStrokeIds.clear();
    this.clearPointerState();
    this.removeAttribute("active");
    this.render();
  }

  returnToChat() {
    this.close();
    document.dispatchEvent(new CustomEvent("agentnudge:open-chat"));
  }

  setMode(mode) {
    if (this.sending) return;
    this.mode = mode;
    this.clearPointerState();
    if (mode !== "select") this.selectedStrokeIds.clear();
    this.render();
  }

  createPageNote() {
    if (this.sending) return;
    this.localEdits = true;
    const existing = this.activeThread();
    if (existing && !existing.asking) {
      this.focusComposer();
      return;
    }
    if (existing?.asking) this.detachAskingThread();
    this.pushUndo();
    const anchor = { x: Math.max(36, window.innerWidth - 330), y: Math.max(36, window.innerHeight - 190) };
    const thread = this.createThread(anchor, null);
    this.activeThreadId = thread.id;
    this.render();
    this.focusComposer();
  }

  onPointerDown(event) {
    if (!this.opened || this.mode === "idle" || this.movingCard || event.composedPath().includes(this)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    this.localEdits = true;
    const point = { x: event.clientX, y: event.clientY };
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = true;

    if (this.activeThread()?.asking && ["draw", "target", "region"].includes(this.mode)) {
      this.detachAskingThread();
    }

    if (this.mode === "select") {
      const hit = this.hitStroke(point);
      if (!event.shiftKey) this.selectedStrokeIds.clear();
      if (hit) {
        if (event.shiftKey && this.selectedStrokeIds.has(hit.stroke.id)) this.selectedStrokeIds.delete(hit.stroke.id);
        else this.selectedStrokeIds.add(hit.stroke.id);
        this.highlightedThreadId = hit.thread.id;
      } else {
        this.highlightedThreadId = null;
      }
      this.render();
      return;
    }

    if (this.mode === "draw") {
      this.pushUndo();
      const active = this.activeThread();
      const thread = active || this.createThread(point, null);
      this.currentStrokeThreadId = thread.id;
      this.revealThreadAfterStroke = !active;
      let reference = thread.references.find((value) => value.kind === "drawing");
      if (!reference) {
        this.referenceCounter += 1;
        reference = {
          id: `reference-${this.referenceCounter}`,
          kind: "drawing",
          rect: null,
          element: null,
          strokes: [],
        };
        thread.references.push(reference);
      }
      this.strokeCounter += 1;
      this.currentStroke = {
        id: `stroke-${this.strokeCounter}`,
        points: [point],
        color: thread.color,
        width: INK_WIDTH,
      };
      reference.strokes.push(this.currentStroke);
      reference.rect = drawingBounds(reference.strokes);
      this.renderReferences();
      return;
    }

    if (this.mode === "target" || this.mode === "region") {
      this.dragStart = point;
      this.pointerTarget = target;
      this.pendingRect = null;
      if (this.mode === "target") {
        const meaningful = meaningfulTarget(target);
        this.hoverRect = meaningful ? plainRect(meaningful.getBoundingClientRect()) : null;
      }
      this.renderGuides();
    }
  }

  onPointerMove(event) {
    if (!this.opened || this.movingCard || event.composedPath().includes(this)) return;
    const point = { x: event.clientX, y: event.clientY };
    if (this.mode === "draw" && this.currentStroke) {
      event.preventDefault();
      const last = this.currentStroke.points.at(-1);
      if (!last || pointDistance(point, last) >= 1.5) {
        this.currentStroke.points.push(point);
        const thread = this.threads.find((value) => value.id === this.currentStrokeThreadId);
        const reference = thread?.references.find((value) => value.kind === "drawing");
        if (reference) reference.rect = drawingBounds(reference.strokes);
        this.renderReferences();
      }
      return;
    }
    if ((this.mode === "target" || this.mode === "region") && this.dragStart) {
      event.preventDefault();
      if (pointDistance(point, this.dragStart) >= 6) {
        this.hoverRect = null;
        this.pendingRect = rectFromPoints(this.dragStart, point);
      }
      this.renderGuides();
      return;
    }
    if (this.mode === "target" && !this.dragStart) {
      const target = event.target instanceof Element ? meaningfulTarget(event.target) : null;
      this.hoverRect = target ? plainRect(target.getBoundingClientRect()) : null;
      this.renderGuides();
    }
  }

  onPointerUp(event) {
    if (!this.opened) return;
    const point = { x: event.clientX, y: event.clientY };
    if (this.mode === "draw" && this.currentStroke) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.currentStroke.points.length === 1) {
        const first = this.currentStroke.points[0];
        this.currentStroke.points.push({ x: first.x + .01, y: first.y + .01 });
      }
      const threadId = this.currentStrokeThreadId;
      const revealThread = this.revealThreadAfterStroke;
      this.currentStroke = null;
      this.currentStrokeThreadId = null;
      this.revealThreadAfterStroke = false;
      if (revealThread && this.threads.some((thread) => thread.id === threadId)) {
        this.activeThreadId = threadId;
        this.highlightedThreadId = threadId;
      }
      this.render();
      this.focusComposer(false);
      return;
    }
    if ((this.mode === "target" || this.mode === "region") && this.dragStart) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const dragged = this.pendingRect && this.pendingRect.width >= 6 && this.pendingRect.height >= 6;
      if (dragged) {
        this.addReference({ kind: "region", rect: { ...this.pendingRect }, element: null, strokes: [] }, point);
      } else if (this.mode === "target") {
        const element = meaningfulTarget(this.pointerTarget);
        if (element) this.addElementReference(element, point);
        else if (!this.activeThread()) this.createPageNoteAt(point);
        else this.setStatus("Drag an area or select an element to add it to this feedback thread.");
      }
      this.clearPointerState();
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
    if (!this.opened) return;
    const path = event.composedPath();
    const typing = path.some((node) => node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing) {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && !typing && this.selectedStrokeIds.size) {
      event.preventDefault();
      this.deleteSelectedStrokes();
      return;
    }
    if (event.key === "Escape" && !typing) {
      event.preventDefault();
      if (this.activeThread()) this.collapseThread(this.activeThread().id);
      else this.returnToChat();
    }
  }

  createPageNoteAt(point) {
    this.pushUndo();
    const thread = this.createThread(point, null);
    this.activeThreadId = thread.id;
    this.render();
    this.focusComposer();
  }

  addElementReference(element, point) {
    const description = describeElement(element);
    const thread = this.activeThread();
    if (thread?.references.some((reference) => reference.kind === "element" && reference.element?.selector === description.selector)) {
      this.setStatus("That element is already in this feedback thread.");
      return;
    }
    this.addReference({
      kind: "element",
      rect: plainRect(element.getBoundingClientRect()),
      element: description,
      strokes: [],
    }, point);
  }

  addReference(reference, point) {
    this.pushUndo();
    const thread = this.activeThread() || this.createThread(point, reference.rect);
    this.activeThreadId = thread.id;
    this.referenceCounter += 1;
    thread.references.push({ id: `reference-${this.referenceCounter}`, ...reference });
    thread.pending = false;
    this.highlightedThreadId = thread.id;
    this.render();
    this.focusComposer(false);
  }

  createThread(point, rect) {
    this.threadCounter += 1;
    const cardPosition = placeThreadCard(point, rect);
    const thread = createReviewThread({
      id: `thread-${this.threadCounter}`,
      number: this.threadCounter,
      cardPosition,
      anchor: point,
    });
    this.threads.push(thread);
    return thread;
  }

  activeThread() {
    return this.threads.find((thread) => thread.id === this.activeThreadId) || null;
  }

  detachAskingThread() {
    const thread = this.activeThread();
    if (!thread?.asking) return;
    thread.pending = true;
    this.activeThreadId = null;
    this.highlightedThreadId = null;
    this.render();
  }

  async askThread(threadId) {
    const thread = this.threads.find((value) => value.id === threadId);
    const message = thread?.draft.trim();
    if (!thread || !message || thread.asking) return;
    if (!RUNTIME_ENABLED) {
      this.setStatus("Start the session with an embedded agent to ask inline questions.");
      return;
    }
    const userMessage = beginThreadQuestion(thread, message);
    const captureThreads = [structuredClone(thread)];
    if (this.activeThreadId === thread.id) {
      this.activeThreadId = null;
      this.highlightedThreadId = null;
    }
    this.render();
    this.setStatus("Capturing context for the embedded agent.");
    let accepted = false;
    try {
      const screenshotDataUrl = await this.captureScreenshot(captureThreads);
      const current = this.threads.find((value) => value.id === threadId);
      if (!current) return;
      const response = await fetch(reviewThreadMessagesUrl(ENDPOINT, threadId), {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-AgentNudge-Token": BROWSER_TOKEN,
        },
        body: JSON.stringify(buildThreadQuestionPayload({
          sessionId: SESSION_ID,
          thread: current,
          question: message,
          page: this.pageContext(),
          screenshotDataUrl,
        })),
        signal: this.abort.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      accepted = true;
      userMessage.id = result.messageId;
      userMessage.sequence = result.sequence;
      current.cursor = Math.max(current.cursor, result.sequence);
      this.setStatus("The embedded agent is replying.");
      this.render();
      const poll = this.pollThreadReply(threadId, current.cursor);
      this.threadPolls.set(threadId, poll);
      await poll;
    } catch (error) {
      if (this.abort.signal.aborted) return;
      console.error("AgentNudge inline review question failed", error);
      const current = this.threads.find((value) => value.id === threadId);
      if (!current) return;
      if (!accepted) {
        current.conversation = current.conversation.filter((value) => value !== userMessage);
        current.draft = message;
        if (!this.activeThreadId) {
          current.pending = false;
          this.activeThreadId = current.id;
          this.highlightedThreadId = current.id;
        }
      }
      current.asking = false;
      this.setStatus(accepted ? "The embedded agent reply was interrupted." : "The question could not be sent.");
      this.render();
    } finally {
      this.threadPolls.delete(threadId);
    }
  }

  async pollThreadReply(threadId, after) {
    let cursor = after;
    while (!this.abort.signal.aborted) {
      const thread = this.threads.find((value) => value.id === threadId);
      if (!thread || !thread.asking) return;
      let response;
      try {
        response = await fetch(reviewThreadConversationUrl(ENDPOINT, threadId, cursor), {
          method: "GET",
          mode: "cors",
          cache: "no-store",
          headers: { "X-AgentNudge-Token": BROWSER_TOKEN },
          signal: this.abort.signal,
        });
      } catch (error) {
        if (this.abort.signal.aborted) return;
        await delay(700);
        continue;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      cursor = Math.max(cursor, Number(result.cursor) || cursor);
      thread.cursor = cursor;
      const known = new Set(thread.conversation.map((message) => message.id).filter(Boolean));
      const replies = (result.messages || []).filter((message) => message.role === "agent" && !known.has(message.id));
      for (const reply of replies) {
        thread.conversation.push({
          id: reply.id,
          sequence: reply.sequence,
          role: "agent",
          text: reply.text,
          referenceIds: thread.references.map((_, index) => referenceLabel(thread, index)),
        });
      }
      if (replies.length) {
        thread.asking = false;
        this.setStatus("");
        this.render();
        if (this.activeThreadId === threadId) this.focusComposer(false);
        return;
      }
    }
  }

  collapseThread(threadId) {
    const thread = this.threads.find((value) => value.id === threadId);
    if (!thread) return;
    this.pushUndo();
    if (thread.draft.trim()) {
      thread.feedbackText = thread.draft.trim();
      thread.draft = "";
    }
    thread.pending = true;
    this.activeThreadId = null;
    this.highlightedThreadId = null;
    this.mode = "target";
    this.render();
  }

  reopenThread(threadId) {
    if (this.sending) return;
    const thread = this.threads.find((value) => value.id === threadId);
    if (!thread) return;
    if (thread.feedbackText && !thread.draft) {
      thread.draft = thread.feedbackText;
      thread.feedbackText = "";
    }
    this.activeThreadId = thread.id;
    this.highlightedThreadId = thread.id;
    this.mode = "target";
    this.render();
    this.focusComposer();
  }

  removeThread(threadId) {
    if (!this.threads.some((thread) => thread.id === threadId)) return;
    this.pushUndo();
    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    if (this.activeThreadId === threadId) this.activeThreadId = null;
    if (this.highlightedThreadId === threadId) this.highlightedThreadId = null;
    this.render();
  }

  beginCardDrag(event, thread, card) {
    if (event.target.closest("button, textarea")) return;
    const before = this.snapshot();
    this.trackCardDrag(event, card, thread.cardPosition, (position) => {
      thread.cardPosition = position;
    }, (moved) => {
      if (moved) this.pushUndoSnapshot(before);
      this.renderHistoryButtons();
    });
  }

  trackCardDrag(event, card, startPosition, onMove, onFinish) {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    const origin = { ...startPosition };
    let moved = false;
    let finished = false;
    this.movingCard = true;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (Math.hypot(dx, dy) > 2) moved = true;
      const position = clampCardPosition({ x: origin.x + dx, y: origin.y + dy });
      onMove(position);
      card.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    };
    const up = (upEvent) => {
      if (finished || upEvent.pointerId !== pointerId) return;
      finished = true;
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      this.movingCard = false;
      onFinish(moved);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
  }

  hitStroke(point) {
    for (const thread of [...this.threads].reverse()) {
      for (const reference of [...thread.references].reverse()) {
        if (reference.kind !== "drawing") continue;
        const stroke = [...reference.strokes].reverse().find((value) => strokeHitDistance(point, value) <= Math.max(8, value.width + 5));
        if (stroke) return { thread, reference, stroke };
      }
    }
    return null;
  }

  deleteSelectedStrokes() {
    if (!this.selectedStrokeIds.size) return;
    this.pushUndo();
    for (const thread of this.threads) {
      for (const reference of thread.references) {
        if (reference.kind !== "drawing") continue;
        reference.strokes = reference.strokes.filter((stroke) => !this.selectedStrokeIds.has(stroke.id));
        reference.rect = drawingBounds(reference.strokes);
      }
      thread.references = thread.references.filter((reference) => reference.kind !== "drawing" || reference.strokes.length);
    }
    this.selectedStrokeIds.clear();
    this.render();
  }

  snapshot() {
    return {
      threads: structuredClone(this.threads),
      activeThreadId: this.activeThreadId,
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
    this.threads = structuredClone(snapshot.threads);
    this.activeThreadId = this.threads.some((thread) => thread.id === snapshot.activeThreadId)
      ? snapshot.activeThreadId
      : null;
    this.selectedStrokeIds.clear();
    this.clearPointerState();
    this.render();
  }

  clearPointerState() {
    this.dragStart = null;
    this.pointerTarget = null;
    this.hoverRect = null;
    this.pendingRect = null;
    this.currentStroke = null;
    this.currentStrokeThreadId = null;
    this.revealThreadAfterStroke = false;
  }

  resolveReferenceRect(reference) {
    if (reference.kind === "element" && reference.element?.selector) {
      try {
        const element = document.querySelector(reference.element.selector);
        if (element) reference.rect = plainRect(element.getBoundingClientRect());
      } catch {}
    } else if (reference.kind === "drawing") {
      reference.rect = drawingBounds(reference.strokes);
    }
    return reference.rect;
  }

  onViewportChange() {
    if (!this.opened) return;
    for (const thread of this.threads) {
      for (const reference of thread.references) this.resolveReferenceRect(reference);
    }
    this.renderReferences();
  }

  async captureScreenshot(threads = this.threads) {
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
      ignoreElements: (element) => element === this || element.id === CHAT_HOST_ID,
      onclone: (cloneDocument) => {
        cloneDocument.getElementById(CHAT_HOST_ID)?.remove();
        cloneDocument.getElementById(REVIEW_HOST_ID)?.remove();
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
    paintReviewMarks({
      context,
      canvas,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      threads,
      resolveReferenceRect: (reference) => this.resolveReferenceRect(reference),
    });
    return canvas.toDataURL("image/png");
  }

  buildPayload(screenshotDataUrl) {
    return buildGroupedReviewPayload({
      sessionId: SESSION_ID,
      threads: this.threads,
      page: this.pageContext(),
      screenshotDataUrl,
    });
  }

  pageContext() {
    return {
      url: `${location.origin}${location.pathname}`,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  async send() {
    if (this.sending) return;
    if (!this.threads.length) {
      this.setStatus("Add at least one feedback thread before sending.");
      return;
    }
    if (this.threads.some((thread) => thread.asking)) {
      this.setStatus("Wait for the inline agent reply before sending the review.");
      return;
    }
    const active = this.activeThread();
    if (active?.draft.trim()) {
      active.feedbackText = active.draft.trim();
      active.draft = "";
    }
    if (active) active.pending = true;
    this.activeThreadId = null;
    this.sending = true;
    this.render();
    this.setStatus("Capturing grouped feedback.");
    try {
      const screenshotDataUrl = await this.captureScreenshot();
      const response = await fetch(`${ENDPOINT}/feedback`, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-AgentNudge-Token": BROWSER_TOKEN,
        },
        body: JSON.stringify(this.buildPayload(screenshotDataUrl)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      this.resetReview();
      this.close();
      document.dispatchEvent(new CustomEvent("agentnudge:review-sent"));
    } catch (error) {
      console.error("AgentNudge grouped review failed", error);
      this.setStatus("Grouped feedback could not be sent.");
    } finally {
      this.sending = false;
      this.render();
    }
  }

  resetReview() {
    this.threads = [];
    this.activeThreadId = null;
    this.highlightedThreadId = null;
    this.selectedStrokeIds.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.clearPointerState();
  }

  focusComposer(select = true) {
    queueMicrotask(() => {
      const textarea = this.threadLayer.querySelector("textarea");
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      if (select) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  setStatus(message) {
    this.status.textContent = message;
    this.dock.title = message;
  }

  render() {
    const active = this.activeThread();
    this.style.setProperty("--thread-color", active?.color || "#df5b39");
    for (const mode of ["select", "target", "draw", "region"]) {
      const button = this.root.querySelector(`.${mode}-mode`);
      button.dataset.active = String(this.mode === mode);
      button.setAttribute("aria-pressed", String(this.mode === mode));
      button.disabled = this.sending;
    }
    this.root.querySelector(".chat-mode").disabled = this.sending;
    this.root.querySelector(".page-note").disabled = this.sending;
    this.sendButton.disabled = this.sending || this.threads.length === 0 || this.threads.some((thread) => thread.asking);
    this.renderHistoryButtons();
    this.renderStack();
    this.renderActiveThread();
    this.renderGuides();
    this.renderReferences();
    this.schedulePersist();
  }

  renderHistoryButtons() {
    this.root.querySelector(".undo").disabled = this.sending || this.undoStack.length === 0;
    this.root.querySelector(".redo").disabled = this.sending || this.redoStack.length === 0;
    this.root.querySelector(".delete-selection").disabled = this.sending || this.selectedStrokeIds.size === 0;
  }

  renderStack() {
    const nodes = this.threads
      .filter((thread) => thread.pending && thread.id !== this.activeThreadId)
      .map((thread) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pending-thread";
        button.style.setProperty("--item-color", thread.color);
        button.ariaLabel = `Open feedback thread ${thread.number}`;
        const badge = document.createElement("span");
        badge.className = "pending-badge";
        badge.textContent = String(thread.number);
        const copy = document.createElement("span");
        copy.className = "pending-copy";
        const title = document.createElement("strong");
        title.textContent = threadDisplayText(thread);
        const meta = document.createElement("span");
        const replies = thread.conversation.filter((message) => message.role === "agent").length;
        meta.textContent = `${thread.references.length} mark${thread.references.length === 1 ? "" : "s"}${replies ? ` · ${replies} repl${replies === 1 ? "y" : "ies"}` : ""}`;
        copy.append(title, meta);
        const state = document.createElement("span");
        state.className = "pending-state";
        state.innerHTML = thread.asking ? workingDotsMarkup() : iconCheck;
        button.append(badge, copy, state);
        button.addEventListener("click", () => this.reopenThread(thread.id));
        button.addEventListener("mouseenter", () => {
          this.highlightedThreadId = thread.id;
          this.renderReferences();
        });
        button.addEventListener("mouseleave", () => {
          this.highlightedThreadId = null;
          this.renderReferences();
        });
        return button;
      });
    this.stack.replaceChildren(...nodes);
  }

  renderActiveThread() {
    const thread = this.activeThread();
    if (!thread) {
      this.threadLayer.replaceChildren();
      return;
    }
    const card = document.createElement("section");
    card.className = "thread-card";
    card.style.setProperty("--thread-color", thread.color);
    card.style.transform = `translate3d(${thread.cardPosition.x}px, ${thread.cardPosition.y}px, 0)`;
    const accent = document.createElement("div");
    accent.className = "thread-accent";
    const head = document.createElement("div");
    head.className = "thread-head";
    const number = document.createElement("span");
    number.className = "thread-number";
    number.textContent = String(thread.number);
    const title = document.createElement("span");
    title.className = "thread-title";
    const titleStrong = document.createElement("strong");
    titleStrong.textContent = `Feedback ${thread.number}`;
    const titleMeta = document.createElement("span");
    titleMeta.textContent = thread.asking
      ? "Agent is replying"
      : RUNTIME_ENABLED
        ? "Add marks, ask, or queue"
        : "Add marks or queue";
    title.append(titleStrong, titleMeta);
    const grip = document.createElement("span");
    grip.className = "thread-icon";
    grip.ariaHidden = "true";
    grip.innerHTML = iconGrip;
    const remove = iconButton("Delete feedback thread", iconTrash, "thread-icon");
    remove.addEventListener("pointerdown", (event) => event.stopPropagation());
    remove.addEventListener("click", () => this.removeThread(thread.id));
    head.append(number, title, grip, remove);
    head.addEventListener("pointerdown", (event) => this.beginCardDrag(event, thread, card));

    const references = document.createElement("div");
    references.className = "reference-strip";
    thread.references.forEach((reference, index) => {
      const chip = document.createElement("span");
      chip.className = "reference-chip";
      const label = document.createElement("b");
      label.textContent = referenceLabel(thread, index);
      const target = document.createElement("span");
      target.textContent = referenceDescription(reference);
      chip.append(label, target);
      references.append(chip);
    });

    const body = document.createElement("div");
    body.className = "thread-body";
    const transcript = document.createElement("div");
    transcript.className = "transcript";
    for (const message of thread.conversation) {
      const wrapper = document.createElement("div");
      wrapper.className = `thread-message ${message.role}`;
      const speaker = document.createElement("small");
      speaker.textContent = message.role === "agent" ? "Agent" : "You";
      const bubble = document.createElement("div");
      bubble.className = "thread-bubble";
      if (message.role === "agent") {
        bubble.append(renderMarkdown(document, message.text));
      } else {
        bubble.textContent = message.text;
      }
      if (message.referenceIds?.length) {
        const context = document.createElement("div");
        context.className = "thread-context";
        for (const referenceId of message.referenceIds) {
          const chip = document.createElement("span");
          chip.textContent = referenceId;
          context.append(chip);
        }
        bubble.append(context);
      }
      wrapper.append(speaker, bubble);
      transcript.append(wrapper);
    }
    if (thread.asking) {
      const working = document.createElement("div");
      working.className = "thread-working";
      working.setAttribute("role", "status");
      working.setAttribute("aria-label", "Agent is replying");
      working.innerHTML = "<span></span><span></span><span></span>";
      transcript.append(working);
    }

    const composer = document.createElement("div");
    composer.className = "thread-composer";
    const textarea = document.createElement("textarea");
    textarea.maxLength = 5000;
    textarea.value = thread.draft;
    textarea.placeholder = thread.conversation.length
      ? "Reply or write the final feedback…"
      : RUNTIME_ENABLED
        ? "Write feedback or ask the agent…"
        : "Write feedback…";
    textarea.setAttribute("aria-label", `Feedback thread ${thread.number}`);
    textarea.addEventListener("input", () => {
      thread.draft = textarea.value;
      autoSizeTextarea(textarea);
      ask.disabled = !RUNTIME_ENABLED || thread.asking || !thread.draft.trim();
      meta.textContent = thread.draft.trim() ? "Ready to ask or add to review" : `${thread.references.length} grouped mark${thread.references.length === 1 ? "" : "s"}`;
    });
    textarea.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        this.askThread(thread.id);
      }
    });
    const actions = document.createElement("div");
    actions.className = "thread-actions";
    const meta = document.createElement("span");
    meta.className = "thread-meta";
    meta.textContent = `${thread.references.length} grouped mark${thread.references.length === 1 ? "" : "s"}`;
    const ask = iconButton(
      RUNTIME_ENABLED ? "Ask agent" : "Inline agent unavailable for this session",
      iconMessage,
      "thread-icon ask-thread",
    );
    ask.disabled = !RUNTIME_ENABLED || thread.asking || !thread.draft.trim();
    ask.addEventListener("click", () => this.askThread(thread.id));
    const queue = iconButton("Add to review", iconCheck, "thread-icon queue-thread");
    queue.addEventListener("click", () => this.collapseThread(thread.id));
    actions.append(meta, ask, queue);
    composer.append(textarea, actions);
    body.append(transcript, composer);
    card.append(accent, head, references, body);
    this.threadLayer.replaceChildren(card);
    queueMicrotask(() => autoSizeTextarea(textarea));
    queueMicrotask(() => { body.scrollTop = body.scrollHeight; });
  }

  renderGuides() {
    setRect(this.hoverGuide, this.hoverRect, Boolean(this.hoverRect));
    setRect(this.pendingGuide, this.pendingRect, Boolean(this.pendingRect));
  }

  renderReferences() {
    const focusId = this.activeThreadId || this.highlightedThreadId;
    const nodes = [];
    for (const thread of this.threads) {
      const opacity = focusId && focusId !== thread.id ? .2 : 1;
      thread.references.forEach((reference, index) => {
        const label = referenceLabel(thread, index);
        const rect = this.resolveReferenceRect(reference);
        if (reference.kind === "drawing") {
          for (const stroke of reference.strokes) {
            if (this.selectedStrokeIds.has(stroke.id)) {
              nodes.push(svgElement("path", {
                class: "selection-outline",
                d: strokePath(stroke.points),
                opacity,
              }));
            }
            nodes.push(svgElement("path", {
              d: strokePath(stroke.points),
              fill: "none",
              stroke: thread.color,
              "stroke-width": stroke.width,
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              opacity,
            }));
          }
        } else if (rect) {
          nodes.push(svgElement("rect", {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            rx: 5,
            fill: colorWithAlpha(thread.color, "12"),
            stroke: thread.color,
            "stroke-width": 2,
            opacity,
          }));
        }
        if (rect) nodes.push(...markerNodes(rect, label, thread.color, opacity));
      });
      if (!thread.references.length) {
        const rect = { x: thread.anchor.x - 1, y: thread.anchor.y - 1, width: 2, height: 2 };
        nodes.push(...markerNodes(rect, String(thread.number), thread.color, opacity));
      }
    }
    this.referenceLayer.replaceChildren(...nodes);
  }
}

function iconButtonMarkup(className, label, svg) {
  return `<button class="icon-button ${className}" type="button" aria-label="${label}" title="${label}">${svg}</button>`;
}

function iconButton(label, svg, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.ariaLabel = label;
  button.title = label;
  button.innerHTML = svg;
  return button;
}

function workingDotsMarkup() {
  return '<span aria-label="Agent replying">•••</span>';
}

function referenceDescription(reference) {
  if (reference.kind === "drawing") {
    return `${reference.strokes.length} stroke${reference.strokes.length === 1 ? "" : "s"}`;
  }
  if (reference.kind === "region") {
    return `${Math.round(reference.rect.width)} × ${Math.round(reference.rect.height)}`;
  }
  return reference.element?.accessibleName || reference.element?.text || reference.element?.tag || "Element";
}

function meaningfulTarget(element) {
  const target = element.closest(
    "button, a, p, h1, h2, h3, h4, h5, h6, li, img, input, textarea, select, article, section, [role], [data-agentnudge-comment-target]",
  );
  if (!target || target === document.body || target === document.documentElement) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  if (rect.width > window.innerWidth * .92 && rect.height > window.innerHeight * .75) return null;
  return target;
}

function describeElement(element) {
  const text = element.matches("input, textarea, [contenteditable]")
    ? null
    : normalizedText(element.textContent).slice(0, 500) || null;
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

function markerNodes(rect, label, color, opacity) {
  const x = Math.max(15, rect.x + 7);
  const y = Math.max(15, rect.y + 7);
  const circle = svgElement("circle", {
    cx: x,
    cy: y,
    r: 13,
    fill: color,
    stroke: "#fffaf5",
    "stroke-width": 2,
    opacity,
  });
  const text = svgElement("text", { class: "mark-label", x, y: y + .5, opacity });
  text.textContent = label;
  return [circle, text];
}

function strokePath(points) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function placeThreadCard(point, rect) {
  const width = Math.min(292, window.innerWidth - 24);
  const anchorX = rect ? rect.x + rect.width : point.x;
  let x = anchorX + 16;
  if (x + width > window.innerWidth - 12) x = (rect ? rect.x : point.x) - width - 16;
  return clampCardPosition({ x, y: rect ? rect.y : point.y });
}

function clampCardPosition(position) {
  const width = Math.min(292, window.innerWidth - 24);
  return {
    x: Math.max(12, Math.min(position.x, window.innerWidth - width - 12)),
    y: Math.max(12, Math.min(position.y, window.innerHeight - 170)),
  };
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

function autoSizeTextarea(textarea) {
  const maximum = Math.min(180, window.innerHeight * .34);
  textarea.style.height = "58px";
  const height = Math.min(maximum, Math.max(58, textarea.scrollHeight));
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > maximum ? "auto" : "hidden";
}

function colorWithAlpha(color, alpha) {
  return `${color}${alpha}`;
}

function normalizeReviewState(state) {
  if (!state || typeof state !== "object" || !Array.isArray(state.threads)) return null;
  const threads = state.threads
    .filter((thread) => thread && typeof thread === "object" && /^[A-Za-z0-9_-]{1,64}$/.test(thread.id))
    .slice(0, 100)
    .map((thread, index) => {
      const number = Number.isFinite(Number(thread.number)) ? Math.max(1, Number(thread.number)) : index + 1;
      const base = createReviewThread({
        id: thread.id,
        number,
        cardPosition: safePoint(thread.cardPosition, { x: 36, y: 36 }),
        anchor: safePoint(thread.anchor, { x: 36, y: 36 }),
      });
      return {
        ...base,
        color: typeof thread.color === "string" ? thread.color : base.color,
        references: Array.isArray(thread.references) ? structuredClone(thread.references.slice(0, 100)) : [],
        draft: typeof thread.draft === "string" ? thread.draft.slice(0, 5000) : "",
        feedbackText: typeof thread.feedbackText === "string" ? thread.feedbackText.slice(0, 5000) : "",
        conversation: Array.isArray(thread.conversation)
          ? structuredClone(thread.conversation.slice(0, 200))
          : [],
        cursor: Math.max(0, Number(thread.cursor) || 0),
        asking: false,
        pending: Boolean(thread.pending),
      };
    });
  return {
    threads,
    threadCounter: Math.max(Number(state.threadCounter) || 0, ...threads.map((thread) => thread.number)),
    referenceCounter: Math.max(0, Number(state.referenceCounter) || 0),
    strokeCounter: Math.max(0, Number(state.strokeCounter) || 0),
  };
}

function safePoint(value, fallback) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { ...fallback };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
