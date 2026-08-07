import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroupedReviewPayload,
  buildThreadQuestionPayload,
  beginThreadQuestion,
  createReviewThread,
  groupedReviewAttachments,
  latestAgentReplyPreview,
  referenceLabel,
  reviewDraftUrl,
  reviewThreadConversationUrl,
  reviewThreadMessagesUrl,
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

test("ties each attachment to its detailed viewport capture and includes the overview", () => {
  const first = thread(1);
  first.references.push({
    id: "ref-1",
    kind: "region",
    rect: { x: 20, y: 30, width: 40, height: 50 },
    documentRect: { x: 20, y: 30, width: 40, height: 50 },
    element: null,
  });
  const second = thread(2);
  second.references.push({
    id: "ref-2",
    kind: "region",
    rect: { x: 80, y: 100, width: 60, height: 70 },
    documentRect: { x: 80, y: 5300, width: 60, height: 70 },
    element: null,
  });
  const evidence = {
    assignments: {
      "thread-1:ref-1": "V1",
      "thread-2:ref-2": "V2",
    },
    captures: [
      {
        id: "V1",
        kind: "viewport",
        pageRect: { x: 0, y: 0, width: 1200, height: 800 },
        attachmentIds: ["thread-1-ref-1"],
        screenshotDataUrl: "data:image/png;base64,one",
      },
      {
        id: "V2",
        kind: "viewport",
        pageRect: { x: 0, y: 5200, width: 1200, height: 800 },
        attachmentIds: ["thread-2-ref-2"],
        screenshotDataUrl: "data:image/png;base64,two",
      },
    ],
    overview: {
      id: "overview",
      kind: "overview",
      pageRect: { x: 0, y: 0, width: 1200, height: 8000 },
      attachmentIds: ["thread-1-ref-1", "thread-2-ref-2"],
      screenshotDataUrl: "data:image/png;base64,map",
    },
  };

  const payload = buildGroupedReviewPayload({
    sessionId: "lima",
    threads: [first, second],
    page: { title: "Long page" },
    evidence,
  });

  assert.equal(payload.screenshotDataUrl, "");
  assert.equal(payload.captures.length, 2);
  assert.equal(payload.overview.id, "overview");
  assert.equal(payload.attachments[0].captureId, "V1");
  assert.deepEqual(payload.attachments[1].rect, { x: 80, y: 100, width: 60, height: 70 });
  assert.deepEqual(payload.attachments[1].documentRect, { x: 80, y: 5300, width: 60, height: 70 });
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

test("builds a thread-scoped question with its grouped context", () => {
  const value = thread();
  value.references.push({
    id: "ref-1",
    kind: "region",
    rect: { x: 10, y: 20, width: 30, height: 40 },
    element: null,
  });
  const payload = buildThreadQuestionPayload({
    sessionId: "lima",
    thread: value,
    question: "Why is this so tall?",
    page: { title: "Demo" },
    screenshotDataUrl: "data:image/png;base64,x",
  });
  assert.equal(payload.text, "Why is this so tall?");
  assert.equal(payload.attachments.length, 1);
  assert.match(payload.attachments[0].comment, /\[1A · Thread 1\]/);
});

test("moves an asked thread into the pending stack while the agent runs", () => {
  const value = thread();
  value.draft = "What is this for?";
  value.references.push({ id: "ref-1", kind: "region" });

  const message = beginThreadQuestion(value, value.draft);

  assert.equal(value.asking, true);
  assert.equal(value.pending, true);
  assert.equal(value.draft, "");
  assert.deepEqual(message.referenceIds, ["1A"]);
});

test("builds a compact one-line agent reply preview", () => {
  const value = thread();
  value.conversation.push({ role: "agent", text: "First line\n\nSecond **line**" });

  assert.equal(latestAgentReplyPreview(value), "First line Second line");
});

test("scopes review conversation URLs to one encoded thread", () => {
  assert.equal(
    reviewThreadMessagesUrl("http://127.0.0.1:4317/lima", "thread 1"),
    "http://127.0.0.1:4317/lima/review/threads/thread%201/messages",
  );
  assert.equal(
    reviewThreadConversationUrl("http://127.0.0.1:4317/lima", "thread-1", 4),
    "http://127.0.0.1:4317/lima/review/threads/thread-1/conversation?after=4",
  );
  assert.equal(
    reviewDraftUrl("http://127.0.0.1:4317/lima"),
    "http://127.0.0.1:4317/lima/review/draft",
  );
});
