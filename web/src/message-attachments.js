export function renderContextAttachments(ownerDocument, {
  attachments,
  focused,
  labelFor,
  onActivate,
}) {
  const container = ownerDocument.createElement("div");
  container.className = "message-attachments";
  attachments.forEach((attachment, index) => {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "message-attachment";
    button.dataset.active = String(focused);
    button.title = "Show this attachment on the page";
    const number = ownerDocument.createElement("span");
    number.className = "attachment-number";
    number.textContent = String(index + 1);
    const copy = ownerDocument.createElement("span");
    copy.className = "message-attachment-copy";
    if (attachment.comment) {
      const comment = ownerDocument.createElement("strong");
      comment.textContent = attachment.comment;
      const label = ownerDocument.createElement("span");
      label.textContent = labelFor(attachment);
      copy.append(comment, label);
    } else {
      const label = ownerDocument.createElement("span");
      label.textContent = labelFor(attachment);
      copy.append(label);
    }
    button.append(number, copy);
    button.addEventListener("click", onActivate);
    container.append(button);
  });
  return container;
}
