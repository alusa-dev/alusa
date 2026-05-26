'use client';

import {
  buildLevelRenderStack,
  buildSeatGridPreview,
  getCorridorUnionGroups,
  type MapSelection,
} from '@alusa/domain';
import type { MutableRefObject, RefObject } from 'react';
import { useMemo } from 'react';
import type Konva from 'konva';
import type { EventMapDTO } from '../../api/event-map-service';
import { resolveCorridorObjectsForUnion } from '../corridor/corridor-union-live';
import type { SeatGridDraft } from '../render/map-creation-draft';

export function useMapLevelViewModel({
  map,
  activeLevelId,
  selection,
  seatGridDraft,
  stageRef,
  isCorridorLivePreviewRef,
  isTransformSessionActive,
  corridorVisualRevision,
}: {
  map: EventMapDTO | null;
  activeLevelId: string | null;
  selection: MapSelection;
  seatGridDraft: SeatGridDraft | null;
  stageRef: RefObject<Konva.Stage | null>;
  isCorridorLivePreviewRef: MutableRefObject<boolean>;
  isTransformSessionActive: boolean;
  corridorVisualRevision: number;
}) {
  const level = useMemo(
    () => map?.levels.find((item) => item.id === activeLevelId) ?? map?.levels[0] ?? null,
    [map, activeLevelId],
  );

  const levelBounds = useMemo(
    () => (level ? { width: level.widthPx, height: level.heightPx } : null),
    [level],
  );

  const levelObjects = useMemo(
    () => map?.objects.filter((object) => object.levelId === level?.id && !object.hidden) ?? [],
    [map, level?.id],
  );

  const displayLevelObjects = useMemo(() => {
    const livePreview = isCorridorLivePreviewRef.current || isTransformSessionActive;
    if (!livePreview) return levelObjects;
    return resolveCorridorObjectsForUnion(stageRef.current, levelObjects, true);
  }, [levelObjects, corridorVisualRevision, isTransformSessionActive, isCorridorLivePreviewRef, stageRef]);

  const levelSeats = useMemo(
    () => map?.seats.filter((seat) => seat.levelId === level?.id && seat.publicVisible) ?? [],
    [map, level?.id],
  );

  const levelSeatGroups = useMemo(
    () => map?.seatGroups?.filter((group) => group.levelId === level?.id) ?? [],
    [map, level?.id],
  );

  const corridorUnionGroups = useMemo(() => {
    const corridors = displayLevelObjects.filter((object) => object.type === 'CORRIDOR');
    return getCorridorUnionGroups(corridors, 1);
  }, [displayLevelObjects]);

  const renderStack = useMemo(() => {
    if (!map || !level) return [];
    return buildLevelRenderStack({ ...map, objects: displayLevelObjects }, level.id);
  }, [displayLevelObjects, level, map]);

  const selectedCorridorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selection) {
      if (item.type !== 'object') continue;
      const object = levelObjects.find((entry) => entry.id === item.id);
      if (object?.type === 'CORRIDOR') ids.add(object.id);
    }
    return ids;
  }, [selection, levelObjects]);

  const seatGridPreviewSeats = useMemo(
    () => (seatGridDraft ? buildSeatGridPreview(seatGridDraft.origin, seatGridDraft.config) : []),
    [seatGridDraft],
  );

  return {
    level,
    levelBounds,
    levelObjects,
    displayLevelObjects,
    levelSeats,
    levelSeatGroups,
    corridorUnionGroups,
    renderStack,
    selectedCorridorIds,
    seatGridPreviewSeats,
  };
}
