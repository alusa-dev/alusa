import { act, renderHook } from '@testing-library/react';
import type { MapSelection } from '@alusa/domain';
import type Konva from 'konva';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MapTransformSession } from '../transform/map-transform-session';
import type { TransformNodeSnapshot } from '../adapters/konva-transform-adapter';
import { useKeyboardSession } from '../sessions/use-keyboard-session';

function setupKeyboardSession(selection: MapSelection, isTransformSessionActive = false) {
  const setSelection = vi.fn();
  renderHook(() => useKeyboardSession({
    stageRef: { current: null } as RefObject<Konva.Stage | null>,
    transformerRef: { current: null } as RefObject<Konva.Transformer | null>,
    transformContextRef: { current: { selectedNodeIds: [], transformKind: null } },
    isTransformSessionActive,
    mapTransformSessionRef: { current: null as MapTransformSession | null },
    transformCancelSnapshotsRef: { current: [] as TransformNodeSnapshot[] },
    transformCancelledRef: { current: false },
    setIsTransformSessionActive: vi.fn(),
    setTransformerScaleOptions: vi.fn(),
    selection,
    setSelection,
  }));
  return setSelection;
}

describe('useKeyboardSession selection clearing', () => {
  it('clears the full selection on Escape', () => {
    const setSelection = setupKeyboardSession([
      { type: 'object', id: 'shape-1' },
      { type: 'section', id: 'sector-1' },
    ]);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    act(() => window.dispatchEvent(event));

    expect(setSelection).toHaveBeenCalledWith([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not clear selection while a transform session is active', () => {
    const setSelection = setupKeyboardSession([{ type: 'object', id: 'shape-1' }], true);

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(setSelection).not.toHaveBeenCalled();
  });

  it('leaves selection unchanged when Escape is pressed in an input', () => {
    const setSelection = setupKeyboardSession([{ type: 'object', id: 'shape-1' }]);
    const input = document.createElement('input');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.append(input);

    act(() => input.dispatchEvent(event));

    expect(setSelection).not.toHaveBeenCalled();
    input.remove();
  });
});
