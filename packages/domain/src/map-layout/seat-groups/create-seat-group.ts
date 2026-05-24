import { z } from 'zod';
import type { ID } from '../geometry/types.js';
import type { Seat, SeatGroup } from './types.js';
import { getSeatLabel } from './label-seats.js';

const SeatNumberingConfigSchema = z.object({
  mode: z.enum(['ROW_MAJOR', 'COLUMN_MAJOR']).default('ROW_MAJOR'),
  rowLabelStart: z.string().default('A'),
  seatNumberStart: z.number().int().min(1).default(1),
  rowDirection: z.enum(['TOP_TO_BOTTOM', 'BOTTOM_TO_TOP']).default('TOP_TO_BOTTOM'),
  columnDirection: z.enum(['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT']).default('LEFT_TO_RIGHT'),
  rowLabelFormat: z.enum(['A', 'AA', '01', 'ROMAN']).default('A'),
  separator: z.string().max(5).default(''),
});

export const CreateSeatGroupSchema = z.object({
  id: z.string().min(1),
  contaId: z.string().min(1),
  name: z.string().max(100).optional(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().min(-180).max(180).default(0),
  rows: z.number().int().min(1).max(500),
  columns: z.number().int().min(1).max(500),
  seatWidth: z.number().min(4).max(200).default(28),
  seatHeight: z.number().min(4).max(200).default(28),
  gapX: z.number().min(0).max(200).default(4),
  gapY: z.number().min(0).max(200).default(4),
  paddingTop: z.number().min(0).default(0),
  paddingRight: z.number().min(0).default(0),
  paddingBottom: z.number().min(0).default(0),
  paddingLeft: z.number().min(0).default(0),
  numbering: SeatNumberingConfigSchema.default({
    mode: 'ROW_MAJOR',
    rowLabelStart: 'A',
    seatNumberStart: 1,
    rowDirection: 'TOP_TO_BOTTOM',
    columnDirection: 'LEFT_TO_RIGHT',
    rowLabelFormat: 'A',
    separator: '',
  }),
  locked: z.boolean().default(false),
});

export type CreateSeatGroupInput = z.input<typeof CreateSeatGroupSchema>;

export function createSeatGroup(
  input: CreateSeatGroupInput,
): { group: SeatGroup; seats: Seat[] } {
  const group = CreateSeatGroupSchema.parse(input) as SeatGroup;

  const seats: Seat[] = [];
  for (let rowIndex = 0; rowIndex < group.rows; rowIndex++) {
    for (let colIndex = 0; colIndex < group.columns; colIndex++) {
      const label = getSeatLabel({
        rowIndex,
        columnIndex: colIndex,
        numbering: group.numbering,
        totalRows: group.rows,
        totalColumns: group.columns,
      });

      // ID determinístico por grupo + posição — estável no undo/redo
      const seatId: ID = `${group.id}-r${rowIndex}-c${colIndex}`;

      seats.push({
        id: seatId,
        contaId: group.contaId,
        groupId: group.id,
        rowIndex,
        columnIndex: colIndex,
        label,
        status: 'AVAILABLE',
      });
    }
  }

  return { group, seats };
}
