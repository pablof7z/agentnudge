import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createUserInput } from "../src/user-input.js";

function createDocument() {
  return new JSDOM("<!doctype html><body></body>").window.document;
}

test("shared user input owns text changes, autosizing, actions, and submission", () => {
  const document = createDocument();
  const changes = [];
  let submissions = 0;
  const input = createUserInput({
    document,
    endpoint: "http://127.0.0.1:4317/lima",
    browserToken: "token",
    ariaLabel: "Write feedback",
    placeholder: "Say what should change…",
    value: "Initial",
    submit: "modifier-enter",
    onChange: (value) => changes.push(value),
    onSubmit: () => { submissions += 1; },
  });

  assert.equal(input.element.querySelectorAll("textarea").length, 1);
  assert.equal(input.microphoneButton.getAttribute("aria-label"), "Start voice dictation");
  assert.equal(input.textarea.value, "Initial");
  assert.equal(input.textarea.placeholder, "Say what should change…");

  input.textarea.value = "A shared draft";
  input.textarea.dispatchEvent(new document.defaultView.Event("input", { bubbles: true }));
  assert.deepEqual(changes, ["A shared draft"]);
  assert.equal(input.textarea.style.height, "46px");

  input.textarea.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(submissions, 0);
  input.textarea.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
  assert.equal(submissions, 1);
});

test("shared user input transcribes speech at the current caret", async () => {
  const document = createDocument();
  const statuses = [];
  const changes = [];
  let stopped = false;
  const input = createUserInput({
    document,
    endpoint: "http://127.0.0.1:4317/lima",
    browserToken: "browser-secret",
    ariaLabel: "Message the agent",
    value: "Move please",
    captureFactory: async () => ({
      cancel() {},
      async stop() {
        stopped = true;
        return new Blob(["wav"], { type: "audio/wav" });
      },
    }),
    fetcher: async (url, request) => {
      assert.equal(url, "http://127.0.0.1:4317/lima/transcribe?locale=en-GB");
      assert.equal(request.headers["X-AgentNudge-Token"], "browser-secret");
      return {
        ok: true,
        async json() { return { text: "this button", locale: "en-GB" }; },
      };
    },
    locale: () => "en-GB",
    onChange: (value) => changes.push(value),
    onStatus: (message) => statuses.push(message),
  });
  input.textarea.setSelectionRange(5, 5);

  await input.toggleDictation();
  assert.equal(input.speechState, "recording");
  assert.equal(input.microphoneButton.dataset.active, "true");
  await input.toggleDictation();

  assert.equal(stopped, true);
  assert.equal(input.value, "Move this button please");
  assert.deepEqual(changes, ["Move this button please"]);
  assert.equal(input.speechState, "idle");
  assert.equal(statuses.at(-1), "Transcribed locally (en-GB).");
});

test("disabling shared user input releases an active microphone capture", async () => {
  const document = createDocument();
  let cancelled = false;
  const input = createUserInput({
    document,
    endpoint: "http://127.0.0.1:4317/lima",
    browserToken: "token",
    ariaLabel: "Write feedback",
    captureFactory: async () => ({
      cancel() { cancelled = true; },
      async stop() { throw new Error("not used"); },
    }),
  });

  await input.toggleDictation();
  input.setDisabled(true);

  assert.equal(cancelled, true);
  assert.equal(input.speechState, "idle");
  assert.equal(input.textarea.disabled, true);
  assert.equal(input.microphoneButton.disabled, true);
});
