export const THREAD_COLORS = [
  "#df5b39",
  "#3978cf",
  "#7b63c8",
  "#2d8a70",
  "#c38224",
  "#be5b8a",
];

import { toViewportRect } from "./viewport-evidence.js";

export function createReviewThread({ id, number, cardPosition, anchor, viewport = null, documentAnchor = null }) {
  return {
    id,
    number,
    color: THREAD_COLORS[(number - 1) % THREAD_COLORS.length],
    cardPosition: { ...cardPosition },
    anchor: { ...anchor },
    viewport: viewport ? { ...viewport } : null,
    documentAnchor: documentAnchor ? { ...documentAnchor } : null,
    references: [],
    draft: "",
    feedbackText: "",
    conversation: [],
    cursor: 0,
    asking: false,
    pending: false,
  };
}

export function referenceLabel(thread, index) {
  return `${thread.number}${alphabeticLabel(index)}`;
}

export function threadDisplayText(thread) {
  const explicit = thread.feedbackText.trim() || thread.draft.trim();
  if (explicit) return explicit;
  const latestUserMessage = [...thread.conversation]
    .reverse()
    .find((message) => message.role === "user")?.text?.trim();
  return latestUserMessage || "Marked context";
}

export function latestAgentReplyPreview(thread) {
  const reply = [...thread.conversation]
    .reverse()
    .find((message) => message.role === "agent")?.text;
  if (typeof reply !== "string") return "";
  return reply
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGroupedReviewPayload({ sessionId, threads, page, evidence = null, screenshotDataUrl = "" }) {
  return {
    sessionId,
    text: groupedReviewText(threads),
    page,
    attachments: groupedReviewAttachments(threads, evidence),
    screenshotDataUrl: evidence ? "" : screenshotDataUrl,
    captures: evidence?.captures || [],
    overview: evidence?.overview || null,
  };
}

export function buildThreadQuestionPayload({ sessionId, thread, question, page, evidence = null, screenshotDataUrl = "" }) {
  return {
    sessionId,
    text: question,
    page,
    attachments: groupedReviewAttachments([thread], evidence),
    screenshotDataUrl: evidence ? "" : screenshotDataUrl,
    captures: evidence?.captures || [],
    overview: evidence?.overview || null,
  };
}

export function beginThreadQuestion(thread, message) {
  const userMessage = {
    role: "user",
    text: message,
    referenceIds: thread.references.map((_, index) => referenceLabel(thread, index)),
  };
  thread.conversation.push(userMessage);
  thread.draft = "";
  thread.feedbackText = "";
  thread.asking = true;
  thread.pending = true;
  return userMessage;
}

export function reviewThreadMessagesUrl(endpoint, threadId) {
  return `${endpoint}/review/threads/${encodeURIComponent(threadId)}/messages`;
}

export function reviewThreadConversationUrl(endpoint, threadId, cursor) {
  return `${endpoint}/review/threads/${encodeURIComponent(threadId)}/conversation?after=${cursor}`;
}

export function reviewDraftUrl(endpoint) {
  return `${endpoint}/review/draft`;
}

export function groupedReviewText(threads) {
  const lines = [`Grouped review · ${threads.length} feedback thread${threads.length === 1 ? "" : "s"}`];
  for (const thread of threads) {
    lines.push("", `Thread ${thread.number}: ${threadDisplayText(thread)}`);
    if (thread.references.length) {
      lines.push(`References: ${thread.references.map((_, index) => referenceLabel(thread, index)).join(", ")}`);
    }
    if (thread.conversation.length) {
      lines.push("Inline discussion:");
      for (const message of thread.conversation) {
        const speaker = message.role === "agent" ? "Agent" : "You";
        const visibleReferences = message.referenceIds?.length
          ? ` [context: ${message.referenceIds.join(", ")}]`
          : "";
        lines.push(`${speaker}${visibleReferences}: ${message.text}`);
      }
    }
  }
  return lines.join("\n");
}

export function groupedReviewAttachments(threads, evidence = null) {
  const captureById = new Map((evidence?.captures || []).map((capture) => [capture.id, capture]));
  const assignments = evidence?.assignments || {};
  const attachments = [];
  for (const thread of threads) {
    const summary = attachmentComment(thread);
    if (!thread.references.length) {
      const key = `${thread.id}:page-note`;
      const captureId = assignments[key] || null;
      const documentRect = thread.documentAnchor
        ? { x: thread.documentAnchor.x - 1, y: thread.documentAnchor.y - 1, width: 2, height: 2 }
        : null;
      attachments.push({
        id: `${thread.id}-page-note`,
        kind: "region",
        rect: captureRelativeRect(documentRect, captureById.get(captureId)) || {
          x: thread.anchor.x - 1,
          y: thread.anchor.y - 1,
          width: 2,
          height: 2,
        },
        documentRect,
        captureId,
        element: null,
        comment: `[Thread ${thread.number}] ${summary}`,
        strokes: [],
      });
      continue;
    }
    thread.references.forEach((reference, index) => {
      const label = referenceLabel(thread, index);
      const key = `${thread.id}:${reference.id}`;
      const captureId = assignments[key] || null;
      const capture = captureById.get(captureId);
      attachments.push({
        id: `${thread.id}-${reference.id}`,
        kind: reference.kind,
        rect: captureRelativeRect(reference.documentRect, capture)
          || (reference.rect ? { ...reference.rect } : null),
        documentRect: reference.documentRect ? { ...reference.documentRect } : null,
        captureId,
        element: reference.kind === "element" ? { ...reference.element } : null,
        comment: `[${label} · Thread ${thread.number}] ${summary}`,
        strokes: reference.kind === "drawing"
          ? captureRelativeStrokes(reference.strokes || [], capture)
          : [],
      });
    });
  }
  return attachments;
}

function captureRelativeRect(documentRect, capture) {
  if (!documentRect || !capture?.pageRect) return null;
  return toViewportRect(documentRect, {
    scrollX: capture.pageRect.x,
    scrollY: capture.pageRect.y,
  });
}

function captureRelativeStrokes(strokes, capture) {
  if (!capture?.pageRect) return structuredClone(strokes);
  return strokes.map((stroke) => ({
    ...structuredClone(stroke),
    points: stroke.points.map((point) => ({
      x: point.x - capture.pageRect.x,
      y: point.y - capture.pageRect.y,
    })),
  }));
}

export function drawingBounds(strokes) {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
  };
}

function attachmentComment(thread) {
  const feedback = threadDisplayText(thread);
  if (!thread.conversation.length) return feedback;
  const transcript = thread.conversation
    .map((message) => `${message.role === "agent" ? "Agent" : "You"}: ${message.text}`)
    .join(" | ");
  return `${feedback} — inline discussion: ${transcript}`;
}

function alphabeticLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
