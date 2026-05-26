import { SNAP_TARGET_NAME } from '@alusa/domain';
import type { MapSelectionItem } from '@alusa/domain';

import { getObjectAppearance } from '../canvas/render/map-object-appearance';
import type { EventMapObjectDTO } from '../api/event-map-service';

import Konva from 'konva';
import { Ellipse, Group, Rect, RegularPolygon } from 'react-konva';

export type ShapeMapObjectNodeProps = {
  object: EventMapObjectDTO;
  selected: boolean;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  isSingleSelectionTransform: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>, item: MapSelectionItem) => void;
  onDragStart: (nodeId: string, item: MapSelectionItem) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => void;
  onTransformEnd: (object: EventMapObjectDTO, node: Konva.Node) => void;
  onCommitPosition: (x: number, y: number) => void;
};

export function ShapeMapObjectNode({
  object,
  selected,
  placementToolActive,
  readOnly,
  tool,
  isSingleSelectionTransform,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onCommitPosition,
}: ShapeMapObjectNodeProps) {
  const appearance = getObjectAppearance(object);
  const width = object.width ?? 180;
  const height = object.height ?? 90;
  const shape = typeof object.data.shape === 'string' ? object.data.shape : null;
  const opacity = Number(object.data.opacity ?? (object.type === 'SECTION' ? 0.15 : 1));
  const cornerRadius = Number(object.data.cornerRadius ?? (object.type === 'TABLE' ? 999 : shape ? 0 : 8));
  const selectionItem: MapSelectionItem =
    object.sectionId ? { type: 'section', id: object.sectionId } : { type: 'object', id: object.id };

  return (
    <Group
      key={object.id}
      id={`node-${object.id}`}
      x={object.x}
      y={object.y}
      scaleX={1}
      scaleY={1}
      rotation={object.rotation}
      offsetX={0}
      offsetY={0}
      name={SNAP_TARGET_NAME}
      listening={!placementToolActive}
      draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && !object.locked}
      onClick={(event) => onSelect(event, selectionItem)}
      onDragStart={() => onDragStart(`node-${object.id}`, selectionItem)}
      onDragMove={onDragMove}
      onDragEnd={(event) => onDragEnd(`node-${object.id}`, event, onCommitPosition)}
      onTransformEnd={(event) => {
        if (isSingleSelectionTransform) onTransformEnd(object, event.target);
      }}
    >
      {shape === 'circle' || shape === 'ellipse' ? (
        <Ellipse
          x={width / 2}
          y={height / 2}
          radiusX={width / 2}
          radiusY={height / 2}
          fill={appearance.fill}
          opacity={opacity}
          stroke={appearance.stroke}
          strokeWidth={appearance.strokeWidth}
          strokeScaleEnabled={false}
          dash={appearance.dash}
        />
      ) : shape === 'triangle' ? (
        <RegularPolygon
          x={width / 2}
          y={height / 2}
          sides={3}
          radius={Math.min(width, height) / 2}
          fill={appearance.fill}
          opacity={opacity}
          stroke={appearance.stroke}
          strokeWidth={appearance.strokeWidth}
          strokeScaleEnabled={false}
          dash={appearance.dash}
          rotation={30}
        />
      ) : (
        <Rect
          width={width}
          height={height}
          cornerRadius={cornerRadius}
          fill={appearance.fill}
          opacity={opacity}
          stroke={appearance.stroke}
          strokeWidth={appearance.strokeWidth}
          strokeScaleEnabled={false}
          dash={appearance.dash}
        />
      )}
      {selected ? (
        <Rect
          width={width}
          height={height}
          fill="transparent"
          stroke="#2563eb"
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          dash={[4, 4]}
          listening={false}
        />
      ) : null}
    </Group>
  );
}
