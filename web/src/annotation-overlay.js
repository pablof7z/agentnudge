export function paintMessageAttachments({
  context,
  canvas,
  viewport,
  attachments,
  resolveAttachmentRect,
  paintStroke,
  paintMarker,
}) {
  const scaleX = canvas.width / viewport.width;
  const scaleY = canvas.height / viewport.height;
  context.save();
  try {
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    attachments.forEach((attachment, index) => {
      attachment.strokes.forEach((stroke) => paintStroke(context, stroke));
      paintMarker(context, attachment, resolveAttachmentRect(attachment), index + 1);
    });
  } finally {
    context.restore();
  }
}
