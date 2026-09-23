import type { MapTool, SeatBlockConfig } from '@alusa/domain';

export type SeatCreationMode = 'RECTANGULAR';

export type CreationDraft = {
  tool: MapTool;
  start: { x: number; y: number };
  current: { x: number; y: number };
};

export type SeatBlockDraft = {
  origin: { x: number; y: number };
  config: SeatBlockConfig;
};

type SeatBlockCalibration = {
  seatDiameter?: number;
  seatPitch?: number;
  rowPitch?: number;
};

export type MarqueeDraft = {
  start: { x: number; y: number };
  current: { x: number; y: number };
};

export function isCreationTool(tool: MapTool) {
  return !['select', 'pan', 'zoom', 'row'].includes(tool);
}

export function isPlacementTool(tool: MapTool) {
  return isCreationTool(tool) || tool === 'row';
}

export function isProportionalTool(tool: MapTool) {
  return tool === 'shape-square' || tool === 'shape-circle';
}

export function getCreationBox(draft: CreationDraft) {
  const rawWidth = draft.current.x - draft.start.x;
  const rawHeight = draft.current.y - draft.start.y;

  if (isProportionalTool(draft.tool)) {
    const size = Math.max(Math.abs(rawWidth), Math.abs(rawHeight));
    const width = rawWidth < 0 ? -size : size;
    const height = rawHeight < 0 ? -size : size;
    return {
      x: width < 0 ? draft.start.x + width : draft.start.x,
      y: height < 0 ? draft.start.y + height : draft.start.y,
      width: Math.abs(width),
      height: Math.abs(height),
    };
  }

  return {
    x: Math.min(draft.start.x, draft.current.x),
    y: Math.min(draft.start.y, draft.current.y),
    width: Math.abs(rawWidth),
    height: Math.abs(rawHeight),
  };
}

export function getSeatBlockConfigForBounds(
  box: { x: number; y: number; width: number; height: number },
  calibration?: SeatBlockCalibration | null,
  startNumber = 1,
  inherited?: Pick<SeatBlockConfig, 'seatSize' | 'horizontalSpacing' | 'verticalSpacing'>,
): SeatBlockDraft {
  const seatSize = Math.max(12, inherited?.seatSize ?? calibration?.seatDiameter ?? 28);
  const seatGap = Math.max(0, inherited ? inherited.horizontalSpacing - seatSize : calibration?.seatPitch ?? 10);
  const rowGap = Math.max(0, inherited ? inherited.verticalSpacing - seatSize : calibration?.rowPitch ?? 14);
  const horizontalSpacing = seatSize + seatGap;
  const verticalSpacing = seatSize + rowGap;
  const columns = Math.max(1, Math.floor((Math.max(0, box.width) + seatGap) / horizontalSpacing));
  const rows = Math.max(1, Math.floor((Math.max(0, box.height) + rowGap) / verticalSpacing));

  return {
    origin: { x: box.x + seatSize / 2, y: box.y + seatSize / 2 },
    config: {
      totalSeats: rows * columns,
      rows,
      columns,
      seatSize,
      horizontalSpacing,
      verticalSpacing,
      rowPrefix: 'A',
      startNumber: Math.max(1, startNumber),
      numberingDirection: 'left-to-right',
    },
  };
}

export function getCreationShape(tool: MapTool) {
  if (tool === 'shape-circle') return 'circle';
  if (tool === 'shape-ellipse') return 'ellipse';
  if (tool === 'shape-triangle') return 'triangle';
  return null;
}
