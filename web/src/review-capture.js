import { referenceLabel } from "./review-thread-model.js";

export function paintReviewMarks({
  context,
  canvas,
  viewport,
  captureRect = { x: 0, y: 0 },
  threads,
  resolveReferenceRect,
  includeReference = () => true,
  includePageNote = () => true,
}) {
  const scaleX = canvas.width / viewport.width;
  const scaleY = canvas.height / viewport.height;
  context.save();
  try {
    context.setTransform(
      scaleX,
      0,
      0,
      scaleY,
      -captureRect.x * scaleX,
      -captureRect.y * scaleY,
    );
    for (const thread of threads) {
      thread.references.forEach((reference, index) => {
        if (!includeReference(thread, reference)) return;
        const rect = resolveReferenceRect(reference);
        if (reference.kind === "drawing") {
          for (const stroke of reference.strokes) drawStroke(context, stroke, thread.color);
        } else if (rect) {
          context.fillStyle = colorWithAlpha(thread.color, "14");
          context.strokeStyle = thread.color;
          context.lineWidth = 2;
          context.fillRect(rect.x, rect.y, rect.width, rect.height);
          context.strokeRect(rect.x, rect.y, rect.width, rect.height);
        }
        if (rect) drawMarker(context, rect, referenceLabel(thread, index), thread.color);
      });
      if (!thread.references.length && includePageNote(thread)) {
        const anchor = thread.documentAnchor || thread.anchor;
        drawMarker(
          context,
          { x: anchor.x - 1, y: anchor.y - 1, width: 2, height: 2 },
          String(thread.number),
          thread.color,
        );
      }
    }
  } finally {
    context.restore();
  }
}

export function paintOverviewMap({ context, canvas, documentSize, captures }) {
  const scaleX = canvas.width / documentSize.width;
  const scaleY = canvas.height / documentSize.height;
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    const lineWidth = 3;
    const labelRadius = 13;
    for (const capture of captures) {
      const rect = capture.pageRect;
      const painted = {
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: Math.max(2, rect.width * scaleX),
        height: Math.max(2, rect.height * scaleY),
      };
      context.fillStyle = "rgb(223 91 57 / .12)";
      context.strokeStyle = "#df5b39";
      context.lineWidth = lineWidth;
      context.fillRect(painted.x, painted.y, painted.width, painted.height);
      context.strokeRect(painted.x, painted.y, painted.width, painted.height);
      const x = Math.max(labelRadius + 2, painted.x + labelRadius + 2);
      const y = Math.max(labelRadius + 2, painted.y + labelRadius + 2);
      context.beginPath();
      context.arc(x, y, labelRadius, 0, Math.PI * 2);
      context.fillStyle = "#df5b39";
      context.fill();
      context.fillStyle = "#fff";
      context.font = "800 11px ui-sans-serif, -apple-system, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(capture.id, x, y);
    }
  } finally {
    context.restore();
  }
}

function drawStroke(context, stroke, color) {
  if (!stroke.points.length) return;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  context.restore();
}

function drawMarker(context, rect, label, color) {
  const x = Math.max(15, rect.x + 7);
  const y = Math.max(15, rect.y + 7);
  context.save();
  context.beginPath();
  context.arc(x, y, 13, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = "#fffaf5";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#fff";
  context.font = "800 9px ui-sans-serif, -apple-system, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x, y + .5);
  context.restore();
}

function colorWithAlpha(color, alpha) {
  return `${color}${alpha}`;
}
