import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { isSafeLinkHref, renderMarkdown } from "../src/markdown.js";

test("renders common response markdown into semantic elements", () => {
  const dom = new JSDOM();
  const root = renderMarkdown(
    dom.window.document,
    "This is **important**.\n\n- First\n- Second\n\n`cargo test`",
  );

  assert.equal(root.querySelector("strong")?.textContent, "important");
  assert.deepEqual(
    [...root.querySelectorAll("li")].map((item) => item.textContent),
    ["First", "Second"],
  );
  assert.equal(root.querySelector("code")?.textContent, "cargo test");
});

test("sanitizes embedded HTML and unsafe links", () => {
  const dom = new JSDOM();
  const root = renderMarkdown(
    dom.window.document,
    "<img src=x onerror=alert(1)> <script>alert(2)</script> [bad](javascript:alert(3)) [good](https://example.com)",
  );

  assert.equal(root.querySelector("img, script"), null);
  assert.equal(root.querySelector('a[href^="javascript:"]'), null);
  const link = root.querySelector('a[href="https://example.com"]');
  assert.equal(link?.target, "_blank");
  assert.equal(link?.rel, "nofollow noopener noreferrer");
});

test("allows web, mail, fragment, and relative links only", () => {
  assert.equal(isSafeLinkHref("https://example.com/docs"), true);
  assert.equal(isSafeLinkHref("mailto:hello@example.com"), true);
  assert.equal(isSafeLinkHref("#details"), true);
  assert.equal(isSafeLinkHref("../guide"), true);
  assert.equal(isSafeLinkHref("guide/getting-started"), true);
  assert.equal(isSafeLinkHref("javascript:alert(1)"), false);
  assert.equal(isSafeLinkHref("data:text/html,no"), false);
});
