import assert from "node:assert/strict";
import test from "node:test";

import { paintOverviewMap, paintReviewMarks } from "../src/review-capture.js";
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

test("translates document-space drawings into their distant viewport capture", () => {
  const calls = [];
  const thread = createReviewThread({
    id: "thread-1",
    number: 1,
    cardPosition: { x: 120, y: 80 },
    anchor: { x: 40, y: 40 },
  });
  thread.references.push({
    id: "reference-1",
    kind: "drawing",
    documentRect: { x: 10, y: 5220, width: 50, height: 40 },
    strokes: [{
      id: "stroke-1",
      points: [{ x: 10, y: 5220 }, { x: 60, y: 5260 }],
      width: 4,
    }],
  });

  paintReviewMarks({
    context: recordingContext(calls),
    canvas: { width: 800, height: 600 },
    viewport: { width: 800, height: 600 },
    captureRect: { x: 0, y: 5200 },
    threads: [thread],
    resolveReferenceRect: (reference) => reference.documentRect,
  });

  assert.ok(calls.some((call) => (
    call[0] === "setTransform" && call[1] === 1 && call[4] === 1 && call[6] === -5200
  )));
  assert.ok(calls.some(([name, x, y]) => name === "moveTo" && x === 10 && y === 5220));
});

test("marks detailed viewport rectangles on a compressed whole-page overview", () => {
  const calls = [];
  paintOverviewMap({
    context: recordingContext(calls),
    canvas: { width: 240, height: 1800 },
    documentSize: { width: 1200, height: 120000 },
    captures: [{ id: "V2", pageRect: { x: 0, y: 60000, width: 1200, height: 800 } }],
  });

  assert.ok(calls.some(([name, x, y, width, height]) => (
    name === "strokeRect" && x === 0 && y === 900 && width === 240 && height === 12
  )));
  assert.ok(calls.some(([name, value]) => name === "fillText" && value === "V2"));
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
