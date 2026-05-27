import { isItemSelected, SNAP_TARGET_NAME, getSeatGroupTightBounds } from '@alusa/domain';
import type { MapSelection, MapSelectionItem } from '@alusa/domain';

import { seatFill } from '../canvas/render/map-object-appearance';
import type { EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';
import { SeatGroupResizeHandles } from './SeatGroupResizeHandles';
import type { SeatGroupResizeStartState } from './SeatGroupResizeHandles';

import Konva from 'konva';
import type { RefObject } from 'react';
import { Circle, Group, Rect, Text } from 'react-konva';

export type SeatGroupNodeProps = {
  group: EventSeatGroupDTO;
  groupSeats: EventSeatDTO[];
  selection: MapSelection;
  zoom: number;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  containerRef: RefObject<HTMLDivElement | null>;
  getPointerPoint: () => { x: number; y: number } | null;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>, item: MapSelectionItem) => void;
  onDoubleClickSelectIndividual: (seatId: string) => void;
  onDragStart: (nodeId: string, item: MapSelectionItem) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => void;
  onTransformEnd: (group: EventSeatGroupDTO, node: Konva.Node) => void;
  onCommitPosition: (x: number, y: number) => void;
  onResizeStart: (state: SeatGroupResizeStartState) => void;
};

export function SeatGroupNode({
  group,
  groupSeats,
  selection,
  zoom,
  placementToolActive,
  readOnly,
  tool,
  containerRef,
  getPointerPoint,
  onSelect,
  onDoubleClickSelectIndividual,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onCommitPosition,
  onResizeStart,
}: SeatGroupNodeProps) {
  const isGroupSelected = isItemSelected(selection, { type: 'seatgroup', id: group.id });
  const stepX = group.seatWidth + group.gapX;
  const stepY = group.seatHeight + group.gapY;
  const bounds = getSeatGroupTightBounds(group, groupSeats);
  const totalX = bounds.x;
  const totalY = bounds.y;
  const totalW = bounds.width;
  const totalH = bounds.height;

  return (
    <Group
      key={group.id}
      id={`node-seatgroup-${group.id}`}
      x={group.x}
      y={group.y}
      scaleX={1}
      scaleY={1}
      rotation={group.rotation}
      name={SNAP_TARGET_NAME}
      listening={!placementToolActive}
      draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && !group.locked}
      onClick={(event) => {
        event.cancelBubble = true;
        onSelect(event, { type: 'seatgroup', id: group.id });
      }}
      onDragStart={() => onDragStart(`node-seatgroup-${group.id}`, { type: 'seatgroup', id: group.id })}
      onDragMove={onDragMove}
      onDragEnd={(event) => onDragEnd(`node-seatgroup-${group.id}`, event, onCommitPosition)}
      onTransformEnd={(event) => onTransformEnd(group, event.target)}
    >
      <Rect
        x={totalX}
        y={totalY}
        width={totalW}
        height={totalH}
        fill={isGroupSelected ? 'rgba(37,99,235,0.06)' : 'transparent'}
        stroke={isGroupSelected ? '#2563eb' : '#7c3aed'}
        strokeWidth={isGroupSelected ? 1.5 : 1}
        strokeScaleEnabled={false}
        dash={isGroupSelected ? undefined : [6, 4]}
        cornerRadius={6}
        listening={false}
      />
      {group.name ? (
        <Text
          x={totalX}
          y={totalY - 18}
          text={group.name}
          fontSize={11}
          fill={isGroupSelected ? '#2563eb' : '#7c3aed'}
          fontStyle="500"
          listening={false}
        />
      ) : null}
      {isGroupSelected && !readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' ? (
        <SeatGroupResizeHandles
          zoom={zoom}
          totalX={totalX}
          totalY={totalY}
          totalW={totalW}
          totalH={totalH}
          groupId={group.id}
          groupRows={group.rows}
          groupColumns={group.columns}
          stepX={stepX}
          stepY={stepY}
          paddingLeft={group.paddingLeft}
          paddingRight={group.paddingRight}
          paddingTop={group.paddingTop}
          paddingBottom={group.paddingBottom}
          gapX={group.gapX}
          gapY={group.gapY}
          containerRef={containerRef}
          getPointerPoint={getPointerPoint}
          onResizeStart={onResizeStart}
        />
      ) : null}
      {groupSeats.map((seat) => {
        const radius = group.seatWidth / 2;
        const rotRad = -((group.rotation ?? 0) * Math.PI) / 180;
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);
        const dx = seat.x - group.x;
        const dy = seat.y - group.y;
        const seatLocalX = dx * cosR - dy * sinR;
        const seatLocalY = dx * sinR + dy * cosR;
        const seatSelected = isItemSelected(selection, { type: 'seat', id: seat.id });

        return (
          <Group
            key={seat.id}
            id={`node-${seat.id}`}
            x={seatLocalX}
            y={seatLocalY}
            listening={!placementToolActive}
            onClick={(event) => {
              event.cancelBubble = true;
              onSelect(event, { type: 'seatgroup', id: group.id });
            }}
            onDblClick={(event) => {
              event.cancelBubble = true;
              onDoubleClickSelectIndividual(seat.id);
            }}
          >
            <Circle
              radius={radius}
              fill={seatFill(seat.status)}
              stroke={isGroupSelected || seatSelected ? '#1d4ed8' : '#ffffff'}
              strokeWidth={isGroupSelected || seatSelected ? 3 : 2}
              strokeScaleEnabled={false}
            />
            <Text
              x={-radius}
              y={-6}
              width={radius * 2}
              align="center"
              text={seat.displayLabel}
              fontSize={Math.max(9, radius * 0.65)}
              fill="#ffffff"
              fontStyle="bold"
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}
