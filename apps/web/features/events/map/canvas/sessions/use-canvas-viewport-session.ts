'use client';

import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { applyScrubZoom, computePanForZoomAnchor, computeScrubDelta, clampZoom } from '../zoom-scrub';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';

type ViewportSize = {
  width: number;
  height: number;
};

type Pan = {
  x: number;
  y: number;
};

type ZoomScrubState = {
  origin: { x: number; y: number };
  anchor: { x: number; y: number };
  startZoom: number;
  startPan: Pan;
};

export function useCanvasViewportSize({
  containerRef,
  setViewportSize,
  initialSize = { width: 1200, height: 800 },
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  setViewportSize: (size: ViewportSize) => void;
  initialSize?: ViewportSize;
}) {
  const [size, setSize] = useState(initialSize);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextSize = {
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(320, Math.floor(entry.contentRect.height)),
      };
      setSize(nextSize);
      setViewportSize(nextSize);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, setViewportSize]);

  return size;
}

export function useZoomScrubSession({
  enabled,
  containerRef,
  stageRef,
  setZoom,
  setPan,
}: {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<Konva.Stage | null>;
  setZoom: (zoom: number) => void;
  setPan: (pan: Pan) => void;
}) {
  const zoomScrubRef = useRef<ZoomScrubState | null>(null);
  const [isZoomScrubbing, setIsZoomScrubbing] = useState(false);

  useEffect(() => {
    if (!enabled) {
      zoomScrubRef.current = null;
      setIsZoomScrubbing(false);
      return;
    }

    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;

    function onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return;

      const rect = stage!.container().getBoundingClientRect();
      const { zoom: startZoom, pan: startPan } = useEventMapEditorStore.getState();

      zoomScrubRef.current = {
        origin: { x: event.clientX, y: event.clientY },
        anchor: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        startZoom,
        startPan: { ...startPan },
      };
      setIsZoomScrubbing(true);
      event.preventDefault();
    }

    function onMouseMove(event: MouseEvent) {
      const drag = zoomScrubRef.current;
      if (!drag) return;

      const scrubDelta = computeScrubDelta(
        { x: event.clientX, y: event.clientY },
        drag.origin,
      );
      if (Math.abs(scrubDelta) > 2) {
        useEventMapEditorStore.getState().markZoomScrubbedThisHold();
      }

      const result = applyScrubZoom({
        origin: drag.origin,
        current: { x: event.clientX, y: event.clientY },
        startZoom: drag.startZoom,
        startPan: drag.startPan,
        anchor: drag.anchor,
      });

      setZoom(result.zoom);
      setPan(result.pan);
    }

    function endScrub(event: MouseEvent) {
      const drag = zoomScrubRef.current;
      if (drag) {
        const scrubDelta = computeScrubDelta(
          { x: event.clientX, y: event.clientY },
          drag.origin,
        );
        if (Math.abs(scrubDelta) > 2) {
          useEventMapEditorStore.getState().restoreTemporaryZoomTool();
        }
      }
      zoomScrubRef.current = null;
      setIsZoomScrubbing(false);
    }

    container.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endScrub);

    return () => {
      container.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', endScrub);
    };
  }, [containerRef, enabled, setPan, setZoom, stageRef]);

  return isZoomScrubbing;
}

export function computeWheelZoom({
  anchor,
  pan,
  zoom,
  direction,
}: {
  anchor: { x: number; y: number };
  pan: Pan;
  zoom: number;
  direction: 1 | -1;
}) {
  const nextZoom = clampZoom(zoom * Math.exp(direction * 0.08));
  return {
    zoom: nextZoom,
    pan: computePanForZoomAnchor(anchor, pan, zoom, nextZoom),
  };
}
