import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileMapGestures } from '@/features/events/map/public/use-mobile-map-gestures';

function setup(enabled = true) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(svg, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  });
  const change = vi.fn();
  const hook = renderHook(() => useMobileMapGestures(enabled, { pan: { x: 0, y: 0 }, zoom: 1 }, change));
  const pointer = (id: number, x: number, y: number, type = 'pointermove', pointerType = 'touch') => ({
    pointerId: id, clientX: x, clientY: y, pointerType, type, currentTarget: svg,
  });
  const click = () => {
    const event = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    hook.result.current.onClickCapture(event);
    return event;
  };
  const flush = () => act(() => { vi.advanceTimersByTime(20); });
  return { ...hook, pointer, click, flush, change };
}

describe('mobile public map gestures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('keeps small movements as a tap, without changing the view or blocking seat selection', () => {
    const h = setup();
    h.result.current.onPointerDown(h.pointer(1, 100, 100, 'pointerdown'));
    h.result.current.onPointerMove(h.pointer(1, 102, 102));
    h.result.current.onPointerEnd(h.pointer(1, 102, 102, 'pointerup'));
    h.flush();
    expect(h.change).not.toHaveBeenCalled();
    expect(h.click().preventDefault).not.toHaveBeenCalled();
  });

  it('batches dragging by frame and prevents the resulting click from selecting a seat', () => {
    const h = setup();
    h.result.current.onPointerDown(h.pointer(1, 100, 100, 'pointerdown'));
    h.result.current.onPointerMove(h.pointer(1, 110, 110));
    h.result.current.onPointerMove(h.pointer(1, 120, 130));
    h.flush();
    expect(h.change).toHaveBeenCalledTimes(1);
    expect(h.change).toHaveBeenLastCalledWith({ pan: { x: 20, y: 30 }, zoom: 1 });
    h.result.current.onPointerEnd(h.pointer(1, 120, 130, 'pointerup'));
    expect(h.click().preventDefault).toHaveBeenCalled();
    h.result.current.onPointerDown(h.pointer(2, 100, 100, 'pointerdown'));
    expect(h.click().preventDefault).not.toHaveBeenCalled();
  });

  it('anchors pinch zoom to the fingers and continues dragging with the remaining finger without a jump', () => {
    const h = setup();
    h.result.current.onPointerDown(h.pointer(1, 100, 100, 'pointerdown'));
    h.result.current.onPointerDown(h.pointer(2, 200, 100, 'pointerdown'));
    h.result.current.onPointerMove(h.pointer(2, 300, 100));
    h.flush();
    expect(h.change).toHaveBeenLastCalledWith({ pan: { x: -100, y: -100 }, zoom: 2 });
    h.result.current.onPointerEnd(h.pointer(2, 300, 100, 'pointerup'));
    h.result.current.onPointerMove(h.pointer(1, 120, 110));
    h.flush();
    expect(h.change).toHaveBeenLastCalledWith({ pan: { x: -80, y: -90 }, zoom: 2 });
  });

  it('respects both zoom limits', () => {
    const h = setup();
    h.result.current.onPointerDown(h.pointer(1, 100, 100, 'pointerdown'));
    h.result.current.onPointerDown(h.pointer(2, 200, 100, 'pointerdown'));
    h.result.current.onPointerMove(h.pointer(2, 1000, 100));
    h.flush();
    expect(h.change.mock.lastCall?.[0].zoom).toBe(2.5);
    h.result.current.onPointerMove(h.pointer(2, 101, 100));
    h.flush();
    expect(h.change.mock.lastCall?.[0].zoom).toBe(0.25);
  });

  it('leaves desktop, mouse interaction and other map consumers unchanged', () => {
    const h = setup();
    expect(h.result.current.onPointerDown(h.pointer(1, 0, 0, 'pointerdown', 'mouse'))).toBe(false);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    expect(h.result.current.onPointerDown(h.pointer(1, 0, 0, 'pointerdown'))).toBe(false);
    const disabled = setup(false);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    expect(disabled.result.current.onPointerDown(disabled.pointer(1, 0, 0, 'pointerdown'))).toBe(false);
  });

  it('cancels a gesture safely and cancels the queued animation when unmounted', () => {
    const h = setup();
    h.result.current.onPointerDown(h.pointer(1, 100, 100, 'pointerdown'));
    h.result.current.onPointerMove(h.pointer(1, 120, 100));
    h.result.current.onPointerEnd(h.pointer(1, 120, 100, 'pointercancel'));
    expect(h.click().preventDefault).toHaveBeenCalled();
    expect(h.result.current.onPointerMove(h.pointer(1, 150, 100))).toBe(false);
    h.unmount();
    h.flush();
    expect(h.change).not.toHaveBeenCalled();
  });
});
