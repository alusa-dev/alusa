import { SEAT_GRID_SECTION_PADDING, getSeatGridPreviewBounds } from '@alusa/domain';
import type { SeatGridPreviewSeat } from '@alusa/domain';

import type { SeatGridDraft } from '../canvas/render/map-creation-draft';

import { Circle, Group, Rect, Text } from 'react-konva';

export function SeatGridPreviewLayer({
  seatGridDraft,
  seatGridPreviewSeats,
}: {
  seatGridDraft: SeatGridDraft | null;
  seatGridPreviewSeats: SeatGridPreviewSeat[];
}) {
  if (!seatGridDraft || seatGridPreviewSeats.length === 0) return null;

  const bounds = getSeatGridPreviewBounds(seatGridPreviewSeats, SEAT_GRID_SECTION_PADDING);

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
      {seatGridPreviewSeats.map((seat) => {
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
