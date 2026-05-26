import { getSnapReleaseThreshold, getSnapThreshold, isSnapModifierActive, resolveAnchorResizeSnap } from '@alusa/domain';
import type { BoundingBox, LevelBounds } from '@alusa/domain';
import type { SnapGuidesLayerHandle } from '../../components/SnapGuidesLayer';
import { applySnapResult, createSnapGuideStopCache, getSnapLayer, resolveSnapGuides } from '../adapters/konva-snap-adapter';

import { useCallback, useRef, type RefObject } from 'react';
import type Konva from 'konva';

type GroupDragState = {
  anchorNodeId: string;
  origin: Map<string, { x: number; y: number }>;
};

type UseSnapGuidesSessionOptions = {
  enabled: boolean;
  levelBounds: LevelBounds | null;
  zoom: number;
  stageRef: RefObject<Konva.Stage | null>;
  groupDragRef: RefObject<GroupDragState | null>;
  syncGroupDrag: (event: Konva.KonvaEventObject<DragEvent>) => void;
};

function isSnapDisabled(event: Konva.KonvaEventObject<DragEvent>) {
  return isSnapModifierActive(event);
}

function hasActiveGuides(result: { guides: unknown[]; spacingGuides: unknown[] }) {
  return result.guides.length > 0 || result.spacingGuides.length > 0;
}

/**
 * Konva drag positions are controlled imperatively during dragMove.
 * Never store transient guide state in the parent canvas via setState — that re-render
 * resets draggable nodes back to store props and causes guide flicker.
 */
export function useSnapGuidesSession({
  enabled,
  levelBounds,
  zoom,
  stageRef,
  groupDragRef,
  syncGroupDrag,
}: UseSnapGuidesSessionOptions) {
  const guidesLayerRef = useRef<SnapGuidesLayerHandle | null>(null);
  const stopCacheRef = useRef(createSnapGuideStopCache());
  const activeDragSnapRef = useRef(false);

  const clearGuides = useCallback(() => {
    stopCacheRef.current.invalidate();
    activeDragSnapRef.current = false;
    guidesLayerRef.current?.clearGuides();
  }, []);

  const handleDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      if (!enabled || !levelBounds) return;

      if (isSnapDisabled(event)) {
        activeDragSnapRef.current = false;
        guidesLayerRef.current?.clearGuides();
        return;
      }

      const stage = stageRef.current;
      const drag = groupDragRef.current;
      const threshold = activeDragSnapRef.current ? getSnapReleaseThreshold(zoom) : getSnapThreshold(zoom);

      if (drag && drag.origin.size > 1 && stage) {
        if (event.target.id() !== drag.anchorNodeId) return;

        syncGroupDrag(event);

        const nodes = Array.from(drag.origin.keys())
          .map((nodeId) => stage.findOne(`#${nodeId}`))
          .filter((node): node is Konva.Node => Boolean(node));

        const contentLayer = getSnapLayer(nodes[0] ?? event.target);
        if (!contentLayer) return;

        const cached = stopCacheRef.current.get(
          contentLayer,
          nodes.map((node) => node.id()),
          levelBounds,
        );
        const result = resolveSnapGuides(nodes, levelBounds, {
          threshold,
          stops: cached.stops,
          objectBounds: cached.objectBounds,
          targetKind: 'multi',
        });
        applySnapResult(nodes, result);
        activeDragSnapRef.current = hasActiveGuides(result);
        guidesLayerRef.current?.setGuides(result.guides, result.spacingGuides);
        return;
      }

      syncGroupDrag(event);
      const node = event.target;
      const contentLayer = getSnapLayer(node);
      if (!contentLayer) return;

      const cached = stopCacheRef.current.get(contentLayer, [node.id()], levelBounds);
      const result = resolveSnapGuides(node, levelBounds, {
        threshold,
        stops: cached.stops,
        objectBounds: cached.objectBounds,
        targetKind: 'single',
      });
      applySnapResult([node], result);
      activeDragSnapRef.current = hasActiveGuides(result);
      guidesLayerRef.current?.setGuides(result.guides, result.spacingGuides);
    },
    [enabled, groupDragRef, levelBounds, stageRef, syncGroupDrag, zoom],
  );

  const handleAnchorDragBound = useCallback(
    (
      newAbs: { x: number; y: number },
      context: {
        anchor: string;
        contentLayer: Konva.Layer;
        skipIds: string[];
        referenceBox: BoundingBox;
        snapDisabled?: boolean;
      },
    ) => {
      if (!enabled || !levelBounds || context.snapDisabled) {
        return newAbs;
      }

      if (!Number.isFinite(newAbs.x) || !Number.isFinite(newAbs.y)) {
        return newAbs;
      }

      const threshold = getSnapThreshold(zoom);
      const cached = stopCacheRef.current.get(context.contentLayer, context.skipIds, levelBounds);
      const inverse = context.contentLayer.getAbsoluteTransform().copy().invert();
      const layerPos = inverse.point(newAbs);

      if (!Number.isFinite(layerPos.x) || !Number.isFinite(layerPos.y)) {
        return newAbs;
      }

      const result = resolveAnchorResizeSnap({
        layerPos,
        anchor: context.anchor,
        levelBounds,
        objectBounds: cached.objectBounds,
        referenceBox: context.referenceBox,
        threshold,
      });

      guidesLayerRef.current?.setGuides(result.guides, []);
      const snappedAbs = context.contentLayer.getAbsoluteTransform().point(result.layerPos);
      if (!Number.isFinite(snappedAbs.x) || !Number.isFinite(snappedAbs.y)) {
        return newAbs;
      }
      return snappedAbs;
    },
    [enabled, levelBounds, zoom],
  );

  return {
    guidesLayerRef,
    clearGuides,
    handleDragMove,
    handleAnchorDragBound,
  };
}
