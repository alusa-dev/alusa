export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;
export const ZOOM_SCRUB_SENSITIVITY = 0.0045;

export function clampZoom(zoom: number) {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

/** Right/up increase zoom; left/down decrease zoom. */
export function computeScrubDelta(current: { x: number; y: number }, origin: { x: number; y: number }) {
  return current.x - origin.x - (current.y - origin.y);
}

export function computeScrubZoom(startZoom: number, scrubDelta: number) {
  return clampZoom(startZoom * Math.exp(scrubDelta * ZOOM_SCRUB_SENSITIVITY));
}

export function computePanForZoomAnchor(
  anchor: { x: number; y: number },
  startPan: { x: number; y: number },
  startZoom: number,
  nextZoom: number,
) {
  const worldX = (anchor.x - startPan.x) / startZoom;
  const worldY = (anchor.y - startPan.y) / startZoom;

  return {
    x: anchor.x - worldX * nextZoom,
    y: anchor.y - worldY * nextZoom,
  };
}

export function applyScrubZoom({
  origin,
  current,
  startZoom,
  startPan,
  anchor,
}: {
  origin: { x: number; y: number };
  current: { x: number; y: number };
  startZoom: number;
  startPan: { x: number; y: number };
  anchor: { x: number; y: number };
}) {
  const scrubDelta = computeScrubDelta(current, origin);
  const zoom = computeScrubZoom(startZoom, scrubDelta);
  const pan = computePanForZoomAnchor(anchor, startPan, startZoom, zoom);

  return { zoom, pan, scrubDelta };
}
