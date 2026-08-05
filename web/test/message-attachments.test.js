import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { renderContextAttachments } from "../src/message-attachments.js";

test("renders sticky text and its target together as bubble content", () => {
  const dom = new JSDOM();
  const container = renderContextAttachments(dom.window.document, {
    attachments: [{ kind: "region", comment: "Move this below the heading" }],
    focused: false,
    labelFor: () => "Area · 220×90",
    onActivate: () => {},
  });

  assert.equal(container.className, "message-attachments");
  assert.equal(container.querySelector("strong")?.textContent, "Move this below the heading");
  assert.equal(container.querySelector(".message-attachment-copy span")?.textContent, "Area · 220×90");
});
