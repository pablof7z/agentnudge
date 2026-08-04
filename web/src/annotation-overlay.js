export function paintAnnotationOverlay({
  context,
  canvas,
  viewport,
  strokes,
  comments,
  resolveCommentRect,
  paintStroke,
  paintSticky,
}) {
  const scaleX = canvas.width / viewport.width;
  const scaleY = canvas.height / viewport.height;
  context.save();
  try {
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    strokes.forEach((stroke) => paintStroke(context, stroke));
    comments.forEach((comment, index) => {
      paintSticky(
        context,
        comment,
        resolveCommentRect(comment),
        comment.cardPosition,
        index + 1,
      );
    });
  } finally {
    context.restore();
  }
}
