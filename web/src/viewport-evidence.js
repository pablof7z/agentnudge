const DEFAULT_CONTEXT_PADDING = 120;
const SAME_VIEWPORT_OVERLAP = 0.8;

export function currentPageViewport(pageWindow, pageDocument) {
  const root = pageDocument.documentElement;
  return {
    scrollX: pageWindow.scrollX,
    scrollY: pageWindow.scrollY,
    width: pageWindow.innerWidth,
    height: pageWindow.innerHeight,
    documentWidth: Math.max(root.scrollWidth, root.clientWidth, pageWindow.innerWidth),
    documentHeight: Math.max(root.scrollHeight, root.clientHeight, pageWindow.innerHeight),
  };
}

export function toDocumentPoint(point, viewport) {
  return {
    x: point.x + viewport.scrollX,
    y: point.y + viewport.scrollY,
  };
}

export function toDocumentRect(rect, viewport) {
  return {
    x: rect.x + viewport.scrollX,
    y: rect.y + viewport.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

export function toViewportPoint(point, viewport) {
  return {
    x: point.x - viewport.scrollX,
    y: point.y - viewport.scrollY,
  };
}

export function toViewportRect(rect, viewport) {
  return {
    x: rect.x - viewport.scrollX,
    y: rect.y - viewport.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

export function viewportPageRect(viewport) {
  const width = Math.min(viewport.width, viewport.documentWidth);
  const height = Math.min(viewport.height, viewport.documentHeight);
  return {
    x: clamp(viewport.scrollX, 0, Math.max(0, viewport.documentWidth - width)),
    y: clamp(viewport.scrollY, 0, Math.max(0, viewport.documentHeight - height)),
    width,
    height,
  };
}

export function documentCaptureGeometry(pageRect, viewport = pageRect) {
  return {
    x: pageRect.x,
    y: pageRect.y,
    width: pageRect.width,
    height: pageRect.height,
    windowWidth: viewport.width,
    windowHeight: viewport.height,
    scrollX: pageRect.x,
    scrollY: pageRect.y,
  };
}

export function planViewportCaptures(threads, { padding = DEFAULT_CONTEXT_PADDING } = {}) {
  const entries = reviewEntries(threads).sort((first, second) => (
    first.documentRect.y - second.documentRect.y
    || first.documentRect.x - second.documentRect.x
    || first.key.localeCompare(second.key)
  ));
  const captures = [];
  const assignments = {};

  for (const entry of entries) {
    const candidate = viewportPageRect(entry.viewport);
    let capture = captures.find((value) => containsWithPadding(value.pageRect, entry.documentRect, padding));
    if (!capture) {
      capture = captures.find((value) => overlapRatio(value.pageRect, candidate) >= SAME_VIEWPORT_OVERLAP);
    }
    if (!capture) {
      capture = {
        id: `V${captures.length + 1}`,
        pageRect: candidate,
        attachmentIds: [],
        referenceKeys: [],
      };
      captures.push(capture);
    }
    capture.attachmentIds.push(entry.attachmentId);
    capture.referenceKeys.push(entry.key);
    assignments[entry.key] = capture.id;
  }

  return { captures, assignments };
}

export function overviewScale(documentWidth, documentHeight, { maxWidth = 420, maxHeight = 1800 } = {}) {
  if (!(documentWidth > 0) || !(documentHeight > 0)) return 1;
  return Math.min(1, maxWidth / documentWidth, maxHeight / documentHeight);
}

export function overviewCanvasSize(
  documentWidth,
  documentHeight,
  { minWidth = 240, maxWidth = 420, maxHeight = 1800 } = {},
) {
  const scale = overviewScale(documentWidth, documentHeight, { maxWidth, maxHeight });
  return {
    width: Math.round(Math.min(maxWidth, Math.max(minWidth, documentWidth * scale))),
    height: Math.max(1, Math.round(Math.min(maxHeight, documentHeight * scale))),
  };
}

function reviewEntries(threads) {
  const entries = [];
  for (const thread of threads) {
    if (!thread.references.length) {
      const viewport = thread.viewport;
      const point = thread.documentAnchor || toDocumentPoint(thread.anchor, viewport);
      entries.push({
        key: `${thread.id}:page-note`,
        attachmentId: `${thread.id}-page-note`,
        viewport,
        documentRect: { x: point.x - 1, y: point.y - 1, width: 2, height: 2 },
      });
      continue;
    }
    for (const reference of thread.references) {
      entries.push({
        key: `${thread.id}:${reference.id}`,
        attachmentId: `${thread.id}-${reference.id}`,
        viewport: reference.viewport || thread.viewport,
        documentRect: reference.documentRect,
      });
    }
  }
  return entries.filter((entry) => entry.viewport && entry.documentRect);
}

function containsWithPadding(container, subject, padding) {
  const left = Math.max(container.x, subject.x - padding);
  const top = Math.max(container.y, subject.y - padding);
  const right = Math.min(container.x + container.width, subject.x + subject.width + padding);
  const bottom = Math.min(container.y + container.height, subject.y + subject.height + padding);
  const wantedWidth = Math.min(container.width, subject.width + padding * 2);
  const wantedHeight = Math.min(container.height, subject.height + padding * 2);
  return right - left >= wantedWidth && bottom - top >= wantedHeight;
}

function overlapRatio(first, second) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  const intersection = width * height;
  const smaller = Math.min(first.width * first.height, second.width * second.height);
  return smaller > 0 ? intersection / smaller : 0;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}
