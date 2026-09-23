'use client';

import { getTextMode, getTextResizeAnchors, selectionHasMixedTextAndShapes, type LevelBounds, type MapSelectionItem } from '@alusa/domain';
import type { MutableRefObject } from 'react';
import { useMemo } from 'react';
import type { EventMapDTO, EventMapObjectDTO } from '../../api/event-map-service';
import { resolveTransformRouting } from '../transform/transform-routing';

const RESIZE_ANCHORS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'middle-left',
  'middle-right',
  'top-center',
  'bottom-center',
] as const;

export function useMapTransformRouting({
  map,
  levelObjects,
  selectedNodeIds,
  selectedObjectIds,
  selectedSeatIds,
  selectionContainsSeatsOrSections,
  selection,
  levelBounds,
  transformContextRef,
}: {
  map: EventMapDTO | null;
  levelObjects: EventMapObjectDTO[];
  selectedNodeIds: string[];
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectionContainsSeatsOrSections: boolean;
  selection: MapSelectionItem[];
  levelBounds: LevelBounds | null;
  transformContextRef: MutableRefObject<{
    selectedObjectIds: string[];
    selectedSeatIds: string[];
    selectedNodeIds: string[];
    transformKind: ReturnType<typeof resolveTransformRouting>['kind'];
    selectedParametricItem: MapSelectionItem | null;
    selectedParametricItems: Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }>[];
    levelBounds: LevelBounds | null;
  }>;
}) {
  const mixedTextAndShapes = useMemo(() => {
    if (!map || selectedObjectIds.length < 2) return false;
    return selectionHasMixedTextAndShapes(map.objects, selectedObjectIds);
  }, [map, selectedObjectIds]);

  const selectedTextCount = useMemo(() => {
    if (!map || selectedObjectIds.length === 0) return 0;
    return selectedObjectIds.filter((id) =>
      map.objects.some((object) => object.id === id && object.type === 'TEXT'),
    ).length;
  }, [map, selectedObjectIds]);

  const transformRouting = useMemo(
    () =>
      resolveTransformRouting({
        selectedNodeCount: selectedNodeIds.length,
        selectedObjectIds,
        objects: map?.objects ?? [],
        mixedTextAndShapes,
        selectedTextCount,
        selectionContainsSeatsOrSections,
        selectedParametricItem: selection.length > 0 && selection.every((item) => item.type === 'seatblock' || item.type === 'seatrow'),
      }),
    [
      map?.objects,
      mixedTextAndShapes,
      selectedNodeIds.length,
      selectedObjectIds,
      selectedTextCount,
      selectionContainsSeatsOrSections,
      selection,
    ],
  );

  const useUniformGroupTransform = transformRouting.kind === 'uniform';
  const useGenericTransform = transformRouting.kind === 'generic';
  const isSingleSelectionTransform = selectedNodeIds.length <= 1;
  const transformPipelineActive = transformRouting.kind !== null;
  const transformDisabled = transformRouting.transformDisabled;
  transformContextRef.current = {
    selectedObjectIds,
    selectedSeatIds,
    selectedNodeIds,
    transformKind: transformRouting.kind,
    selectedParametricItem: selection.length === 1 && (selection[0]?.type === 'seatblock' || selection[0]?.type === 'seatrow') ? selection[0] : null,
    selectedParametricItems: selection.length > 0 && selection.every((item) => item.type === 'seatblock' || item.type === 'seatrow')
      ? selection as Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }>[]
      : [],
    levelBounds,
  };

  const selectedTextTransformAnchors = useMemo(() => {
    if (selectedObjectIds.length !== 1) return [...RESIZE_ANCHORS];
    const object = levelObjects.find((entry) => entry.id === selectedObjectIds[0]);
    if (!object || object.type !== 'TEXT') return [...RESIZE_ANCHORS];
    return [...getTextResizeAnchors(getTextMode(object))];
  }, [levelObjects, selectedObjectIds]);

  return {
    transformRouting,
    useUniformGroupTransform,
    useGenericTransform,
    isSingleSelectionTransform,
    transformPipelineActive,
    transformDisabled,
    selectedTextTransformAnchors,
  };
}
