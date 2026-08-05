export function buildReviewAttachments({ comments, strokes, resolveCommentRect, strokeCounter }) {
  const attachments = comments.map((comment) => {
    const rect = resolveCommentRect(comment);
    const kind = comment.selection?.kind || "region";
    return {
      id: comment.id,
      kind,
      rect: rect || { x: comment.position.x - 1, y: comment.position.y - 1, width: 2, height: 2 },
      element: kind === "element" ? { ...comment.selection.element } : null,
      comment: comment.message,
      strokes: [],
    };
  });
  if (strokes.length) {
    attachments.push({
      id: `review-drawing-${strokeCounter + 1}`,
      kind: "drawing",
      rect: drawingBounds(strokes),
      element: null,
      comment: null,
      strokes: structuredClone(strokes),
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
