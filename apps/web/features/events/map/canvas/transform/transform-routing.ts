import type { EventMapObjectDTO } from '../../api/event-map-service';

export type MapTransformRoutingKind = 'uniform' | 'generic' | 'parametric' | null;
export type MapTransformSessionKind = Exclude<MapTransformRoutingKind, null>;

export type TransformRoutingInput = {
  selectedNodeCount: number;
  selectedObjectIds: string[];
  objects: EventMapObjectDTO[];
  mixedTextAndShapes: boolean;
  selectedTextCount: number;
  selectionContainsSeatsOrSections: boolean;
  selectedParametricItem?: boolean;
};

export type TransformRoutingResult = {
  kind: MapTransformRoutingKind;
  transformDisabled: boolean;
};

export function resolveTransformRouting(input: TransformRoutingInput): TransformRoutingResult {
  const {
    selectedNodeCount,
    mixedTextAndShapes,
    selectedTextCount,
    selectionContainsSeatsOrSections,
    selectedParametricItem,
  } = input;

  const hasText = selectedTextCount > 0;
  const isMulti = selectedNodeCount > 1;

  if (selectedParametricItem && selectedNodeCount > 0) {
    return { kind: 'parametric', transformDisabled: false };
  }

  if (!isMulti) {
    if (selectedNodeCount > 0 && selectionContainsSeatsOrSections) {
      return {
        kind: 'generic',
        transformDisabled: false,
      };
    }

    return {
      kind: null,
      transformDisabled: false,
    };
  }

  if (mixedTextAndShapes || hasText) {
    return {
      kind: 'uniform',
      transformDisabled: false,
    };
  }

  return {
    kind: 'generic',
    transformDisabled: false,
  };
}
