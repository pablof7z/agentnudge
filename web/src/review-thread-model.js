export const THREAD_COLORS = [
  "#df5b39",
  "#3978cf",
  "#7b63c8",
  "#2d8a70",
  "#c38224",
  "#be5b8a",
];

export function createReviewThread({ id, number, cardPosition, anchor }) {
  return {
    id,
    number,
    color: THREAD_COLORS[(number - 1) % THREAD_COLORS.length],
    cardPosition: { ...cardPosition },
    anchor: { ...anchor },
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

export function buildGroupedReviewPayload({ sessionId, threads, page, screenshotDataUrl }) {
  return {
    sessionId,
    text: groupedReviewText(threads),
    page,
    attachments: groupedReviewAttachments(threads),
    screenshotDataUrl,
  };
}

export function buildThreadQuestionPayload({ sessionId, thread, question, page, screenshotDataUrl }) {
  return {
    sessionId,
    text: question,
    page,
    attachments: groupedReviewAttachments([thread]),
    screenshotDataUrl,
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

export function groupedReviewAttachments(threads) {
  const attachments = [];
  for (const thread of threads) {
    const summary = attachmentComment(thread);
    if (!thread.references.length) {
      attachments.push({
        id: `${thread.id}-page-note`,
        kind: "region",
        rect: {
          x: thread.anchor.x - 1,
          y: thread.anchor.y - 1,
          width: 2,
          height: 2,
        },
        element: null,
        comment: `[Thread ${thread.number}] ${summary}`,
        strokes: [],
      });
      continue;
    }
    thread.references.forEach((reference, index) => {
      const label = referenceLabel(thread, index);
      attachments.push({
        id: `${thread.id}-${reference.id}`,
        kind: reference.kind,
        rect: reference.rect ? { ...reference.rect } : null,
        element: reference.kind === "element" ? { ...reference.element } : null,
        comment: `[${label} · Thread ${thread.number}] ${summary}`,
        strokes: reference.kind === "drawing" ? structuredClone(reference.strokes || []) : [],
      });
    });
  }
  return attachments;
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
