export function computeArtboardFitView({
  artboardWidth,
  artboardHeight,
  viewportWidth,
  viewportHeight,
  padding = 48,
  minZoom = 0.25,
  maxZoom = 2.5,
}: {
  artboardWidth: number;
  artboardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}) {
  if (artboardWidth <= 0 || artboardHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { zoom: 1, pan: { x: 80, y: 80 } };
  }

  const availableWidth = Math.max(viewportWidth - padding * 2, 1);
  const availableHeight = Math.max(viewportHeight - padding * 2, 1);
  const zoom = Math.min(availableWidth / artboardWidth, availableHeight / artboardHeight);
  const clampedZoom = Math.min(Math.max(zoom, minZoom), maxZoom);

  return {
    zoom: clampedZoom,
    pan: {
      x: (viewportWidth - artboardWidth * clampedZoom) / 2,
      y: (viewportHeight - artboardHeight * clampedZoom) / 2,
    },
  };
}
