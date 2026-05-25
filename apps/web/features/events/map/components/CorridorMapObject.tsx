'use client';
import { SNAP_TARGET_NAME, shouldRenderIndividualCorridorBody } from '@alusa/domain';
import type { CorridorUnionGroup, MapSelectionItem } from '@alusa/domain';
import { getCorridorCanvasAppearance } from '../canvas/corridor-canvas';
import type { EventMapObjectDTO } from '../api/event-map-service';

import { memo } from 'react';
import Konva from 'konva';
import { Group, Rect } from 'react-konva';

type CorridorMapObjectProps = {
  object: EventMapObjectDTO;
  width: number;
  height: number;
  selected: boolean;
  isSiblingOfSelected: boolean;
  renderIndividualCorridorBody: boolean;
  corridorUnionGroups: CorridorUnionGroup[];
  activeUnionDragIds: Set<string>;
  /** When true, skip React-controlled geometry so Konva imperative updates are not overwritten. */
  freezeFromReact: boolean;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: () => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (event: Konva.KonvaEventObject<Event>) => void;
};

function CorridorMapObjectComponent({
  object,
  width,
  height,
  selected,
  isSiblingOfSelected,
  renderIndividualCorridorBody,
  freezeFromReact,
  placementToolActive,
  readOnly,
  tool,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}: CorridorMapObjectProps) {
  const corridorAppearance = getCorridorCanvasAppearance(selected, isSiblingOfSelected);

  const geometryProps = freezeFromReact
    ? {}
    : {
        x: object.x,
        y: object.y,
        rotation: object.rotation,
      };

  return (
    <Group
      key={object.id}
      id={`node-${object.id}`}
      scaleX={1}
      scaleY={1}
      offsetX={0}
      offsetY={0}
      {...geometryProps}
      name={SNAP_TARGET_NAME}
      listening={!placementToolActive}
      draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && !object.locked}
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    >
      <Rect
        name="corridor-body"
        width={freezeFromReact ? undefined : width}
        height={freezeFromReact ? undefined : height}
        cornerRadius={0}
        fill={renderIndividualCorridorBody ? corridorAppearance.fill : 'transparent'}
        opacity={1}
        stroke={renderIndividualCorridorBody ? corridorAppearance.stroke : undefined}
        strokeWidth={renderIndividualCorridorBody ? corridorAppearance.strokeWidth : 0}
        strokeScaleEnabled={false}
        dash={renderIndividualCorridorBody ? corridorAppearance.dash : undefined}
        hitStrokeWidth={12}
      />
    </Group>
  );
}

export const CorridorMapObject = memo(
  CorridorMapObjectComponent,
  (prev, next) => {
    if (next.freezeFromReact && prev.object.id === next.object.id) {
      return (
        prev.freezeFromReact === next.freezeFromReact &&
        prev.selected === next.selected &&
        prev.renderIndividualCorridorBody === next.renderIndividualCorridorBody &&
        prev.isSiblingOfSelected === next.isSiblingOfSelected
      );
    }
    return false;
  },
);

export function buildCorridorMapObjectProps(
  object: EventMapObjectDTO,
  context: {
    selection: MapSelectionItem[];
    levelObjects: EventMapObjectDTO[];
    selectedCorridorIds: Set<string>;
    corridorUnionGroups: CorridorUnionGroup[];
    activeUnionDragIds: Set<string>;
    isObjectSelected: (object: EventMapObjectDTO) => boolean;
  },
) {
  const selected = context.isObjectSelected(object);
  const renderIndividualCorridorBody = shouldRenderIndividualCorridorBody({
    objectId: object.id,
    selected,
    dragging: context.activeUnionDragIds.has(object.id),
    groups: context.corridorUnionGroups,
  });
  const isSiblingOfSelected =
    !selected &&
    context.corridorUnionGroups.some(
      (group) =>
        group.objectIds.includes(object.id) &&
        group.objectIds.some((id) => context.selectedCorridorIds.has(id)),
    );

  return {
    object,
    width: object.width ?? 32,
    height: object.height ?? 280,
    selected,
    isSiblingOfSelected,
    renderIndividualCorridorBody,
    corridorUnionGroups: context.corridorUnionGroups,
    activeUnionDragIds: context.activeUnionDragIds,
  };
}
