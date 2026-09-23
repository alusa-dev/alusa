import type { Point2D } from '../geometry/rotation.js';

export type MapPoint = Point2D;

export type SeatDistributionSegment =
  | { type: 'SEATS'; count: number }
  | { type: 'GAP'; width: number };

export type SeatDistributionMode = 'FIXED' | 'PROGRESSIVE' | 'FIT';
export type SeatDistributionAlignment = 'LEFT' | 'CENTER' | 'RIGHT';

export type LineRowPath = {
  type: 'LINE';
  start: MapPoint;
  end: MapPoint;
};

export type ArcRowPath = {
  type: 'ARC';
  center: MapPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
  clockwise: boolean;
};

export type PolylineRowPath = {
  type: 'POLYLINE';
  points: MapPoint[];
};

export type BezierRowPath = {
  type: 'BEZIER';
  p0: MapPoint;
  p1: MapPoint;
  p2: MapPoint;
  p3: MapPoint;
};

export type SeatRowPath = LineRowPath | ArcRowPath | PolylineRowPath | BezierRowPath;

export type MapSeat = {
  id: string;
  label: string;
  technicalCode?: string;
  categoryId?: string;
  accessible?: boolean;
  publicVisible?: boolean;
  rowIndex: number;
  columnIndex: number;
  /** Optional local override for an intentional individual-seat exception. */
  position?: MapPoint;
  rotation?: number;
};

export type MapSeatRow = {
  id: string;
  sectionId: string;
  blockId?: string;
  label: string;
  path: SeatRowPath;
  /** Orientation retained by the editor's transformer after geometric rotation. */
  transformRotation?: number;
  seatGap: number;
  seatSize: number;
  seatIds: string[];
  seats: MapSeat[];
  distribution?: SeatDistributionSegment[];
};

export type MapSeatBlock = {
  id: string;
  sectionId: string;
  name?: string | null;
  /** Orientation retained by the editor's transformer after geometric rotation. */
  transformRotation?: number;
  /** Maximum number of seats available horizontally in each row. */
  columnCount?: number;
  rowGap: number;
  defaultSeatGap: number;
  distribution: SeatDistributionSegment[];
  distributionMode?: SeatDistributionMode;
  distributionAlignment?: SeatDistributionAlignment;
  firstRowSeatCount?: number;
  lastRowSeatCount?: number;
  fitMinimumSeatCount?: number;
  fitMaximumSeatCount?: number;
  rowIds: string[];
  rows: MapSeatRow[];
};

export type MapSection = {
  id: string;
  levelId: string;
  name: string;
  color: string;
  lotId?: string | null;
  capacity?: number | null;
  status?: string;
  notes?: string | null;
  /** Editor layer visibility; does not change seat availability/public visibility. */
  hidden?: boolean;
  position: MapPoint;
  rotation: number;
  outline: MapPoint[];
  blockIds: string[];
  blocks: MapSeatBlock[];
};

export type MapVisualElement = {
  id: string;
  levelId: string;
  sectionId?: string | null;
  type: string;
  data: Record<string, unknown>;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  rotation: number;
  locked: boolean;
  hidden: boolean;
  sortOrder: number;
};

export type EventMapDocument = {
  schemaVersion: 1;
  sections: MapSection[];
  visualElements: MapVisualElement[];
};

export function findMapSeatOwner(document: EventMapDocument, seatId: string) {
  for (const section of document.sections) {
    for (const block of section.blocks) {
      for (const row of block.rows) {
        if (row.seatIds.includes(seatId) || row.seats.some((seat) => seat.id === seatId)) {
          return { section, block, row };
        }
      }
    }
  }
  return null;
}

export function findMapRowOwner(document: EventMapDocument, rowId: string) {
  for (const section of document.sections) {
    for (const block of section.blocks) {
      const row = block.rows.find((candidate) => candidate.id === rowId);
      if (row) return { section, block, row };
    }
  }
  return null;
}

export function findMapBlockOwner(document: EventMapDocument, blockId: string) {
  for (const section of document.sections) {
    const block = section.blocks.find((candidate) => candidate.id === blockId);
    if (block) return { section, block };
  }
  return null;
}

export type SeatPlacement = {
  seatId: string;
  rowId: string;
  sectionId: string;
  levelId: string;
  label: string;
  technicalCode: string;
  rowLabel: string;
  seatNumber: string;
  rowIndex: number;
  columnIndex: number;
  x: number;
  y: number;
  rotation: number;
  size: number;
  accessible: boolean;
  publicVisible: boolean;
};

export type ResolvedRow = {
  rowId: string;
  sectionId: string;
  levelId: string;
  label: string;
  seatPlacements: SeatPlacement[];
};

export type ResolvedSection = {
  sectionId: string;
  levelId: string;
  outline: MapPoint[];
  worldPosition: MapPoint;
  rotation: number;
  rows: ResolvedRow[];
};

export type LayoutDiagnostic = {
  type:
    | 'INVALID_SECTION'
    | 'INVALID_ROW_PATH'
    | 'INVALID_DISTRIBUTION'
    | 'ROW_OUTSIDE_SECTION'
    | 'SEAT_OUTSIDE_SECTION'
    | 'SEAT_OVERLAP'
    | 'INVALID_SPACING';
  message: string;
  sectionId?: string;
  blockId?: string;
  rowId?: string;
  seatId?: string;
  conflictingSeatId?: string;
};

export type ResolvedMapLayout = {
  sections: ResolvedSection[];
  rows: ResolvedRow[];
  seats: SeatPlacement[];
  diagnostics: LayoutDiagnostic[];
};

export function createEmptyEventMapDocument(): EventMapDocument {
  return { schemaVersion: 1, sections: [], visualElements: [] };
}
