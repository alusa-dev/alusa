import type { EventMapObjectDTO } from '../../api/event-map-service';

export type MapTransformRoutingKind = 'corridor' | 'uniform' | 'generic' | null;
export type MapTransformSessionKind = Exclude<MapTransformRoutingKind, null>;

export type TransformRoutingInput = {
  selectedNodeCount: number;
  selectedObjectIds: string[];
  objects: EventMapObjectDTO[];
  mixedTextAndShapes: boolean;
  selectedTextCount: number;
  selectionContainsSeatsOrSections: boolean;
};

export type TransformRoutingResult = {
  kind: MapTransformRoutingKind;
  corridorIds: string[];
  /** Block resize/rotate handles entirely. */
  transformDisabled: boolean;
  /** Corridor selected together with text — explicit block. */
  blockedMixedCorridorText: boolean;
};

export function collectCorridorIds(objectIds: string[], objects: EventMapObjectDTO[]) {
  const corridorIds = new Set(
    objects.filter((object) => object.type === 'CORRIDOR').map((object) => object.id),
  );
  return objectIds.filter((id) => corridorIds.has(id));
}

export function resolveTransformRouting(input: TransformRoutingInput): TransformRoutingResult {
  const {
    selectedNodeCount,
    selectedObjectIds,
    objects,
    mixedTextAndShapes,
    selectedTextCount,
    selectionContainsSeatsOrSections,
  } = input;

  const corridorIds = collectCorridorIds(selectedObjectIds, objects);
  const hasCorridor = corridorIds.length > 0;
  const hasText = selectedTextCount > 0;
  const isMulti = selectedNodeCount > 1;

  const blockedMixedCorridorText = isMulti && hasCorridor && hasText;

  if (selectionContainsSeatsOrSections && hasCorridor) {
    return {
      kind: null,
      corridorIds,
      transformDisabled: true,
      blockedMixedCorridorText: false,
    };
  }

  if (blockedMixedCorridorText) {
    return {
      kind: null,
      corridorIds,
      transformDisabled: true,
      blockedMixedCorridorText: true,
    };
  }

  if (!isMulti) {
    return {
      kind: null,
      corridorIds,
      transformDisabled: false,
      blockedMixedCorridorText: false,
    };
  }

  if (hasCorridor) {
    return {
      kind: 'corridor',
      corridorIds,
      transformDisabled: false,
      blockedMixedCorridorText: false,
    };
  }

  if (mixedTextAndShapes || hasText) {
    return {
      kind: 'uniform',
      corridorIds,
      transformDisabled: false,
      blockedMixedCorridorText: false,
    };
  }

  return {
    kind: 'generic',
    corridorIds,
    transformDisabled: false,
    blockedMixedCorridorText: false,
  };
}
