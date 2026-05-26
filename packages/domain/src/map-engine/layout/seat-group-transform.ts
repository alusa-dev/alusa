import { rotatePoint, toLocal } from '../geometry/rotation.js';
import { getSeatGridRowLabel } from './seat-grid.js';
import type { EventMapDTO, EventSeatDTO, EventSeatGroupDTO } from '../types/event-map-types.js';

export type SeatGroupGridResizeInput = {
  handle: 'right' | 'bottom' | 'bottom-right';
  startWorldPt: { x: number; y: number };
  currentWorldPt: { x: number; y: number };
  startTotalW: number;
  startTotalH: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  gapX: number;
  gapY: number;
  stepX: number;
  stepY: number;
  lastCommittedRows: number;
  lastCommittedCols: number;
  maxRows?: number;
  maxCols?: number;
};

export type SeatGroupGridResizeResult = {
  rows: number;
  columns: number;
  changed: boolean;
};

export function resolveSeatGroupGridResize(input: SeatGroupGridResizeInput): SeatGroupGridResizeResult {
  const deltaX = input.currentWorldPt.x - input.startWorldPt.x;
  const deltaY = input.currentWorldPt.y - input.startWorldPt.y;
  const maxCols = input.maxCols ?? 80;
  const maxRows = input.maxRows ?? 50;

  let newCols = input.lastCommittedCols;
  let newRows = input.lastCommittedRows;

  if (input.handle === 'right' || input.handle === 'bottom-right') {
    newCols = Math.max(
      1,
      Math.min(
        maxCols,
        Math.round(
          (input.startTotalW + deltaX - input.paddingLeft - input.paddingRight + input.gapX) / input.stepX,
        ),
      ),
    );
  }

  if (input.handle === 'bottom' || input.handle === 'bottom-right') {
    newRows = Math.max(
      1,
      Math.min(
        maxRows,
        Math.round(
          (input.startTotalH + deltaY - input.paddingTop - input.paddingBottom + input.gapY) / input.stepY,
        ),
      ),
    );
  }

  return {
    rows: newRows,
    columns: newCols,
    changed: newRows !== input.lastCommittedRows || newCols !== input.lastCommittedCols,
  };
}

export function transformSeatInGroup(
  seat: EventSeatDTO,
  prevGroup: EventSeatGroupDTO,
  nextGroup: EventSeatGroupDTO,
): EventSeatDTO {
  const prevLocal = toLocal({ x: seat.x, y: seat.y }, { x: prevGroup.x, y: prevGroup.y }, prevGroup.rotation ?? 0);
  const deltaRotation = (nextGroup.rotation ?? 0) - (prevGroup.rotation ?? 0);
  const rotatedLocal = rotatePoint(prevLocal, { x: 0, y: 0 }, deltaRotation);
  return {
    ...seat,
    x: nextGroup.x + rotatedLocal.x,
    y: nextGroup.y + rotatedLocal.y,
    rotation: (seat.rotation ?? 0) + deltaRotation,
  };
}

export type ApplySeatGroupPatchOptions = {
  createSeatId?: () => string;
};

export function applySeatGroupLayoutPatch(
  map: EventMapDTO,
  groupId: string,
  patch: Partial<EventSeatGroupDTO>,
  options?: ApplySeatGroupPatchOptions,
): EventMapDTO {
  const nextMap = { ...map, seatGroups: [...(map.seatGroups ?? [])], seats: [...map.seats] };
  const groupIndex = nextMap.seatGroups.findIndex((g) => g.id === groupId);
  if (groupIndex === -1) return map;

  const prev = nextMap.seatGroups[groupIndex]!;
  const next = { ...prev, ...patch };
  nextMap.seatGroups[groupIndex] = next;

  const rowsChanged = typeof patch.rows === 'number' && patch.rows !== prev.rows;
  const colsChanged = typeof patch.columns === 'number' && patch.columns !== prev.columns;

  if (rowsChanged || colsChanged) {
    nextMap.seats = nextMap.seats.filter((seat) => {
      if (seat.groupId !== groupId) return true;
      return (seat.rowIndex ?? 0) < next.rows && (seat.columnIndex ?? 0) < next.columns;
    });

    const numbering = next.numbering as Record<string, unknown>;
    const rowPrefix = String(numbering.rowPrefix ?? 'A');
    const startNumber = Number(numbering.startNumber ?? 1);
    const direction = numbering.direction === 'right-to-left' ? 'right-to-left' : 'left-to-right';

    const existingSeat = nextMap.seats.find((s) => s.groupId === groupId);
    const sectionId = existingSeat?.sectionId ?? null;
    const section = sectionId ? nextMap.sections.find((s) => s.id === sectionId) : null;
    const sectionCode = section?.name?.replace(/\s+/g, '-').toUpperCase() ?? 'SECTION';

    const existingPairs = new Set(
      nextMap.seats.filter((s) => s.groupId === groupId).map((s) => `${s.rowIndex ?? 0}:${s.columnIndex ?? 0}`),
    );

    const stepX = next.seatWidth + next.gapX;
    const stepY = next.seatHeight + next.gapY;
    const createSeatId = options?.createSeatId ?? (() => `seat-${Math.random().toString(36).slice(2, 10)}`);

    if (sectionId) {
      for (let rowIndex = 0; rowIndex < next.rows; rowIndex++) {
        for (let colIndex = 0; colIndex < next.columns; colIndex++) {
          if (existingPairs.has(`${rowIndex}:${colIndex}`)) continue;
          const visualColIndex = direction === 'right-to-left' ? next.columns - colIndex - 1 : colIndex;
          const rowLabel = getSeatGridRowLabel(rowIndex, rowPrefix);
          const seatNumber = String(startNumber + visualColIndex);
          const displayLabel = `${rowLabel}${seatNumber}`;
          nextMap.seats.push({
            id: createSeatId(),
            levelId: next.levelId,
            sectionId,
            objectId: null,
            groupId,
            rowIndex,
            columnIndex: colIndex,
            technicalCode: `${sectionCode}-${displayLabel}`,
            displayLabel,
            rowLabel,
            seatNumber,
            status: 'AVAILABLE',
            accessible: false,
            publicVisible: true,
            x: next.x + next.paddingLeft + colIndex * stepX + next.seatWidth / 2,
            y: next.y + next.paddingTop + rowIndex * stepY + next.seatHeight / 2,
            size: next.seatWidth,
            rotation: 0,
          });
        }
      }
    }
  }

  const layoutChanged =
    typeof patch.seatWidth === 'number' ||
    typeof patch.seatHeight === 'number' ||
    typeof patch.gapX === 'number' ||
    typeof patch.gapY === 'number' ||
    typeof patch.paddingTop === 'number' ||
    typeof patch.paddingLeft === 'number' ||
    typeof patch.paddingRight === 'number' ||
    typeof patch.paddingBottom === 'number' ||
    rowsChanged ||
    colsChanged;

  if (layoutChanged) {
    const stepX = next.seatWidth + next.gapX;
    const stepY = next.seatHeight + next.gapY;
    nextMap.seats = nextMap.seats.map((seat) => {
      if (seat.groupId !== groupId) return seat;
      const row = seat.rowIndex ?? 0;
      const col = seat.columnIndex ?? 0;
      const local = {
        x: next.paddingLeft + col * stepX + next.seatWidth / 2,
        y: next.paddingTop + row * stepY + next.seatHeight / 2,
      };
      const offset = rotatePoint(local, { x: 0, y: 0 }, next.rotation ?? 0);
      return {
        ...seat,
        x: next.x + offset.x,
        y: next.y + offset.y,
        size: next.seatWidth,
      };
    });
    return nextMap;
  }

  const transformChanged =
    typeof patch.x === 'number' || typeof patch.y === 'number' || typeof patch.rotation === 'number';

  if (transformChanged) {
    nextMap.seats = nextMap.seats.map((seat) =>
      seat.groupId === groupId ? transformSeatInGroup(seat, prev, next) : seat,
    );
  }

  return nextMap;
}

export function buildSeatGroupTransformPatch(
  _group: EventSeatGroupDTO,
  nodeGeometry: { x: number; y: number; rotation: number },
): Partial<EventSeatGroupDTO> {
  return {
    x: nodeGeometry.x,
    y: nodeGeometry.y,
    rotation: nodeGeometry.rotation,
  };
}
