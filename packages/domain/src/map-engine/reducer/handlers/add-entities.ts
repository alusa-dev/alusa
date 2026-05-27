import type {
  EventMapLevelDTO,
  EventMapObjectDTO,
  EventSeatDTO,
  EventSeatGroupDTO,
} from '../../types/event-map-types.js';
import type { MapCommand } from '../../commands/command-types.js';
import type { MapTool } from '../../types/event-map-types.js';
import {
  getNextLevelSortOrder,
  isPlateiaBaseLevel,
  MAP_AREA_HEIGHT_PX,
  MAP_AREA_WIDTH_PX,
  normalizeMapLevels,
} from '../../doc/levels.js';
import { withAutoObjectLabel } from '../../layout/object-naming.js';
import {
  buildSeatGridPreview,
  getSeatGridPreviewBounds,
  normalizeSeatGridConfig,
  SEAT_GRID_SECTION_PADDING,
} from '../../layout/seat-grid.js';
import { getTextModeFromCreation, normalizeTextData } from '../../doc/text-object.js';
import {
  applyCorridorReflow,
  inferCorridorAxisFromSize,
} from '../../layout/corridor/index.js';
import {
  DEFAULT_CORRIDOR_THICKNESS,
  MIN_CORRIDOR_THICKNESS,
} from '../../layout/smart-corridor-layout.js';
import { replaceSelection } from '../../selection/selection-utils.js';
import {
  applyMapLevels,
  createDefaultSection,
  createLocalId,
  DEFAULT_COLORS,
  ensureSection,
  getActiveLevel,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
  updateCounts,
} from '../reducer-context.js';

export function getDefaultActiveLevelId(levels: EventMapLevelDTO[]) {
  const normalized = normalizeMapLevels(levels);
  const otherLevels = normalized.filter((level) => !isPlateiaBaseLevel(level));
  if (otherLevels.length > 0) return otherLevels.at(-1)?.id ?? null;
  return normalized.find((level) => isPlateiaBaseLevel(level))?.id ?? null;
}

export function handleAddObject(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'ADD_OBJECT' }>,
): MapCommandHandlerResult {
  const { id, tool, point, size } = command.payload;
  const level = getActiveLevel(state.nextMap, state.activeLevelId);
  if (!level) return;

  if (tool === 'section') {
    const section = createDefaultSection(
      state.nextMap,
      level.id,
      point,
      size?.width && size?.height ? { width: size.width, height: size.height } : undefined,
      state.runtime,
    );
    state.createdId = section.id;
    updateCounts(state.nextMap);
    state.nextSelection = replaceSelection({ type: 'section', id: section.id });
    return;
  }

  if (tool === 'seat') {
    const section = ensureSection(state.nextMap, level.id, point, state.runtime);
    const seatNumber = String(state.nextMap.seats.filter((seat) => seat.sectionId === section.id).length + 1);
    const seat: EventSeatDTO = {
      id,
      levelId: level.id,
      sectionId: section.id,
      objectId: null,
      groupId: null,
      rowIndex: null,
      columnIndex: null,
      technicalCode: `${section.name.replace(/\s+/g, '-').toUpperCase()}-${seatNumber}`,
      displayLabel: seatNumber,
      rowLabel: null,
      seatNumber,
      status: 'AVAILABLE',
      accessible: false,
      publicVisible: true,
      x: point.x,
      y: point.y,
      size: 24,
      rotation: 0,
    };
    state.nextMap.seats.push(seat);
    state.createdId = seat.id;
    updateCounts(state.nextMap);
    state.nextSelection = replaceSelection({ type: 'seat', id: seat.id });
    return;
  }

  const configByTool: Partial<
    Record<MapTool, { type: EventMapObjectDTO['type']; width: number; height: number; data: Record<string, unknown> }>
  > = {
    table: { type: 'TABLE' as const, width: 120, height: 90, data: { fill: '#f8fafc' } },
    stage: { type: 'STAGE' as const, width: 360, height: 110, data: { fill: '#111827' } },
    text: { type: 'TEXT' as const, width: 0, height: 0, data: { text: '' } },
    blocked: { type: 'BLOCKED_AREA' as const, width: 220, height: 100, data: { fill: '#e2e8f0' } },
    corridor: {
      type: 'CORRIDOR' as const,
      width: 32,
      height: 280,
      data: {
        fill: '#f8fafc',
        smartCorridor: true,
        seatGapTop: 8,
        seatGapRight: 8,
        seatGapBottom: 8,
        seatGapLeft: 8,
        corridorThickness: 32,
      },
    },
    booth: { type: 'BOOTH' as const, width: 180, height: 120, data: { fill: '#fff7ed' } },
    general: { type: 'GENERAL_AREA' as const, width: 280, height: 160, data: { fill: '#ecfeff' } },
    'shape-square': { type: 'GENERAL_AREA' as const, width: 130, height: 130, data: { fill: '#ffffff', shape: 'square' } },
    'shape-circle': { type: 'GENERAL_AREA' as const, width: 130, height: 130, data: { fill: '#ffffff', shape: 'circle' } },
    'shape-ellipse': { type: 'GENERAL_AREA' as const, width: 180, height: 110, data: { fill: '#ffffff', shape: 'ellipse' } },
    'shape-triangle': { type: 'GENERAL_AREA' as const, width: 150, height: 130, data: { fill: '#ffffff', shape: 'triangle' } },
  };
  const config = configByTool[tool];
  if (!config) return;

  const textMode = config.type === 'TEXT' ? getTextModeFromCreation(size?.width ?? null, size?.height ?? null) : undefined;
  const objectWidth = config.type === 'TEXT' && !size?.width ? null : size?.width ?? config.width;
  const objectHeight = config.type === 'TEXT' && !size?.height ? null : size?.height ?? config.height;
  const objectData: Record<string, unknown> =
    config.type === 'TEXT'
      ? normalizeTextData({
          ...withAutoObjectLabel(config.data, tool, state.nextMap.objects),
          textMode,
        })
      : withAutoObjectLabel(config.data, tool, state.nextMap.objects);

  if (config.type === 'CORRIDOR') {
    const width = typeof objectWidth === 'number' ? objectWidth : config.width;
    const height = typeof objectHeight === 'number' ? objectHeight : config.height;
    const axis = inferCorridorAxisFromSize(width, height);
    const rawThickness = axis === 'vertical' ? width : height;
    objectData.smartCorridor = true;
    objectData.seatGapTop = 8;
    objectData.seatGapRight = 8;
    objectData.seatGapBottom = 8;
    objectData.seatGapLeft = 8;
    objectData.corridorThickness =
      rawThickness >= MIN_CORRIDOR_THICKNESS
        ? Math.min(rawThickness, 240)
        : DEFAULT_CORRIDOR_THICKNESS;
    objectData.corridorAxis = axis;
    objectData.corridorAutoFit = true;
  }

  const object: EventMapObjectDTO = {
    id,
    levelId: level.id,
    sectionId: null,
    type: config.type,
    data: objectData,
    x: point.x,
    y: point.y,
    width: objectWidth,
    height: objectHeight,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: state.nextMap.objects.length,
  };
  state.nextMap.objects.push(object);
  state.createdId = object.id;
  if (object.type === 'CORRIDOR') applyCorridorReflow(state.nextMap);
  updateCounts(state.nextMap);
  state.nextSelection = replaceSelection({ type: 'object', id: object.id });
}

export function handleAddLevel(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'ADD_LEVEL' }>,
): MapCommandHandlerResult {
  const { levelId, name } = command.payload;
  const levelCount = normalizeMapLevels(state.nextMap.levels).length;
  const level: EventMapLevelDTO = {
    id: levelId,
    name: name?.trim() || `Ambiente ${levelCount + 1}`,
    sortOrder: getNextLevelSortOrder(state.nextMap.levels),
    widthPx: MAP_AREA_WIDTH_PX,
    heightPx: MAP_AREA_HEIGHT_PX,
    unit: 'px',
    scale: null,
  };
  state.nextMap.levels.push(level);
  applyMapLevels(state.nextMap);
  state.nextActiveLevelId = level.id;
  state.nextSelection = replaceSelection({ type: 'level', id: level.id });
}

export function handleDeleteLevel(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'DELETE_LEVEL' }>,
): MapCommandHandlerResult {
  const { levelId } = command.payload;
  const level = state.nextMap.levels.find((entry) => entry.id === levelId);
  if (!level || isPlateiaBaseLevel(level)) return;

  state.nextMap.seats = state.nextMap.seats.filter((seat) => seat.levelId !== levelId);
  state.nextMap.objects = state.nextMap.objects.filter((object) => object.levelId !== levelId);
  state.nextMap.sections = state.nextMap.sections.filter((section) => section.levelId !== levelId);
  state.nextMap.seatGroups = (state.nextMap.seatGroups ?? []).filter((g) => g.levelId !== levelId);
  state.nextMap.levels = state.nextMap.levels.filter((entry) => entry.id !== levelId);
  applyMapLevels(state.nextMap);
  updateCounts(state.nextMap);
  state.nextActiveLevelId =
    state.activeLevelId === levelId ? getDefaultActiveLevelId(state.nextMap.levels) : state.activeLevelId;
  state.nextSelection = state.nextSelection.filter((item) => !(item.type === 'level' && item.id === levelId));
}

export function handleAddRow(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'ADD_ROW' }>,
): MapCommandHandlerResult {
  const { point, quantity } = command.payload;
  const level = getActiveLevel(state.nextMap, state.activeLevelId);
  if (!level) return;

  const section = ensureSection(state.nextMap, level.id, point, state.runtime);
  const rowIndex = new Set(state.nextMap.seats.map((seat) => seat.rowLabel).filter(Boolean)).size;
  const rowLabel = String.fromCharCode(65 + Math.min(rowIndex, 25));
  const spacing = 34;
  const startX = point.x;
  const startY = point.y;

  for (let index = 0; index < quantity; index += 1) {
    const number = String(index + 1);
    state.nextMap.seats.push({
      id: createLocalId('seat', state.runtime),
      levelId: level.id,
      sectionId: section.id,
      objectId: null,
      groupId: null,
      rowIndex: null,
      columnIndex: null,
      technicalCode: `${rowLabel}${number}`,
      displayLabel: `${rowLabel}${number}`,
      rowLabel,
      seatNumber: number,
      status: 'AVAILABLE',
      accessible: false,
      publicVisible: true,
      x: startX + index * spacing,
      y: startY,
      size: 24,
      rotation: 0,
    });
  }

  updateCounts(state.nextMap);
  state.nextSelection = replaceSelection({ type: 'section', id: section.id });
}

export function handleAddSeatGrid(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'ADD_SEAT_GRID' }>,
): MapCommandHandlerResult {
  const { point, config } = command.payload;
  const level = getActiveLevel(state.nextMap, state.activeLevelId);
  if (!level) return;

  const seats = buildSeatGridPreview(point, config);
  if (seats.length === 0) return;
  const sectionBounds = getSeatGridPreviewBounds(seats, SEAT_GRID_SECTION_PADDING);
  if (!sectionBounds) return;

  const color = DEFAULT_COLORS[state.nextMap.sections.length % DEFAULT_COLORS.length];
  const sectionId = createLocalId('section', state.runtime);
  const objectId = createLocalId('object', state.runtime);
  const groupId = createLocalId('seatgroup', state.runtime);
  const sectionName = `Setor ${state.nextMap.sections.length + 1}`;
  const sectionCode = sectionName.replace(/\s+/g, '-').toUpperCase();
  const normalized = normalizeSeatGridConfig(config);
  const gapX = Math.max(0, normalized.horizontalSpacing - normalized.seatSize);
  const gapY = Math.max(0, normalized.verticalSpacing - normalized.seatSize);

  state.nextMap.sections.push({
    id: sectionId,
    levelId: level.id,
    lotId: null,
    lot: null,
    name: sectionName,
    color,
    capacity: seats.length,
    status: 'ACTIVE',
    notes: null,
  });

  state.nextMap.objects.push({
    id: objectId,
    levelId: level.id,
    sectionId,
    type: 'SECTION',
    data: { label: sectionName, fill: color, opacity: 0.1, cornerRadius: 10 },
    x: sectionBounds.x,
    y: sectionBounds.y,
    width: sectionBounds.width,
    height: sectionBounds.height,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: state.nextMap.objects.length,
  });

  state.nextMap.seatGroups = state.nextMap.seatGroups ?? [];
  const seatGroup: EventSeatGroupDTO = {
    id: groupId,
    levelId: level.id,
    name: sectionName,
    x: point.x - normalized.seatSize / 2,
    y: point.y - normalized.seatSize / 2,
    rotation: 0,
    rows: normalized.rows,
    columns: normalized.columns,
    seatWidth: normalized.seatSize,
    seatHeight: normalized.seatSize,
    gapX,
    gapY,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    numbering: {
      format: 'number',
      rowPrefix: normalized.rowPrefix,
      startNumber: normalized.startNumber,
      direction: normalized.numberingDirection,
    },
    locked: false,
  };
  state.nextMap.seatGroups.push(seatGroup);

  for (const draft of seats) {
    const seatId = createLocalId('seat', state.runtime);
    state.nextMap.seats.push({
      id: seatId,
      levelId: level.id,
      sectionId,
      objectId: null,
      groupId,
      rowIndex: draft.rowIndex,
      columnIndex: draft.columnIndex,
      technicalCode: `${sectionCode}-${draft.technicalCode}`,
      displayLabel: draft.displayLabel,
      rowLabel: draft.rowLabel,
      seatNumber: draft.seatNumber,
      status: 'AVAILABLE',
      accessible: false,
      publicVisible: true,
      x: draft.x,
      y: draft.y,
      size: draft.size,
      rotation: 0,
    });
  }

  applyCorridorReflow(state.nextMap);
  updateCounts(state.nextMap);
  state.nextSelection = replaceSelection({ type: 'section', id: sectionId });
}
