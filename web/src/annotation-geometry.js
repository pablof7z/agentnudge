export function rectanglePoints(rect) {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ];
}

export function pointInClosedPath(point, points) {
  if (points.length < 4) return false;
  const first = points[0];
  const last = points.at(-1);
  if (first.x !== last.x || first.y !== last.y) return false;

  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const start = points[index];
    const end = points[previous];
    const crosses = (start.y > point.y) !== (end.y > point.y)
      && point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function placeFloatingRect({ anchor, exclusionRect, viewport, floatingSize, gap = 16, margin = 12 }) {
  const target = exclusionRect || { x: anchor.x, y: anchor.y, width: 0, height: 0 };
  const limits = {
    left: margin,
    top: margin,
    right: Math.max(margin, viewport.width - floatingSize.width - margin),
    bottom: Math.max(margin, viewport.height - floatingSize.height - margin),
  };
  const alignedX = clamp(target.x, limits.left, limits.right);
  const alignedY = clamp(target.y, limits.top, limits.bottom);
  const candidates = [
    { x: target.x + target.width + gap, y: alignedY },
    { x: target.x - floatingSize.width - gap, y: alignedY },
    { x: alignedX, y: target.y + target.height + gap },
    { x: alignedX, y: target.y - floatingSize.height - gap },
  ];
  const fitting = candidates.find((position) => position.x >= limits.left
    && position.x <= limits.right
    && position.y >= limits.top
    && position.y <= limits.bottom);
  if (fitting) return fitting;

  return candidates
    .map((position, index) => ({
      index,
      position: {
        x: clamp(position.x, limits.left, limits.right),
        y: clamp(position.y, limits.top, limits.bottom),
      },
    }))
    .sort((first, second) => {
      const overlap = overlapArea(first.position, second.position, floatingSize, target);
      return overlap || first.index - second.index;
    })[0].position;
}

function overlapArea(firstPosition, secondPosition, floatingSize, target) {
  return rectOverlapArea(firstPosition, floatingSize, target) - rectOverlapArea(secondPosition, floatingSize, target);
}

function rectOverlapArea(position, size, target) {
  const width = Math.max(0, Math.min(position.x + size.width, target.x + target.width) - Math.max(position.x, target.x));
  const height = Math.max(0, Math.min(position.y + size.height, target.y + target.height) - Math.max(position.y, target.y));
  return width * height;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}
