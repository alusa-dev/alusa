import { getSeatGroupSeatLocalCenter, getSeatGroupTightBounds, isItemSelected, SNAP_TARGET_NAME } from '@alusa/domain';
import type { MapSelection, MapSelectionItem } from '@alusa/domain';

import { seatFill } from '../canvas/render/map-object-appearance';
import type { EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';

import Konva from 'konva';
import { Circle, Group, Rect, Text } from 'react-konva';

export type SeatGroupNodeProps = {
  group: EventSeatGroupDTO;
  groupSeats: EventSeatDTO[];
  selection: MapSelection;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>, item: MapSelectionItem) => void;
  onDoubleClickSelectIndividual: (seatId: string) => void;
  onDragStart: (nodeId: string, item: MapSelectionItem) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => void;
  onTransformEnd: (group: EventSeatGroupDTO, node: Konva.Node) => void;
  onCommitPosition: (x: number, y: number) => void;
};

export function SeatGroupNode({
  group,
  groupSeats,
  selection,
  placementToolActive,
  readOnly,
  tool,
  onSelect,
  onDoubleClickSelectIndividual,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onCommitPosition,
}: SeatGroupNodeProps) {
  const isGroupSelected = isItemSelected(selection, { type: 'seatgroup', id: group.id });
  const bounds = getSeatGroupTightBounds(group, groupSeats);
  const totalX = bounds.x;
  const totalY = bounds.y;
  const totalW = bounds.width;
  const totalH = bounds.height;

  return (
    <>
      {group.name ? (
        <Text
          x={group.x + totalX}
          y={group.y + totalY - 18}
          rotation={group.rotation}
          text={group.name}
          fontSize={11}
          fill={isGroupSelected ? '#2563eb' : '#7c3aed'}
          fontStyle="500"
          listening={false}
        />
      ) : null}
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
        {!isGroupSelected ? (
          <Rect
            x={totalX}
            y={totalY}
            width={totalW}
            height={totalH}
            fill="transparent"
            stroke="#7c3aed"
            strokeWidth={1}
            strokeScaleEnabled={false}
            dash={[6, 4]}
            cornerRadius={6}
            listening={false}
          />
        ) : null}
        {groupSeats.map((seat) => {
          const radius = group.seatWidth / 2;
          const { x: seatLocalX, y: seatLocalY } = getSeatGroupSeatLocalCenter(group, seat);
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
    </>
  );
}
