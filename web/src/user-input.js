import {
  MAX_RECORDING_MS,
  MicrophoneCapture,
  insertTranscript,
  transcriptionRequestUrl,
} from "./audio-capture.js";

const iconMicrophone = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M8 21l8 0"/><path d="M12 17l0 4"/></svg>`;

export const userInputStyles = String.raw`
  .user-input textarea {
    display: block;
    width: 100%;
    height: var(--user-input-min-height, 46px);
    min-height: var(--user-input-min-height, 46px);
    max-height: var(--user-input-max-height, 180px);
    resize: none;
    overflow-y: hidden;
    border: 0;
    border-radius: var(--user-input-radius, 0);
    padding: var(--user-input-padding, 12px 13px 5px);
    background: var(--user-input-background, transparent);
    color: var(--user-input-color, inherit);
    font: inherit;
    font-size: var(--user-input-font-size, inherit);
    line-height: 1.45;
  }
  .user-input textarea::placeholder { color: var(--user-input-placeholder, currentColor); opacity: .58; }
  .user-input textarea:focus { outline: 0; }
  .user-input textarea:focus-visible {
    outline: 2px solid var(--user-input-focus, color-mix(in srgb, currentColor 55%, transparent));
    outline-offset: 2px;
  }
  .user-input-actions { min-height: 45px; display: flex; align-items: center; gap: 5px; padding: 4px 5px 5px; }
  .user-input-leading-actions { min-width: 0; flex: 1; display: flex; align-items: center; gap: 5px; }
  .user-input-trailing-actions { flex: none; display: flex; align-items: center; gap: 5px; }
  .user-input-dictate[data-active="true"] {
    background: var(--user-input-dictation-background, color-mix(in srgb, currentColor 13%, transparent));
    color: var(--user-input-dictation-color, currentColor);
    animation: user-input-dictation-pulse 1.4s ease-in-out infinite;
  }
  @keyframes user-input-dictation-pulse {
    50% { box-shadow: 0 0 0 4px var(--user-input-dictation-ring, color-mix(in srgb, currentColor 16%, transparent)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .user-input-dictate[data-active="true"] { animation: none; }
  }
`;

export function createUserInput(options) {
  return new UserInput(options);
}

export class UserInput {
  constructor({
    document,
    endpoint,
    browserToken,
    ariaLabel,
    placeholder = "",
    value = "",
    maxLength = 5000,
    minHeight = 46,
    maxHeight = 180,
    submit = "none",
    onChange = () => {},
    onSubmit = () => {},
    onStatus = () => {},
    onStateChange = () => {},
    captureFactory = () => MicrophoneCapture.start(),
    fetcher = (...args) => fetch(...args),
    locale = () => globalThis.navigator?.language || "en-US",
  }) {
    this.document = document;
    this.endpoint = endpoint;
    this.browserToken = browserToken;
    this.minimumHeight = minHeight;
    this.maximumHeight = maxHeight;
    this.submit = submit;
    this.onChange = onChange;
    this.onSubmit = onSubmit;
    this.onStatus = onStatus;
    this.onStateChange = onStateChange;
    this.captureFactory = captureFactory;
    this.fetcher = fetcher;
    this.locale = locale;
    this.disabled = false;
    this.speechDisabled = false;
    this.speechState = "idle";
    this.speechAttempt = 0;
    this.transcriptionAbort = null;
    this.microphoneCapture = null;
    this.recordingTimer = null;
    this.destroyed = false;

    this.element = document.createElement("div");
    this.element.className = "user-input";
    this.element.style.setProperty("--user-input-min-height", `${minHeight}px`);
    this.element.style.setProperty("--user-input-max-height", `${this.resolveMaximumHeight()}px`);

    this.textarea = document.createElement("textarea");
    this.textarea.rows = 1;
    this.textarea.maxLength = maxLength;
    this.textarea.value = value;
    this.textarea.placeholder = placeholder;
    this.textarea.setAttribute("aria-label", ariaLabel);

    this.actions = document.createElement("div");
    this.actions.className = "user-input-actions";
    this.leadingActions = document.createElement("div");
    this.leadingActions.className = "user-input-leading-actions";
    this.trailingActions = document.createElement("div");
    this.trailingActions.className = "user-input-trailing-actions";
    this.microphoneButton = document.createElement("button");
    this.microphoneButton.type = "button";
    this.microphoneButton.className = "icon-button user-input-dictate";
    this.microphoneButton.innerHTML = iconMicrophone;
    this.trailingActions.append(this.microphoneButton);
    this.actions.append(this.leadingActions, this.trailingActions);
    this.element.append(this.textarea, this.actions);

    this.handleInput = () => {
      this.autoSize();
      this.onChange(this.textarea.value, this);
    };
    this.handleKeyDown = (event) => {
      const plainEnter = this.submit === "enter" && !event.shiftKey;
      const modifiedEnter = this.submit === "modifier-enter" && (event.metaKey || event.ctrlKey);
      if (event.key !== "Enter" || event.isComposing || (!plainEnter && !modifiedEnter)) return;
      event.preventDefault();
      if (!this.disabled && this.speechState === "idle") this.onSubmit(this);
    };
    this.handleMicrophone = () => this.toggleDictation();
    this.textarea.addEventListener("input", this.handleInput);
    this.textarea.addEventListener("keydown", this.handleKeyDown);
    this.microphoneButton.addEventListener("click", this.handleMicrophone);
    this.autoSize();
    this.render();
  }

  get value() {
    return this.textarea.value;
  }

  get busy() {
    return this.speechState !== "idle";
  }

  setValue(value, { notify = false } = {}) {
    this.textarea.value = value;
    this.autoSize();
    if (notify) this.onChange(value, this);
  }

  setPlaceholder(value) {
    this.textarea.placeholder = value;
  }

  setDisabled(value) {
    const next = Boolean(value);
    if (this.disabled === next) return;
    this.disabled = next;
    if (this.disabled) this.cancelDictation();
    this.render();
  }

  setSpeechDisabled(value) {
    const next = Boolean(value);
    if (this.speechDisabled === next) return;
    this.speechDisabled = next;
    if (this.speechDisabled) this.cancelDictation();
    this.render();
  }

  focus({ selectEnd = false, preventScroll = false } = {}) {
    this.textarea.focus({ preventScroll });
    if (selectEnd) {
      const end = this.textarea.value.length;
      this.textarea.setSelectionRange(end, end);
    }
  }

  autoSize() {
    const maximum = this.resolveMaximumHeight();
    this.element.style.setProperty("--user-input-max-height", `${maximum}px`);
    this.textarea.style.height = `${this.minimumHeight}px`;
    const height = Math.min(maximum, Math.max(this.minimumHeight, this.textarea.scrollHeight));
    this.textarea.style.height = `${height}px`;
    this.textarea.style.overflowY = this.textarea.scrollHeight > maximum ? "auto" : "hidden";
  }

  resolveMaximumHeight() {
    const value = typeof this.maximumHeight === "function" ? this.maximumHeight() : this.maximumHeight;
    return Math.max(this.minimumHeight, Number(value) || this.minimumHeight);
  }

  async toggleDictation() {
    if (this.destroyed || this.disabled || this.speechDisabled) return;
    if (this.speechState === "recording") {
      await this.stopDictation();
      return;
    }
    if (this.speechState !== "idle") return;

    this.speechState = "starting";
    const attempt = ++this.speechAttempt;
    this.reportStatus("Requesting microphone access…");
    this.render();
    try {
      const capture = await this.captureFactory();
      if (attempt !== this.speechAttempt || this.destroyed || this.disabled || this.speechDisabled) {
        capture.cancel();
        return;
      }
      this.microphoneCapture = capture;
      this.speechState = "recording";
      this.reportStatus("Listening… tap the microphone when you’re done.");
      this.recordingTimer = setTimeout(() => this.stopDictation(), MAX_RECORDING_MS);
    } catch (error) {
      if (attempt !== this.speechAttempt) return;
      console.error("AgentNudge could not start dictation", error);
      this.speechState = "idle";
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      this.reportStatus(
        denied ? "Microphone access was denied. Allow it for this page to dictate." : error.message || "Microphone recording is unavailable.",
        true,
      );
    } finally {
      if (attempt === this.speechAttempt) this.render();
    }
  }

  async stopDictation() {
    if (this.speechState !== "recording" || !this.microphoneCapture) return;
    if (this.recordingTimer) clearTimeout(this.recordingTimer);
    this.recordingTimer = null;
    this.speechState = "transcribing";
    const attempt = this.speechAttempt;
    const abort = new AbortController();
    this.transcriptionAbort = abort;
    this.reportStatus("Transcribing locally…");
    this.render();
    const capture = this.microphoneCapture;
    this.microphoneCapture = null;
    try {
      const audio = await capture.stop();
      const locale = this.locale();
      const response = await this.fetcher(transcriptionRequestUrl(this.endpoint, locale), {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "audio/wav",
          "X-AgentNudge-Token": this.browserToken,
        },
        body: audio,
        signal: abort.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      if (attempt !== this.speechAttempt) return;
      const inserted = insertTranscript(
        this.textarea.value,
        this.textarea.selectionStart ?? this.textarea.value.length,
        this.textarea.selectionEnd ?? this.textarea.value.length,
        result.text || "",
      );
      this.textarea.value = inserted.value;
      this.textarea.setSelectionRange(inserted.cursor, inserted.cursor);
      this.autoSize();
      this.onChange(this.textarea.value, this);
      this.reportStatus(`Transcribed locally (${result.locale || locale}).`);
      queueMicrotask(() => this.focus());
    } catch (error) {
      if (abort.signal.aborted || attempt !== this.speechAttempt) return;
      console.error("AgentNudge dictation failed", error);
      this.reportStatus(error.message || "Voice dictation failed.", true);
    } finally {
      if (this.transcriptionAbort === abort) this.transcriptionAbort = null;
      if (attempt !== this.speechAttempt) return;
      this.speechState = "idle";
      this.render();
    }
  }

  cancelDictation() {
    const wasActive = this.speechState !== "idle";
    this.speechAttempt += 1;
    this.transcriptionAbort?.abort();
    this.transcriptionAbort = null;
    if (this.recordingTimer) clearTimeout(this.recordingTimer);
    this.recordingTimer = null;
    this.microphoneCapture?.cancel();
    this.microphoneCapture = null;
    this.speechState = "idle";
    if (wasActive) this.reportStatus("");
    this.render();
  }

  reportStatus(message, error = false) {
    this.onStatus(message, error, this);
  }

  render() {
    this.textarea.disabled = this.disabled;
    const recording = this.speechState === "recording";
    this.microphoneButton.dataset.active = String(recording);
    this.microphoneButton.disabled = this.disabled
      || this.speechDisabled
      || this.speechState === "starting"
      || this.speechState === "transcribing";
    const title = recording ? "Stop and transcribe" : "Start voice dictation";
    this.microphoneButton.title = title;
    this.microphoneButton.setAttribute("aria-label", title);
    this.onStateChange(this);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelDictation();
    this.textarea.removeEventListener("input", this.handleInput);
    this.textarea.removeEventListener("keydown", this.handleKeyDown);
    this.microphoneButton.removeEventListener("click", this.handleMicrophone);
  }
}
