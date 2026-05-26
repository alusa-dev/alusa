import { isItemSelected, SNAP_TARGET_NAME } from '@alusa/domain';
import type { MapSelection, MapSelectionItem } from '@alusa/domain';

import { seatFill } from '../canvas/render/map-object-appearance';
import type { EventSeatDTO } from '../api/event-map-service';

import Konva from 'konva';
import { Circle, Group, Text } from 'react-konva';

export type LooseSeatNodeProps = {
  seat: EventSeatDTO;
  selection: MapSelection;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>, item: MapSelectionItem) => void;
  onDoubleClickSelectIndividual: (seatId: string) => void;
  onDragStart: (nodeId: string, item: MapSelectionItem) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => void;
  onCommitPosition: (x: number, y: number) => void;
};

export function LooseSeatNode({
  seat,
  selection,
  placementToolActive,
  readOnly,
  tool,
  onSelect,
  onDoubleClickSelectIndividual,
  onDragStart,
  onDragMove,
  onDragEnd,
  onCommitPosition,
}: LooseSeatNodeProps) {
  const selected = isItemSelected(selection, { type: 'seat', id: seat.id });
  const radius = (seat.size ?? 24) / 2;

  return (
    <Group
      key={seat.id}
      id={`node-${seat.id}`}
      x={seat.x}
      y={seat.y}
      rotation={seat.rotation}
      name={SNAP_TARGET_NAME}
      listening={!placementToolActive}
      draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && seat.status !== 'SOLD'}
      onClick={(event) => onSelect(event, { type: 'seat', id: seat.id })}
      onDblClick={(event) => {
        event.cancelBubble = true;
        onDoubleClickSelectIndividual(seat.id);
      }}
      onDragStart={() => onDragStart(`node-${seat.id}`, { type: 'seat', id: seat.id })}
      onDragMove={onDragMove}
      onDragEnd={(event) => onDragEnd(`node-${seat.id}`, event, onCommitPosition)}
    >
      <Circle radius={radius} fill={seatFill(seat.status)} stroke={selected ? '#1d4ed8' : '#ffffff'} strokeWidth={selected ? 4 : 2} />
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
}
