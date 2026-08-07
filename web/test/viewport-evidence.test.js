import assert from "node:assert/strict";
import test from "node:test";

import {
  documentCaptureGeometry,
  overviewScale,
  overviewCanvasSize,
  planViewportCaptures,
  toDocumentPoint,
  toDocumentRect,
  toViewportRect,
} from "../src/viewport-evidence.js";

function viewport(scrollY) {
  return {
    scrollX: 0,
    scrollY,
    width: 1200,
    height: 800,
    documentWidth: 1200,
    documentHeight: 8000,
  };
}

test("converts review geometry between viewport and document coordinates", () => {
  const page = viewport(3200);
  assert.deepEqual(toDocumentPoint({ x: 40, y: 50 }, page), { x: 40, y: 3250 });
  assert.deepEqual(
    toDocumentRect({ x: 20, y: 30, width: 100, height: 40 }, page),
    { x: 20, y: 3230, width: 100, height: 40 },
  );
  assert.deepEqual(
    toViewportRect({ x: 20, y: 3230, width: 100, height: 40 }, page),
    { x: 20, y: 30, width: 100, height: 40 },
  );
});

test("renders a document crop through a clone scrolled to that exact region", () => {
  assert.deepEqual(
    documentCaptureGeometry(
      { x: 0, y: 5200, width: 1200, height: 800 },
      { width: 1200, height: 800 },
    ),
    {
      x: 0,
      y: 5200,
      width: 1200,
      height: 800,
      windowWidth: 1200,
      windowHeight: 800,
      scrollX: 0,
      scrollY: 5200,
    },
  );
});

test("groups two annotations in one viewport and a distant annotation into a second capture", () => {
  const top = viewport(0);
  const lower = viewport(5200);
  const threads = [
    thread("thread-1", "reference-1", top, { x: 80, y: 120, width: 100, height: 50 }),
    thread("thread-2", "reference-2", top, { x: 600, y: 500, width: 120, height: 60 }),
    thread("thread-3", "reference-3", lower, { x: 220, y: 5480, width: 160, height: 80 }),
  ];

  const plan = planViewportCaptures(threads);

  assert.equal(plan.captures.length, 2);
  assert.deepEqual(plan.captures[0].attachmentIds, [
    "thread-1-reference-1",
    "thread-2-reference-2",
  ]);
  assert.deepEqual(plan.captures[1].attachmentIds, ["thread-3-reference-3"]);
  assert.equal(plan.assignments["thread-3:reference-3"], "V2");
});

test("orders viewport captures by page position rather than comment creation order", () => {
  const plan = planViewportCaptures([
    thread("thread-1", "reference-1", viewport(5200), { x: 20, y: 5300, width: 20, height: 20 }),
    thread("thread-2", "reference-2", viewport(0), { x: 20, y: 100, width: 20, height: 20 }),
  ]);

  assert.equal(plan.captures[0].pageRect.y, 0);
  assert.equal(plan.captures[1].pageRect.y, 5200);
  assert.equal(plan.assignments["thread-2:reference-2"], "V1");
});

test("caps the overview dimensions for a very long page", () => {
  assert.equal(overviewScale(1200, 12000), 0.15);
  assert.equal(overviewScale(300, 500), 1);
  assert.deepEqual(overviewCanvasSize(1200, 120000), { width: 240, height: 1800 });
  assert.deepEqual(overviewCanvasSize(1200, 1200), { width: 420, height: 420 });
});

function thread(threadId, referenceId, pageViewport, documentRect) {
  return {
    id: threadId,
    viewport: pageViewport,
    references: [{
      id: referenceId,
      viewport: pageViewport,
      documentRect,
    }],
  };
}
