'use client';

import {
  buildLevelRenderStack,
  buildSeatBlockPreview,
} from '@alusa/domain';
import { useMemo } from 'react';
import type { EventMapDTO } from '../../api/event-map-service';
import type { SeatBlockDraft } from '../render/map-creation-draft';

export function useMapLevelViewModel({
  map,
  activeLevelId,
  seatBlockDraft,
}: {
  map: EventMapDTO | null;
  activeLevelId: string | null;
  seatBlockDraft: SeatBlockDraft | null;
}) {
  const level = useMemo(
    () => map?.levels.find((item) => item.id === activeLevelId) ?? map?.levels[0] ?? null,
    [map, activeLevelId],
  );

  const levelBounds = useMemo(
    () => (level ? { width: level.widthPx, height: level.heightPx } : null),
    [level],
  );

  const hiddenSectionIds = useMemo(
    () => new Set([
      ...(map?.document?.sections.filter((section) => section.hidden).map((section) => section.id) ?? []),
      ...(map?.sections.filter((section) => section.hidden).map((section) => section.id) ?? []),
    ]),
    [map?.document, map?.sections],
  );

  const levelObjects = useMemo(
    () => map?.objects.filter((object) => object.levelId === level?.id && !object.hidden && !(object.sectionId && hiddenSectionIds.has(object.sectionId))) ?? [],
    [hiddenSectionIds, map, level?.id],
  );

  const displayLevelObjects = levelObjects;

  const levelSeats = useMemo(
    () => map?.seats.filter((seat) => seat.levelId === level?.id && seat.publicVisible && !hiddenSectionIds.has(seat.sectionId)) ?? [],
    [hiddenSectionIds, map, level?.id],
  );

  const renderStack = useMemo(() => {
    if (!map || !level) return [];
    return buildLevelRenderStack({ ...map, objects: displayLevelObjects }, level.id);
  }, [displayLevelObjects, level, map]);

  const seatBlockPreviewSeats = useMemo(
    () => (seatBlockDraft ? buildSeatBlockPreview(seatBlockDraft.origin, seatBlockDraft.config) : []),
    [seatBlockDraft],
  );

  return {
    level,
    levelBounds,
    levelObjects,
    displayLevelObjects,
    levelSeats,
    renderStack,
    seatBlockPreviewSeats,
  };
}
