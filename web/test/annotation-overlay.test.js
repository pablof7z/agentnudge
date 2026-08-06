import test from "node:test";
import assert from "node:assert/strict";

import { placeFloatingRect, pointInClosedPath, rectanglePoints } from "../src/annotation-geometry.js";
import { paintCommentReview, paintMessageAttachments } from "../src/annotation-overlay.js";

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

test("places a comment below a drawing when neither horizontal side fits", () => {
  const drawing = { x: 72, y: 30, width: 260, height: 160 };
  const position = placeFloatingRect({
    anchor: { x: 332, y: 190 },
    exclusionRect: drawing,
    viewport: { width: 500, height: 600 },
    floatingSize: { width: 292, height: 220 },
  });

  assert.deepEqual(position, { x: 72, y: 206 });
});

test("keeps the preferred right-side placement when it fits", () => {
  const position = placeFloatingRect({
    anchor: { x: 200, y: 180 },
    exclusionRect: { x: 100, y: 100, width: 100, height: 80 },
    viewport: { width: 1_200, height: 800 },
    floatingSize: { width: 292, height: 220 },
  });

  assert.deepEqual(position, { x: 216, y: 100 });
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

test("paints drawings and complete sticky notes into review screenshots", () => {
  const calls = [];
  const context = {
    save: () => calls.push(["save"]),
    setTransform: (...values) => calls.push(["setTransform", ...values]),
    restore: () => calls.push(["restore"]),
  };
  const comment = {
    id: "comment-1",
    message: "Move this below the heading",
    cardPosition: { x: 200, y: 80 },
  };

  paintCommentReview({
    context,
    canvas: { width: 1_800, height: 1_200 },
    viewport: { width: 900, height: 600 },
    strokes: [{ id: "stroke-1" }],
    comments: [comment],
    resolveCommentRect: () => ({ x: 20, y: 30, width: 100, height: 40 }),
    paintStroke: (_context, stroke) => calls.push(["stroke", stroke.id]),
    paintSticky: (_context, value, rect, position, number) => {
      calls.push(["sticky", value.message, rect, position, number]);
    },
  });

  assert.deepEqual(calls, [
    ["save"],
    ["setTransform", 2, 0, 0, 2, 0, 0],
    ["stroke", "stroke-1"],
    [
      "sticky",
      "Move this below the heading",
      { x: 20, y: 30, width: 100, height: 40 },
      { x: 200, y: 80 },
      1,
    ],
    ["restore"],
  ]);
});
