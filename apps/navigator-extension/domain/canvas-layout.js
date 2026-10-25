export function canvasEdge(from, to, width = 270, height = 140, offset = 0) {
  const dx = to.x - from.x, dy = to.y - from.y;
  let start, end, c1, c2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const forward = dx >= 0, bend = Math.max(50, Math.abs(dx) / 2);
    start = { x: from.x + (forward ? width : 0), y: from.y + height / 2 };
    end = { x: to.x + (forward ? 0 : width), y: to.y + height / 2 };
    c1 = { x: start.x + (forward ? bend : -bend), y: start.y }; c2 = { x: end.x - (forward ? bend : -bend), y: end.y };
  } else {
    const forward = dy >= 0, bend = Math.max(40, Math.abs(dy) / 2);
    start = { x: from.x + width / 2, y: from.y + (forward ? height : 0) };
    end = { x: to.x + width / 2, y: to.y + (forward ? 0 : height) };
    c1 = { x: start.x, y: start.y + (forward ? bend : -bend) }; c2 = { x: end.x, y: end.y - (forward ? bend : -bend) };
  }
  const length = Math.hypot(dx, dy) || 1, shift = { x: -dy / length * offset, y: dx / length * offset };
  c1 = { x: c1.x + shift.x, y: c1.y + shift.y }; c2 = { x: c2.x + shift.x, y: c2.y + shift.y };
  return { path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`, start, end,
    label: { x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 - 8 } };
}
