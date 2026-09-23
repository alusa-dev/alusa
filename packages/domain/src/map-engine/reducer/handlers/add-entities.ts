import type { EventMapLevelDTO, EventMapObjectDTO } from '../../types/event-map-types.js';
import type { MapCommand, } from '../../commands/command-types.js';
import type { MapTool } from '../../types/event-map-types.js';
import { getNextLevelSortOrder, isPlateiaBaseLevel, MAP_AREA_HEIGHT_PX, MAP_AREA_WIDTH_PX, normalizeMapLevels } from '../../doc/levels.js';
import { withAutoObjectLabel } from '../../layout/object-naming.js';
import { getTextModeFromCreation, normalizeTextData } from '../../doc/text-object.js';
import { replaceSelection } from '../../selection/selection-utils.js';
import { applyMapLevels, createDefaultSection, getActiveLevel, type MapCommandHandlerResult, type MapCommandHandlerState, updateCounts } from '../reducer-context.js';

export function getDefaultActiveLevelId(levels: EventMapLevelDTO[]) {
  const normalized = normalizeMapLevels(levels);
  const otherLevels = normalized.filter((level) => !isPlateiaBaseLevel(level));
  if (otherLevels.length > 0) return otherLevels.at(-1)?.id ?? null;
  return normalized.find((level) => isPlateiaBaseLevel(level))?.id ?? null;
}

export function handleAddObject(state: MapCommandHandlerState, command: Extract<MapCommand, { type: 'ADD_OBJECT' }>): MapCommandHandlerResult {
  const { id, tool, point, size } = command.payload;
  const level = getActiveLevel(state.nextMap, state.activeLevelId);
  if (!level) return;
  if (tool === 'section') {
    const section = createDefaultSection(state.nextMap, level.id, point, size?.width && size?.height ? { width: size.width, height: size.height } : undefined, state.runtime);
    state.createdId = section.id;
    updateCounts(state.nextMap);
    state.nextSelection = replaceSelection({ type: 'section', id: section.id });
    return;
  }
  if (tool === 'seat' || tool === 'row') return;

  const configByTool: Partial<Record<MapTool, { type: EventMapObjectDTO['type']; width: number; height: number; data: Record<string, unknown> }>> = {
    table: { type: 'TABLE', width: 120, height: 90, data: { fill: '#f8fafc' } },
    stage: { type: 'STAGE', width: 360, height: 110, data: { fill: '#111827' } },
    text: { type: 'TEXT', width: 0, height: 0, data: { text: '' } },
    blocked: { type: 'BLOCKED_AREA', width: 220, height: 100, data: { fill: '#e2e8f0' } },
    booth: { type: 'BOOTH', width: 180, height: 120, data: { fill: '#fff7ed' } },
    general: { type: 'GENERAL_AREA', width: 280, height: 160, data: { fill: '#ecfeff' } },
    'shape-square': { type: 'GENERAL_AREA', width: 130, height: 130, data: { fill: '#ffffff', shape: 'square' } },
    'shape-circle': { type: 'GENERAL_AREA', width: 130, height: 130, data: { fill: '#ffffff', shape: 'circle' } },
    'shape-ellipse': { type: 'GENERAL_AREA', width: 180, height: 110, data: { fill: '#ffffff', shape: 'ellipse' } },
    'shape-triangle': { type: 'GENERAL_AREA', width: 150, height: 130, data: { fill: '#ffffff', shape: 'triangle' } },
  };
  const config = configByTool[tool];
  if (!config) return;
  const textMode = config.type === 'TEXT' ? getTextModeFromCreation(size?.width ?? null, size?.height ?? null) : undefined;
  const objectData = config.type === 'TEXT'
    ? normalizeTextData({ ...withAutoObjectLabel(config.data, tool, state.nextMap.objects), textMode })
    : withAutoObjectLabel(config.data, tool, state.nextMap.objects);
  const object: EventMapObjectDTO = {
    id,
    levelId: level.id,
    sectionId: null,
    type: config.type,
    data: objectData,
    x: point.x,
    y: point.y,
    width: config.type === 'TEXT' && !size?.width ? null : size?.width ?? config.width,
    height: config.type === 'TEXT' && !size?.height ? null : size?.height ?? config.height,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: state.nextMap.objects.length,
  };
  state.nextMap.objects.push(object);
  state.createdId = object.id;
  updateCounts(state.nextMap);
  state.nextSelection = replaceSelection({ type: 'object', id: object.id });
}

export function handleAddLevel(state: MapCommandHandlerState, command: Extract<MapCommand, { type: 'ADD_LEVEL' }>): MapCommandHandlerResult {
  const { levelId, name } = command.payload;
  const level: EventMapLevelDTO = { id: levelId, name: name?.trim() || `Ambiente ${state.nextMap.levels.length + 1}`, sortOrder: getNextLevelSortOrder(state.nextMap.levels), widthPx: MAP_AREA_WIDTH_PX, heightPx: MAP_AREA_HEIGHT_PX, unit: 'px', scale: null };
  state.nextMap.levels.push(level);
  applyMapLevels(state.nextMap);
  state.nextActiveLevelId = level.id;
  state.nextSelection = replaceSelection({ type: 'level', id: level.id });
}

export function handleDeleteLevel(state: MapCommandHandlerState, command: Extract<MapCommand, { type: 'DELETE_LEVEL' }>): MapCommandHandlerResult {
  const { levelId } = command.payload;
  const level = state.nextMap.levels.find((entry) => entry.id === levelId);
  if (!level || isPlateiaBaseLevel(level)) return;
  state.nextMap.seats = state.nextMap.seats.filter((seat) => seat.levelId !== levelId);
  state.nextMap.objects = state.nextMap.objects.filter((object) => object.levelId !== levelId);
  state.nextMap.sections = state.nextMap.sections.filter((section) => section.levelId !== levelId);
  state.nextMap.levels = state.nextMap.levels.filter((entry) => entry.id !== levelId);
  applyMapLevels(state.nextMap);
  updateCounts(state.nextMap);
  state.nextActiveLevelId = state.activeLevelId === levelId ? getDefaultActiveLevelId(state.nextMap.levels) : state.activeLevelId;
  state.nextSelection = state.nextSelection.filter((item) => !(item.type === 'level' && item.id === levelId));
}
