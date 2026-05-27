import { MIN_OBJECT_SIZE, isSnapModifierActive } from '@alusa/domain';

import { computeUnionBoundsFromNodes, getNodeBounds } from '../canvas/adapters/konva-snap-adapter';
import type { TransformerScaleOptions } from '../canvas/transform/transform-handle-mode';

import Konva from 'konva';
import type { RefObject } from 'react';
import React from 'react';
import { Transformer } from 'react-konva';

type MapTransformerProps = {
  transformerRef: RefObject<Konva.Transformer | null>;
  disableRotateForMixedSmartCorridorSelection: boolean;
  disableResizeForMixedSmartCorridorSelection: boolean;
  transformerScaleOptions: TransformerScaleOptions;
  selectedTextTransformAnchors: readonly string[];
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  levelBounds: { width: number; height: number } | null;
  selectedNodeIds: string[];
  handleAnchorDragBound: (
    newAbs: { x: number; y: number },
    context: {
      anchor: string;
      contentLayer: Konva.Layer;
      skipIds: string[];
      referenceBox: ReturnType<typeof getNodeBounds>;
      snapDisabled: boolean;
    },
  ) => { x: number; y: number };
};

export function MapTransformer({
  transformerRef,
  disableRotateForMixedSmartCorridorSelection,
  disableResizeForMixedSmartCorridorSelection,
  transformerScaleOptions,
  selectedTextTransformAnchors,
  placementToolActive,
  readOnly,
  tool,
  levelBounds,
  selectedNodeIds,
  handleAnchorDragBound,
}: MapTransformerProps) {
  return (
    <Transformer
      ref={transformerRef as React.Ref<Konva.Transformer>}
      rotateEnabled={!disableRotateForMixedSmartCorridorSelection}
      resizeEnabled={!disableResizeForMixedSmartCorridorSelection}
      keepRatio={transformerScaleOptions.keepRatio}
      centeredScaling={transformerScaleOptions.centeredScaling}
      flipEnabled={false}
      enabledAnchors={disableResizeForMixedSmartCorridorSelection ? [] : [...selectedTextTransformAnchors]}
      listening={!placementToolActive}
      anchorDragBoundFunc={(_oldAbs, newAbs, event) => {
        if (readOnly || tool === 'pan' || tool === 'zoom' || !levelBounds) {
          return newAbs;
        }

        const transformer = transformerRef.current;
        const anchor = transformer?.getActiveAnchor() ?? '';
        if (!anchor || anchor === 'rotater') {
          return newAbs;
        }

        const contentLayer = transformer?.getLayer();
        if (!contentLayer) {
          return newAbs;
        }

        const nodes = transformer?.nodes() ?? [];
        const referenceBox = nodes.length === 1 ? getNodeBounds(nodes[0]) : computeUnionBoundsFromNodes(nodes);

        return handleAnchorDragBound(newAbs, {
          anchor,
          contentLayer,
          skipIds: selectedNodeIds,
          referenceBox,
          snapDisabled: isSnapModifierActive(event),
        });
      }}
      boundBoxFunc={(oldBox, newBox) => {
        if (Math.abs(newBox.width) < MIN_OBJECT_SIZE || Math.abs(newBox.height) < MIN_OBJECT_SIZE) {
          return oldBox;
        }
        return newBox;
      }}
    />
  );
}
