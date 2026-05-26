import { resolveTransformRouting } from '../transform/transform-routing';

import { describe, expect, it } from 'vitest';

const OBJECTS: any[] = [
  { id: 'c1', type: 'CORRIDOR' as const, levelId: 'l1', x: 0, y: 0, hidden: false },
  { id: 't1', type: 'TEXT' as const, levelId: 'l1', x: 0, y: 0, hidden: false },
  { id: 'r1', type: 'RECT' as const, levelId: 'l1', x: 0, y: 0, hidden: false },
  { id: 'r2', type: 'RECT' as const, levelId: 'l1', x: 10, y: 0, hidden: false },
];

describe('transform-routing', () => {
  it('uses corridor pipeline when corridors are in multi selection without text', () => {
    const routing = resolveTransformRouting({
      selectedNodeCount: 2,
      selectedObjectIds: ['c1', 'r1'],
      objects: OBJECTS,
      mixedTextAndShapes: false,
      selectedTextCount: 0,
      selectionContainsSeatsOrSections: false,
    });

    expect(routing.kind).toBe('corridor');
    expect(routing.transformDisabled).toBe(false);
  });

  it('blocks mixed corridor and text selection', () => {
    const routing = resolveTransformRouting({
      selectedNodeCount: 2,
      selectedObjectIds: ['c1', 't1'],
      objects: OBJECTS,
      mixedTextAndShapes: true,
      selectedTextCount: 1,
      selectionContainsSeatsOrSections: false,
    });

    expect(routing.kind).toBeNull();
    expect(routing.transformDisabled).toBe(true);
    expect(routing.blockedMixedCorridorText).toBe(true);
  });

  it('uses uniform pipeline for mixed text and shapes without corridors', () => {
    const routing = resolveTransformRouting({
      selectedNodeCount: 2,
      selectedObjectIds: ['t1', 'r1'],
      objects: OBJECTS,
      mixedTextAndShapes: true,
      selectedTextCount: 1,
      selectionContainsSeatsOrSections: false,
    });

    expect(routing.kind).toBe('uniform');
  });

  it('uses generic uniform pipeline for multi shape selection', () => {
    const routing = resolveTransformRouting({
      selectedNodeCount: 2,
      selectedObjectIds: ['r1', 'r2'],
      objects: OBJECTS,
      mixedTextAndShapes: false,
      selectedTextCount: 0,
      selectionContainsSeatsOrSections: false,
    });

    expect(routing.kind).toBe('generic');
  });
});
