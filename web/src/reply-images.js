const IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function replyImageRequestUrl(endpoint, sessionId, attachment) {
  const id = String(attachment?.id || "");
  if (!IMAGE_ID_PATTERN.test(id)) return null;
  const expectedPath = `/${encodeURIComponent(sessionId)}/reply-assets/${id}`;
  if (attachment.assetPath !== expectedPath) return null;
  try {
    return new URL(expectedPath, new URL(endpoint).origin).toString();
  } catch {
    return null;
  }
}

export function replyImageLabel(attachment) {
  const name = String(attachment?.fileName || "").trim();
  return name || "Attached image";
}
