import { SEAT_BLOCK_SECTION_PADDING, getSeatBlockPreviewBounds } from '@alusa/domain';
import type { SeatBlockPreviewSeat } from '@alusa/domain';

import type { SeatBlockDraft } from '../canvas/render/map-creation-draft';

import { Circle, Group, Rect, Text } from 'react-konva';

export function SeatBlockPreviewLayer({
  seatBlockDraft,
  seatBlockPreviewSeats,
}: {
  seatBlockDraft: SeatBlockDraft | null;
  seatBlockPreviewSeats: SeatBlockPreviewSeat[];
}) {
  if (!seatBlockDraft) return null;

  const bounds = getSeatBlockPreviewBounds(seatBlockPreviewSeats, SEAT_BLOCK_SECTION_PADDING);

  return (
    <Group listening={false}>
      {bounds ? (
        <Rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          cornerRadius={10}
          fill="rgba(124, 58, 237, 0.05)"
          stroke="#7c3aed"
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[6, 6]}
        />
      ) : null}
      {seatBlockPreviewSeats.map((seat) => {
        const radius = seat.size / 2;
        return (
          <Group key={`${seat.rowIndex}-${seat.columnIndex}`} x={seat.x} y={seat.y} opacity={0.78}>
            <Circle radius={radius} fill="#7c3aed" stroke="#ffffff" strokeWidth={2} strokeScaleEnabled={false} />
            <Text
              x={-radius}
              y={-6}
              width={radius * 2}
              align="center"
              text={seat.displayLabel}
              fontSize={Math.max(8, radius * 0.55)}
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
