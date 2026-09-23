import { resolveTransformRouting } from '../transform/transform-routing';

import { describe, expect, it } from 'vitest';

const OBJECTS: any[] = [
  { id: 'shape1', type: 'RECT' as const, levelId: 'l1', x: 0, y: 0, hidden: false },
  { id: 't1', type: 'TEXT' as const, levelId: 'l1', x: 0, y: 0, hidden: false },
  { id: 'r1', type: 'RECT' as const, levelId: 'l1', x: 0, y: 0, hidden: false },
  { id: 'r2', type: 'RECT' as const, levelId: 'l1', x: 10, y: 0, hidden: false },
];

describe('transform-routing', () => {
  it('uses the generic pipeline for any multi-object selection', () => {
    const routing = resolveTransformRouting({
      selectedNodeCount: 2,
      selectedObjectIds: ['shape1', 'r1'],
      objects: OBJECTS,
      mixedTextAndShapes: false,
      selectedTextCount: 0,
      selectionContainsSeatsOrSections: false,
    });

    expect(routing.kind).toBe('generic');
    expect(routing.transformDisabled).toBe(false);
  });

  it('uses the uniform pipeline for mixed text and shapes', () => {
    const routing = resolveTransformRouting({
      selectedNodeCount: 2,
      selectedObjectIds: ['shape1', 't1'],
      objects: OBJECTS,
      mixedTextAndShapes: true,
      selectedTextCount: 1,
      selectionContainsSeatsOrSections: false,
    });

    expect(routing.kind).toBe('uniform');
    expect(routing.transformDisabled).toBe(false);
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

  it('keeps mixed seat and section selections generic', () => {
    const routing = resolveTransformRouting({
      selectedNodeCount: 3,
      selectedObjectIds: ['shape1', 'r1'],
      objects: OBJECTS,
      mixedTextAndShapes: false,
      selectedTextCount: 0,
      selectionContainsSeatsOrSections: true,
    });

    expect(routing.kind).toBe('generic');
    expect(routing.transformDisabled).toBe(false);
  });
});
