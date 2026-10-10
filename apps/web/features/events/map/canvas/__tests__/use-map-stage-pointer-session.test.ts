import { act, renderHook } from '@testing-library/react';
import type { MapSelection } from '@alusa/domain';
import type Konva from 'konva';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EventMapDTO } from '../../api/event-map-service';
import type { MarqueeDraft } from '../render/map-creation-draft';
import { useMapStagePointerSession } from '../sessions/use-map-stage-pointer-session';

function createMap(): EventMapDTO {
  return {
    id: 'map-selection-pointer-test',
    contaId: 'conta-test',
    eventId: 'event-test',
    event: { id: 'event-test', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'DRAFT', ticketMode: 'SEATED' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1200, heightPx: 800, unit: 'px', scale: null }],
    sections: [],
    objects: [],
    seats: [],
    versions: [],
    document: { schemaVersion: 1, sections: [], visualElements: [] },
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
  };
}

function setupPointerSession(options: {
  selection: MapSelection;
  marqueeItems: MapSelection;
}) {
  let pointer = { x: 10, y: 10 };
  const setSelection = vi.fn();
  const getMarqueeSelection = vi.fn(() => options.marqueeItems);
  const stage = {} as Konva.Stage;
  stage.getStage = () => stage;
  const { result } = renderHook(() => {
    const [marqueeDraft, setMarqueeDraft] = useState<MarqueeDraft | null>(null);
    return useMapStagePointerSession({
      readOnly: false,
      tool: 'select',
      map: createMap(),
      levelId: 'level-1',
      zoom: 1,
      getPointerPoint: () => pointer,
      addObjectAt: vi.fn(() => null),
      addRowAt: vi.fn(),
      addSeatBlockAt: vi.fn(),
      selection: options.selection,
      setSelection,
      setIndividualSeatDragId: vi.fn(),
      getMarqueeSelection,
      openNewTextEditor: vi.fn(),
      creationDraft: null,
      setCreationDraft: vi.fn(),
      marqueeDraft,
      setMarqueeDraft,
    });
  });

  const startMarquee = (
    modifierKey: 'shiftKey' | 'ctrlKey' | 'metaKey' | null,
    start = { x: 10, y: 10 },
    end = { x: 80, y: 80 },
  ) => {
    pointer = start;
    act(() => {
      result.current.handleStageMouseDown({
        target: stage as unknown as Konva.Node,
        evt: {
          shiftKey: modifierKey === 'shiftKey',
          ctrlKey: modifierKey === 'ctrlKey',
          metaKey: modifierKey === 'metaKey',
        },
      } as Parameters<typeof result.current.handleStageMouseDown>[0]);
    });
    pointer = end;
    act(() => {
      result.current.handleStageMouseUp({ evt: {
        shiftKey: modifierKey === 'shiftKey',
        ctrlKey: modifierKey === 'ctrlKey',
        metaKey: modifierKey === 'metaKey',
      } });
    });
  };

  return { startMarquee, setSelection, getMarqueeSelection };
}

describe('useMapStagePointerSession marquee selection', () => {
  it.each(['shiftKey', 'ctrlKey', 'metaKey'] as const)('adds marquee hits to the existing selection when %s is held', (modifierKey) => {
    const existing: MapSelection = [{ type: 'object', id: 'existing-shape' }];
    const additions: MapSelection = [
      { type: 'object', id: 'new-shape' },
      { type: 'object', id: 'existing-shape' },
      { type: 'section', id: 'sector-1' },
    ];
    const { startMarquee, setSelection } = setupPointerSession({ selection: existing, marqueeItems: additions });

    startMarquee(modifierKey);

    expect(setSelection).toHaveBeenCalledOnce();
    expect(setSelection).toHaveBeenCalledWith([
      { type: 'object', id: 'existing-shape' },
      { type: 'object', id: 'new-shape' },
      { type: 'section', id: 'sector-1' },
    ]);
  });

  it('preserves the existing selection when an additive marquee hits nothing', () => {
    const existing: MapSelection = [{ type: 'seatblock', id: 'block-1' }];
    const { startMarquee, setSelection, getMarqueeSelection } = setupPointerSession({ selection: existing, marqueeItems: [] });

    startMarquee('shiftKey');

    expect(getMarqueeSelection).toHaveBeenCalledOnce();
    expect(setSelection).not.toHaveBeenCalled();
  });

  it('clips a marquee whose pointer-up is beyond the artboard edge', () => {
    const selected: MapSelection = [{ type: 'section', id: 'sector-1' }];
    const { startMarquee, setSelection, getMarqueeSelection } = setupPointerSession({ selection: [], marqueeItems: selected });

    startMarquee('shiftKey', { x: 1100, y: 700 }, { x: 1300, y: 900 });

    expect(getMarqueeSelection).toHaveBeenCalledWith({ x: 1100, y: 700, width: 100, height: 100 });
    expect(setSelection).toHaveBeenCalledWith(selected);
  });

  it('clips the marquee start to the artboard when dragging starts outside it', () => {
    const selected: MapSelection = [{ type: 'object', id: 'shape-1' }];
    const { startMarquee, getMarqueeSelection } = setupPointerSession({ selection: [], marqueeItems: selected });

    startMarquee('shiftKey', { x: -40, y: -20 }, { x: 100, y: 120 });

    expect(getMarqueeSelection).toHaveBeenCalledWith({ x: 0, y: 0, width: 100, height: 120 });
  });

  it('replaces the current selection with clipped hits when no modifier is held', () => {
    const selected: MapSelection = [{ type: 'section', id: 'sector-1' }, { type: 'object', id: 'shape-1' }];
    const existing: MapSelection = [{ type: 'object', id: 'old-shape' }];
    const { startMarquee, setSelection } = setupPointerSession({ selection: existing, marqueeItems: selected });

    startMarquee(null, { x: 1100, y: 700 }, { x: 1300, y: 900 });

    expect(setSelection).toHaveBeenCalledWith(selected);
  });

  it('selects the level when a short click lands on empty artboard space', () => {
    const { startMarquee, setSelection } = setupPointerSession({ selection: [{ type: 'object', id: 'shape-1' }], marqueeItems: [] });

    startMarquee(null, { x: 100, y: 100 }, { x: 100, y: 100 });

    expect(setSelection).toHaveBeenCalledWith([{ type: 'level', id: 'level-1' }]);
  });

  it('clears selection when a short click lands outside the artboard', () => {
    const { startMarquee, setSelection } = setupPointerSession({ selection: [{ type: 'object', id: 'shape-1' }], marqueeItems: [] });

    startMarquee(null, { x: 1250, y: 850 }, { x: 1250, y: 850 });

    expect(setSelection).toHaveBeenCalledWith([]);
  });
});
