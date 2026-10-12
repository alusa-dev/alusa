'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { clampZoom } from '../canvas/render/zoom-scrub';

type Point = { x: number; y: number };
type View = { pan: Point; zoom: number };
type Gesture = { points: Point[]; view: View };
type PointerInput = Pick<PointerEvent<SVGSVGElement>, 'pointerId' | 'pointerType' | 'clientX' | 'clientY' | 'currentTarget' | 'type'>;

const DRAG_THRESHOLD = 6;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function useMobileMapGestures(enabled: boolean, view: View, onChange: (view: View) => void) {
  const viewRef = useRef(view);
  const onChangeRef = useRef(onChange);
  const points = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef<number | null>(null);

  useLayoutEffect(() => {
    viewRef.current = view;
    onChangeRef.current = onChange;
  }, [view, onChange]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  function rebase() {
    gesture.current = { points: [...points.current.values()], view: viewRef.current };
  }

  function localPoint(event: PointerInput): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function schedule(next: View) {
    viewRef.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onChangeRef.current(viewRef.current);
    });
  }

  function onPointerDown(event: PointerInput) {
    if (points.current.size === 0) suppressClick.current = false;
    if (!enabled || event.pointerType !== 'touch' || !window.matchMedia('(max-width: 1023px)').matches) return false;
    if (points.current.size >= 2) return true;
    points.current.set(event.pointerId, localPoint(event));
    rebase();
    if (points.current.size === 2) {
      suppressClick.current = true;
      for (const id of points.current.keys()) event.currentTarget.setPointerCapture(id);
    }
    return true;
  }

  function onPointerMove(event: PointerInput) {
    if (!points.current.has(event.pointerId)) return false;
    points.current.set(event.pointerId, localPoint(event));
    const start = gesture.current;
    if (!start) return true;
    const current = [...points.current.values()];
    if (current.length === 2 && start.points.length === 2) {
      const initialDistance = distance(start.points[0], start.points[1]);
      if (initialDistance < 1) return true;
      const zoom = clampZoom(start.view.zoom * distance(current[0], current[1]) / initialDistance);
      const anchor = midpoint(start.points[0], start.points[1]);
      const center = midpoint(current[0], current[1]);
      schedule({ zoom, pan: {
        x: center.x - (anchor.x - start.view.pan.x) * zoom / start.view.zoom,
        y: center.y - (anchor.y - start.view.pan.y) * zoom / start.view.zoom,
      } });
    } else if (current.length === 1) {
      if (!suppressClick.current && distance(current[0], start.points[0]) < DRAG_THRESHOLD) return true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      schedule({ zoom: start.view.zoom, pan: {
        x: start.view.pan.x + current[0].x - start.points[0].x,
        y: start.view.pan.y + current[0].y - start.points[0].y,
      } });
    }
    return true;
  }

  function onPointerEnd(event: PointerInput) {
    if (!points.current.delete(event.pointerId)) return false;
    if (event.type === 'pointercancel') suppressClick.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (points.current.size > 0) rebase();
    else gesture.current = null;
    return true;
  }

  function onClickCapture(event: Pick<MouseEvent<SVGSVGElement>, 'detail' | 'preventDefault' | 'stopPropagation'>) {
    if (!suppressClick.current || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return { onPointerDown, onPointerMove, onPointerEnd, onClickCapture };
}
