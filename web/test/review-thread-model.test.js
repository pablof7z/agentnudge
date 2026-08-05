import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroupedReviewPayload,
  createReviewThread,
  groupedReviewAttachments,
  prototypeAgentReply,
  referenceLabel,
} from "../src/review-thread-model.js";

function thread(number = 1) {
  return createReviewThread({
    id: `thread-${number}`,
    number,
    cardPosition: { x: 300, y: 80 },
    anchor: { x: 100, y: 90 },
  });
}

test("uses one color-and-number namespace for every reference in a thread", () => {
  const value = thread(2);
  value.references.push({ kind: "element" }, { kind: "region" }, { kind: "drawing" });
  assert.deepEqual(value.references.map((_, index) => referenceLabel(value, index)), ["2A", "2B", "2C"]);
});

test("keeps grouped references and the inline transcript in the final batch", () => {
  const value = thread();
  value.feedbackText = "These should align";
  value.references.push(
    {
      id: "ref-1",
      kind: "element",
      rect: { x: 10, y: 20, width: 80, height: 32 },
      element: { tag: "button", selector: "#one", classes: [] },
    },
    {
      id: "ref-2",
      kind: "region",
      rect: { x: 130, y: 20, width: 90, height: 32 },
      element: null,
    },
  );
  value.conversation.push(
    { role: "user", text: "Why are these different?", referenceIds: ["1A", "1B"] },
    { role: "agent", text: "They use different containers." },
  );

  const payload = buildGroupedReviewPayload({
    sessionId: "lima",
    threads: [value],
    page: { title: "Demo" },
    screenshotDataUrl: "data:image/png;base64,x",
  });
  assert.match(payload.text, /Thread 1: These should align/);
  assert.match(payload.text, /You \[context: 1A, 1B\]: Why are these different\?/);
  assert.equal(payload.attachments.length, 2);
  assert.match(payload.attachments[0].comment, /\[1A · Thread 1\]/);
  assert.match(payload.attachments[1].comment, /\[1B · Thread 1\]/);
});

test("represents an unanchored page note as a tiny region attachment", () => {
  const value = thread(3);
  value.feedbackText = "General spacing feels cramped";
  assert.deepEqual(groupedReviewAttachments([value])[0].rect, {
    x: 99,
    y: 89,
    width: 2,
    height: 2,
  });
});

test("makes the simulated response explicit about prototype behavior", () => {
  const value = thread();
  value.references.push({ kind: "region" }, { kind: "region" });
  assert.match(prototypeAgentReply(value), /1A and 1B/);
  assert.match(prototypeAgentReply(value), /prototype response/);
});
