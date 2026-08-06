export function awaitingAgentAfterMessages(messages, fallback = false) {
  const latest = messages.at(-1);
  return latest ? latest.role === "user" : fallback;
}

export function messageAuthorLabel(message) {
  const author = message.role === "agent" ? "Agent" : "You";
  if (!message.reviewThreadId) return author;
  const thread = String(message.reviewThreadId).replace(/^thread-/, "");
  return `${author} · Feedback ${thread}`;
}
