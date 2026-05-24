import type { ID, Point } from '../geometry/types.js';
import type { Seat, SeatGroup, SeatManualOverride, SeatNumberingConfig } from '../seat-groups/types.js';
import type { SmartCorridor } from '../corridors/types.js';

// ─── Operações de SeatGroup ───────────────────────────────────────────────

export type CreateSeatGroupOp = {
  kind: 'CREATE_SEAT_GROUP';
  group: SeatGroup;
  /** Se informado, adiciona estes assentos ao estado junto com o grupo. */
  seats?: Seat[];
};

export type MoveSeatGroupOp = {
  kind: 'MOVE_SEAT_GROUP';
  groupId: ID;
  from: Point;
  to: Point;
};

export type ResizeSeatGroupOp = {
  kind: 'RESIZE_SEAT_GROUP';
  groupId: ID;
  rows?: number;
  columns?: number;
};

export type ReparametrizeSeatGroupOp = {
  kind: 'REPARAMETRIZE_SEAT_GROUP';
  groupId: ID;
  patch: Partial<Pick<SeatGroup, 'seatWidth' | 'seatHeight' | 'gapX' | 'gapY' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft' | 'rotation'>>;
};

export type RelabelSeatGroupOp = {
  kind: 'RELABEL_SEAT_GROUP';
  groupId: ID;
  numbering: SeatNumberingConfig;
};

export type DeleteSeatGroupOp = {
  kind: 'DELETE_SEAT_GROUP';
  groupId: ID;
};

export type OverrideSeatOp = {
  kind: 'OVERRIDE_SEAT';
  seatId: ID;
  groupId: ID;
  override: SeatManualOverride;
};

// ─── Operações de Corredor ───────────────────────────────────────────────

export type CreateCorridorOp = {
  kind: 'CREATE_CORRIDOR';
  corridor: SmartCorridor;
};

export type MoveCorridorOp = {
  kind: 'MOVE_CORRIDOR';
  corridorId: ID;
  from: Point;
  to: Point;
};

export type UpdateCorridorOp = {
  kind: 'UPDATE_CORRIDOR';
  corridorId: ID;
  patch: Partial<Pick<SmartCorridor, 'thickness' | 'length' | 'rotation' | 'behavior' | 'clearance'>>;
};

export type ResizeCorridorEdgeOp = {
  kind: 'RESIZE_CORRIDOR_EDGE';
  corridorId: ID;
  /** World-space bounds after resize (top-left pivot). */
  bounds: { x: number; y: number; width: number; height: number };
  rotation: number;
  handle: string;
};

export type RotateCorridorOp = {
  kind: 'ROTATE_CORRIDOR';
  corridorId: ID;
  rotation: number;
  bounds: { x: number; y: number; width: number; height: number };
};

export type TransformCorridorGroupOp = {
  kind: 'TRANSFORM_CORRIDOR_GROUP';
  corridorIds: ID[];
  mode: 'group-rotate' | 'group-resize' | 'rotate' | 'resize';
  patches: Array<{
    corridorId: ID;
    bounds: { x: number; y: number; width: number; height: number };
    rotation: number;
  }>;
};

export type DeleteCorridorOp = {
  kind: 'DELETE_CORRIDOR';
  corridorId: ID;
};

// ─── Union ───────────────────────────────────────────────────────────────

export type MapOperation =
  | CreateSeatGroupOp
  | MoveSeatGroupOp
  | ResizeSeatGroupOp
  | ReparametrizeSeatGroupOp
  | RelabelSeatGroupOp
  | DeleteSeatGroupOp
  | OverrideSeatOp
  | CreateCorridorOp
  | MoveCorridorOp
  | UpdateCorridorOp
  | ResizeCorridorEdgeOp
  | RotateCorridorOp
  | TransformCorridorGroupOp
  | DeleteCorridorOp;
