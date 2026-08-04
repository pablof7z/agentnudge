import test from "node:test";
import assert from "node:assert/strict";

import { paintAnnotationOverlay } from "../src/annotation-overlay.js";

test("resets the screenshot transform and paints ink and stickies", () => {
  const calls = [];
  const context = {
    save: () => calls.push(["save"]),
    setTransform: (...values) => calls.push(["setTransform", ...values]),
    restore: () => calls.push(["restore"]),
  };
  const stroke = { id: "stroke-1" };
  const comment = { id: "comment-1", cardPosition: { x: 320, y: 180 } };

  paintAnnotationOverlay({
    context,
    canvas: { width: 2_400, height: 1_600 },
    viewport: { width: 1_200, height: 800 },
    strokes: [stroke],
    comments: [comment],
    resolveCommentRect: () => ({ x: 20, y: 30, width: 100, height: 40 }),
    paintStroke: (_context, value) => calls.push(["stroke", value.id]),
    paintSticky: (_context, value, rect, position, number) => {
      calls.push(["sticky", value.id, rect, position, number]);
    },
  });

  assert.deepEqual(calls, [
    ["save"],
    ["setTransform", 2, 0, 0, 2, 0, 0],
    ["stroke", "stroke-1"],
    [
      "sticky",
      "comment-1",
      { x: 20, y: 30, width: 100, height: 40 },
      { x: 320, y: 180 },
      1,
    ],
    ["restore"],
  ]);
});
