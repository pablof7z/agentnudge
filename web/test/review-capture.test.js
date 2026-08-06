import assert from "node:assert/strict";
import test from "node:test";

import { paintReviewMarks } from "../src/review-capture.js";
import { createReviewThread } from "../src/review-thread-model.js";

test("captures marks and numbered anchors without painting the comment card", () => {
  const calls = [];
  const context = recordingContext(calls);
  const thread = createReviewThread({
    id: "thread-1",
    number: 1,
    cardPosition: { x: 120, y: 80 },
    anchor: { x: 40, y: 40 },
  });
  thread.feedbackText = "This card must not cover the page";
  thread.references.push({
    id: "reference-1",
    kind: "drawing",
    rect: { x: 10, y: 20, width: 50, height: 40 },
    strokes: [{
      id: "stroke-1",
      points: [{ x: 10, y: 20 }, { x: 60, y: 60 }],
      width: 4,
    }],
  });

  paintReviewMarks({
    context,
    canvas: { width: 800, height: 600 },
    viewport: { width: 800, height: 600 },
    threads: [thread],
    resolveReferenceRect: (reference) => reference.rect,
  });

  assert.ok(calls.some(([name]) => name === "stroke"), "the freehand stroke is painted");
  assert.deepEqual(
    calls.filter(([name]) => name === "fillText").map(([, value]) => value),
    ["1A"],
    "only the mark anchor is painted; the feedback card copy is omitted",
  );
});

function recordingContext(calls) {
  const context = {};
  for (const method of [
    "save",
    "restore",
    "setTransform",
    "fillRect",
    "strokeRect",
    "beginPath",
    "moveTo",
    "lineTo",
    "arc",
    "fill",
    "stroke",
    "fillText",
  ]) {
    context[method] = (...arguments_) => calls.push([method, ...arguments_]);
  }
  return context;
}
