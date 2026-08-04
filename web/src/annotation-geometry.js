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
