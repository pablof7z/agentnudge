export function awaitingAgentAfterMessages(messages, fallback = false) {
  const latest = messages.at(-1);
  return latest ? latest.role === "user" : fallback;
}
