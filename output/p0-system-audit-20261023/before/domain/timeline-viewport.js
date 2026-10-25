// One effective scale for the controller and renderer. Browser scroll surfaces
// are bounded; clamp the requested span before calculating coordinates.
export function timelineViewport(fitSpan, requestedSpan, viewportWidth) {
  const width = Math.max(240, Number(viewportWidth) || 240);
  const usable = width - 48;
  const minSpan = Math.max(1000, fitSpan * usable / 1000000);
  const maxSpan = Math.max(minSpan, fitSpan * 8);
  const visibleSpan = Math.max(minSpan, Math.min(maxSpan, Number(requestedSpan) > 0 ? Number(requestedSpan) : fitSpan));
  return { width, minSpan, maxSpan, visibleSpan, pxPerMs: usable / visibleSpan };
}

export function zoomViewport(layout, factor, scrollLeft, viewportWidth) {
  const centerTime = layout.min + (scrollLeft + viewportWidth / 2 - 24) / layout.pxPerMs;
  const view = timelineViewport(layout.fitSpan, layout.visibleSpan * factor, viewportWidth);
  return { ...view, centerTime };
}
