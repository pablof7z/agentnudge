import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewAttachments } from "../src/review-payload.js";

test("keeps each sticky comment attached to its selected page context", () => {
  const element = {
    tag: "button",
    id: "save",
    classes: [],
    role: "button",
    accessibleName: "Save",
    text: "Save",
    selector: "#save",
  };
  const comments = [
    {
      id: "comment-1",
      message: "Move this below the form",
      position: { x: 100, y: 80 },
      selection: { kind: "element", rect: { x: 20, y: 30, width: 90, height: 40 }, element },
    },
    {
      id: "comment-2",
      message: "Add more space here",
      position: { x: 300, y: 220 },
      selection: null,
    },
  ];

  const attachments = buildReviewAttachments({
    comments,
    strokes: [],
    resolveCommentRect: (comment) => comment.selection?.rect || null,
    strokeCounter: 0,
  });

  assert.equal(attachments[0].comment, "Move this below the form");
  assert.deepEqual(attachments[0].element, element);
  assert.deepEqual(attachments[1].rect, { x: 299, y: 219, width: 2, height: 2 });
  assert.equal(attachments[1].comment, "Add more space here");
});

test("batches all freehand marks into the same review message", () => {
  const strokes = [
    { id: "stroke-1", points: [{ x: 20, y: 30 }, { x: 80, y: 90 }], color: "#df5b39", width: 4 },
    { id: "stroke-2", points: [{ x: 10, y: 50 }, { x: 120, y: 70 }], color: "#df5b39", width: 4 },
  ];
  const attachments = buildReviewAttachments({
    comments: [],
    strokes,
    resolveCommentRect: () => null,
    strokeCounter: 2,
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].kind, "drawing");
  assert.deepEqual(attachments[0].rect, { x: 10, y: 30, width: 110, height: 60 });
  assert.deepEqual(attachments[0].strokes, strokes);
});
