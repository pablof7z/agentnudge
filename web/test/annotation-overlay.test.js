import test from "node:test";
import assert from "node:assert/strict";

import { pointInClosedPath, rectanglePoints } from "../src/annotation-geometry.js";
import { paintMessageAttachments } from "../src/annotation-overlay.js";

test("turns an area drag into a closed rectangle path", () => {
  const points = rectanglePoints({ x: 20, y: 30, width: 100, height: 40 });
  assert.deepEqual(points, [
    { x: 20, y: 30 },
    { x: 120, y: 30 },
    { x: 120, y: 70 },
    { x: 20, y: 70 },
    { x: 20, y: 30 },
  ]);
  assert.equal(pointInClosedPath({ x: 60, y: 50 }, points), true);
  assert.equal(pointInClosedPath({ x: 160, y: 50 }, points), false);
});

test("resets the screenshot transform and paints numbered attachments", () => {
  const calls = [];
  const context = {
    save: () => calls.push(["save"]),
    setTransform: (...values) => calls.push(["setTransform", ...values]),
    restore: () => calls.push(["restore"]),
  };
  const attachment = {
    id: "attachment-1",
    kind: "drawing",
    rect: { x: 20, y: 30, width: 100, height: 40 },
    strokes: [{ id: "stroke-1" }, { id: "stroke-2" }],
  };

  paintMessageAttachments({
    context,
    canvas: { width: 2_400, height: 1_600 },
    viewport: { width: 1_200, height: 800 },
    attachments: [attachment],
    resolveAttachmentRect: (value) => value.rect,
    paintStroke: (_context, value) => calls.push(["stroke", value.id]),
    paintMarker: (_context, value, rect, number) => {
      calls.push(["marker", value.id, rect, number]);
    },
  });

  assert.deepEqual(calls, [
    ["save"],
    ["setTransform", 2, 0, 0, 2, 0, 0],
    ["stroke", "stroke-1"],
    ["stroke", "stroke-2"],
    ["marker", "attachment-1", { x: 20, y: 30, width: 100, height: 40 }, 1],
    ["restore"],
  ]);
});
