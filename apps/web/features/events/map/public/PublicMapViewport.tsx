'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { computeArtboardFitView } from '@alusa/domain';
import { clampZoom } from '../canvas/render/zoom-scrub';

type Pan = { x: number; y: number };

type ViewportSize = { width: number; height: number };

const VIEWPORT_HEIGHT_DESKTOP_PX = 520;
const VIEWPORT_HEIGHT_MOBILE_MIN_PX = 280;
const VIEWPORT_HEIGHT_MOBILE_MAX_PX = 400;
const VIEWPORT_SURROUND_FILL = '#e2e8f0';

function resolveViewportHeight() {
  if (typeof window === 'undefined') return VIEWPORT_HEIGHT_DESKTOP_PX;
  const mobile = window.matchMedia('(max-width: 639px)').matches;
  if (!mobile) return VIEWPORT_HEIGHT_DESKTOP_PX;
  return Math.min(
    VIEWPORT_HEIGHT_MOBILE_MAX_PX,
    Math.max(VIEWPORT_HEIGHT_MOBILE_MIN_PX, Math.round(window.innerHeight * 0.36)),
  );
}

function canPanMap({
  artboardWidth,
  artboardHeight,
  zoom,
  viewportWidth,
  viewportHeight,
}: {
  artboardWidth: number;
  artboardHeight: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const scaledWidth = artboardWidth * zoom;
  const scaledHeight = artboardHeight * zoom;
  return scaledWidth > viewportWidth + 1 || scaledHeight > viewportHeight + 1;
}

function isSeatPointerTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('[data-public-seat]'));
}

function computeCenteredArtboardPan({
  artboardWidth,
  artboardHeight,
  zoom,
  viewportWidth,
  viewportHeight,
}: {
  artboardWidth: number;
  artboardHeight: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
}): Pan {
  return {
    x: (viewportWidth - artboardWidth * zoom) / 2,
    y: (viewportHeight - artboardHeight * zoom) / 2,
  };
}

function readContainerViewportSize(
  container: HTMLDivElement | null,
  viewportHeight: number,
): ViewportSize | null {
  const width = Math.floor(container?.clientWidth ?? 0);
  if (width <= 0) return null;
  return { width, height: viewportHeight };
}

function PublicMapZoomBar({
  zoom,
  onZoomOut,
  onZoomIn,
  onFitToView,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitToView: () => void;
}) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-2 sm:bottom-4 sm:left-4 sm:translate-x-0">
      <div className="pointer-events-auto flex h-8 items-center gap-0.5 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg shadow-slate-300/30 backdrop-blur sm:h-9 sm:gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md sm:h-8 sm:w-8"
          onClick={onZoomOut}
          aria-label="Diminuir zoom"
        >
          <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
        <span className="min-w-12 text-center text-[11px] font-medium text-slate-600 sm:min-w-14 sm:text-xs">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md sm:h-8 sm:w-8"
          onClick={onZoomIn}
          aria-label="Aumentar zoom"
        >
          <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg sm:h-9 sm:w-9"
          onClick={onFitToView}
          aria-label="Ajustar zoom para visualizar o mapa inteiro"
        >
          <Maximize2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
      </div>
    </div>
  );
}

export function PublicMapViewport({
  artboardWidth,
  artboardHeight,
  levelId,
  ariaLabel,
  children,
}: {
  artboardWidth: number;
  artboardHeight: number;
  levelId: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const [viewportHeight, setViewportHeight] = useState(resolveViewportHeight);
  const [viewportSize, setViewportSize] = useState<ViewportSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panSessionRef = useRef<{ originX: number; originY: number; startPan: Pan } | null>(null);

  zoomRef.current = zoom;

  const syncViewport = useCallback(
    (recenter = false) => {
      const viewport = readContainerViewportSize(containerRef.current, viewportHeight);
      if (!viewport) return null;
      setViewportSize(viewport);
      if (recenter) {
        setPan(
          computeCenteredArtboardPan({
            artboardWidth,
            artboardHeight,
            zoom: zoomRef.current,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
          }),
        );
      }
      return viewport;
    },
    [artboardHeight, artboardWidth, viewportHeight],
  );

  const applyZoom = useCallback(
    (nextZoom: number) => {
      const viewport = syncViewport(false) ?? readContainerViewportSize(containerRef.current, viewportHeight);
      if (!viewport) return;
      setViewportSize(viewport);
      setZoom(nextZoom);
      setPan(
        computeCenteredArtboardPan({
          artboardWidth,
          artboardHeight,
          zoom: nextZoom,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        }),
      );
    },
    [artboardHeight, artboardWidth, syncViewport, viewportHeight],
  );

  const fitToView = useCallback(() => {
    const viewport = syncViewport(false) ?? readContainerViewportSize(containerRef.current, viewportHeight);
    if (!viewport) return;
    setViewportSize(viewport);
    const fit = computeArtboardFitView({
      artboardWidth,
      artboardHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      padding: 0,
    });
    setZoom(fit.zoom);
    setPan(fit.pan);
  }, [artboardHeight, artboardWidth, syncViewport, viewportHeight]);

  useEffect(() => {
    const updateHeight = () => setViewportHeight(resolveViewportHeight());
    updateHeight();
    window.addEventListener('resize', updateHeight);
    const mq = window.matchMedia('(max-width: 639px)');
    mq.addEventListener('change', updateHeight);
    return () => {
      window.removeEventListener('resize', updateHeight);
      mq.removeEventListener('change', updateHeight);
    };
  }, []);

  useLayoutEffect(() => {
    syncViewport(false);
  }, [syncViewport, viewportHeight]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncViewport(true));
    });

    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [syncViewport]);

  useEffect(() => {
    fitToView();
    const frame = requestAnimationFrame(fitToView);
    return () => cancelAnimationFrame(frame);
  }, [levelId, artboardWidth, artboardHeight, viewportHeight, fitToView]);

  const adjustZoom = useCallback(
    (delta: number) => {
      applyZoom(clampZoom(zoom + delta));
    },
    [applyZoom, zoom],
  );

  const panEnabled = canPanMap({
    artboardWidth,
    artboardHeight,
    zoom,
    viewportWidth: viewportSize?.width ?? 0,
    viewportHeight: viewportSize?.height ?? viewportHeight,
  });

  const cursor = isPanning ? 'grabbing' : panEnabled ? 'grab' : 'default';

  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      applyZoom(clampZoom(zoom * Math.exp(direction * 0.08)));
    },
    [applyZoom, zoom],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 || !panEnabled || isSeatPointerTarget(event.target)) return;

      panSessionRef.current = {
        originX: event.clientX,
        originY: event.clientY,
        startPan: { ...pan },
      };
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [pan, panEnabled],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const session = panSessionRef.current;
    if (!session) return;

    const dx = event.clientX - session.originX;
    const dy = event.clientY - session.originY;
    setPan({
      x: session.startPan.x + dx,
      y: session.startPan.y + dy,
    });
  }, []);

  const endPan = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!panSessionRef.current) return;
    panSessionRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden bg-slate-200"
      style={{ height: viewportHeight }}
    >
      {viewportSize ? (
        <svg
          data-testid="public-event-map-canvas"
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
          className="block h-full w-full touch-none bg-slate-200"
          style={{ cursor }}
          role="img"
          aria-label={ariaLabel}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          <rect x={0} y={0} width={viewportSize.width} height={viewportSize.height} fill={VIEWPORT_SURROUND_FILL} />
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>{children}</g>
        </svg>
      ) : null}
      <PublicMapZoomBar
        zoom={zoom}
        onZoomOut={() => adjustZoom(-0.1)}
        onZoomIn={() => adjustZoom(0.1)}
        onFitToView={fitToView}
      />
    </div>
  );
}
