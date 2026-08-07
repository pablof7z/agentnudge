import test from "node:test";
import assert from "node:assert/strict";

import {
  browserCommandRequestUrl,
  createPageId,
  performBrowserAction,
  screenshotPageRect,
  snapshotPage,
} from "../src/browser-control.js";

function fakeElement(overrides = {}) {
  return {
    tagName: "INPUT",
    type: "text",
    id: "email",
    textContent: "",
    labels: [{ textContent: "Email" }],
    disabled: false,
    isContentEditable: false,
    parentElement: null,
    ownerDocument: { body: {} },
    getAttribute(name) {
      return overrides.attributes?.[name] ?? null;
    },
    getBoundingClientRect() {
      return { x: 10, y: 20, width: 120, height: 30 };
    },
    closest() {
      return null;
    },
    dispatchEvent() {},
    ...overrides,
  };
}

function fakeWindow() {
  const inputPrototype = {};
  Object.defineProperty(inputPrototype, "value", {
    set(value) { this.internalValue = value; },
  });
  return {
    location: {
      origin: "http://localhost:5173",
      pathname: "/demo",
      href: "http://localhost:5173/demo?secret=yes#section",
    },
    innerWidth: 800,
    innerHeight: 600,
    scrollX: 0,
    scrollY: 0,
    HTMLInputElement: { prototype: inputPrototype },
    HTMLTextAreaElement: { prototype: {} },
    HTMLSelectElement: { prototype: {} },
    Event: class {},
    getComputedStyle() {
      return { display: "block", visibility: "visible" };
    },
  };
}

test("creates a UUID page ID and strips page query data from command polling", () => {
  const cryptoObject = {
    getRandomValues(bytes) {
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    },
  };
  assert.match(createPageId(cryptoObject), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const url = new URL(browserCommandRequestUrl(
    "http://127.0.0.1:4317/lima",
    "page-id",
    fakeWindow().location,
    "Demo",
  ));
  assert.equal(url.searchParams.get("url"), "http://localhost:5173/demo");
  assert.equal(url.searchParams.get("title"), "Demo");
});

test("fills an input without echoing its value in the action result", async () => {
  const input = fakeElement();
  const pageWindow = fakeWindow();
  const result = await performBrowserAction(
    { kind: "fill", selector: "#email", text: "private@example.com" },
    {
      document: { querySelector: () => input },
      window: pageWindow,
      host: { contains: () => false },
      allowedOrigin: pageWindow.location.origin,
    },
  );
  assert.equal(input.internalValue, "private@example.com");
  assert.equal(result.value.characters, 19);
  assert.doesNotMatch(JSON.stringify(result.value), /private@example\.com/);
});

test("captures a screenshot only through the supplied redacted capture callback", async () => {
  let captures = 0;
  const result = await performBrowserAction(
    { kind: "screenshot" },
    {
      document: { documentElement: { scrollWidth: 800, scrollHeight: 2400 } },
      window: fakeWindow(),
      host: {},
      allowedOrigin: "http://localhost:5173",
      async captureScreenshot() {
        captures += 1;
        return "data:image/png;base64,redacted";
      },
    },
  );
  assert.equal(captures, 1);
  assert.deepEqual(result.value, {
    screenshotDataUrl: "data:image/png;base64,redacted",
    pageRect: { x: 0, y: 0, width: 800, height: 600 },
  });
});

test("captures a distant document region without changing the current scroll position", () => {
  const pageWindow = fakeWindow();
  pageWindow.scrollY = 100;
  const rect = screenshotPageRect(
    { kind: "screenshot", x: 0, y: 4200, width: 800, height: 600 },
    { documentElement: { scrollWidth: 800, scrollHeight: 6000 } },
    pageWindow,
    {},
  );

  assert.deepEqual(rect, { x: 0, y: 4200, width: 800, height: 600 });
  assert.equal(pageWindow.scrollY, 100);
});

test("centers a padded targeted screenshot around a selected element", () => {
  const pageWindow = fakeWindow();
  pageWindow.scrollY = 3000;
  const element = fakeElement({
    getBoundingClientRect: () => ({ x: 100, y: 200, width: 200, height: 100 }),
  });
  const rect = screenshotPageRect(
    { kind: "screenshot", selector: "#target", width: 500, height: 400, padding: 100 },
    {
      documentElement: { scrollWidth: 1200, scrollHeight: 8000 },
      querySelector: () => element,
    },
    pageWindow,
    { contains: () => false },
  );

  assert.deepEqual(rect, { x: 0, y: 3050, width: 500, height: 400 });
});

test("snapshot excludes form values and navigation stays on the allowed origin", async () => {
  const input = fakeElement({ textContent: "secret form value" });
  const button = fakeElement({
    tagName: "BUTTON",
    type: "button",
    id: "save",
    textContent: "Save",
    labels: [],
  });
  const pageWindow = fakeWindow();
  const snapshot = snapshotPage(
    { title: "Demo", querySelectorAll: () => [input, button] },
    pageWindow,
    { contains: () => false },
  );
  assert.equal(snapshot.elements[0].text, null);
  assert.equal(snapshot.elements[1].text, "Save");
  await assert.rejects(
    performBrowserAction(
      { kind: "navigate", url: "https://example.com/" },
      {
        document: {},
        window: pageWindow,
        host: {},
        allowedOrigin: "http://localhost:5173",
      },
    ),
    /allowed origin/,
  );
});
