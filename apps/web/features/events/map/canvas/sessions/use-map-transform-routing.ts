'use client';

import { getTextMode, getTextResizeAnchors, selectionHasMixedTextAndShapes, type LevelBounds } from '@alusa/domain';
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
  selectedSeatGroupIds,
  selectionContainsSeatsOrSections,
  levelBounds,
  transformContextRef,
}: {
  map: EventMapDTO | null;
  levelObjects: EventMapObjectDTO[];
  selectedNodeIds: string[];
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectedSeatGroupIds: string[];
  selectionContainsSeatsOrSections: boolean;
  levelBounds: LevelBounds | null;
  transformContextRef: MutableRefObject<{
    selectedObjectIds: string[];
    selectedSeatIds: string[];
    selectedSeatGroupIds: string[];
    selectedNodeIds: string[];
    transformKind: ReturnType<typeof resolveTransformRouting>['kind'];
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
      }),
    [
      map?.objects,
      mixedTextAndShapes,
      selectedNodeIds.length,
      selectedObjectIds,
      selectedTextCount,
      selectionContainsSeatsOrSections,
    ],
  );

  const useUniformGroupTransform = transformRouting.kind === 'uniform';
  const useCorridorTransformerPipeline = transformRouting.kind === 'corridor';
  const useGenericTransform = transformRouting.kind === 'generic';
  const isSingleSelectionTransform = selectedNodeIds.length <= 1;
  const transformPipelineActive = transformRouting.kind !== null;
  const disableResizeForMixedSmartCorridorSelection = transformRouting.transformDisabled;
  const disableRotateForMixedSmartCorridorSelection = transformRouting.transformDisabled;

  transformContextRef.current = {
    selectedObjectIds,
    selectedSeatIds,
    selectedSeatGroupIds,
    selectedNodeIds,
    transformKind: transformRouting.kind,
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
    useCorridorTransformerPipeline,
    useGenericTransform,
    isSingleSelectionTransform,
    transformPipelineActive,
    disableResizeForMixedSmartCorridorSelection,
    disableRotateForMixedSmartCorridorSelection,
    selectedTextTransformAnchors,
  };
}
