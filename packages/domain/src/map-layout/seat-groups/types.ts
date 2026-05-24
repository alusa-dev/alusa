import type { ID } from '../geometry/types.js';

export type SeatNumberingConfig = {
  mode: 'ROW_MAJOR' | 'COLUMN_MAJOR';
  rowLabelStart: string;
  seatNumberStart: number;
  rowDirection: 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';
  columnDirection: 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  rowLabelFormat: 'A' | 'AA' | '01' | 'ROMAN';
  separator: string;
};

export type SeatGroup = {
  id: ID;
  contaId: ID;
  name?: string;
  x: number;
  y: number;
  rotation: number;
  rows: number;
  columns: number;
  seatWidth: number;
  seatHeight: number;
  gapX: number;
  gapY: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  numbering: SeatNumberingConfig;
  locked?: boolean;
};

export type SeatManualOverride = {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  labelOverride?: string;
};

export type Seat = {
  id: ID;
  contaId: ID;
  groupId: ID;
  rowIndex: number;
  columnIndex: number;
  label: string;
  status:
    | 'AVAILABLE'
    | 'RESERVED'
    | 'OCCUPIED'
    | 'BLOCKED'
    | 'HIDDEN_BY_CORRIDOR'
    | 'REMOVED';
  manualOverride?: SeatManualOverride;
};

/** Assento com posição visual calculada — nunca persistir esses campos como base. */
export type DerivedSeat = Seat & {
  /** Posição visual em world space, incluindo offset de corredor e override manual. */
  visualX: number;
  visualY: number;
  width: number;
  height: number;
  rotation: number;
  hidden: boolean;
  corridorOffset: { dx: number; dy: number };
};
