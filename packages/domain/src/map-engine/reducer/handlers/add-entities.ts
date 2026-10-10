import type { EventMapLevelDTO, EventMapObjectDTO } from '../../types/event-map-types.js';
import type { MapCommand, } from '../../commands/command-types.js';
import type { MapTool } from '../../types/event-map-types.js';
import { getNextLevelSortOrder, getNextMapLayerSortOrder, isPlateiaBaseLevel, MAP_AREA_HEIGHT_PX, MAP_AREA_WIDTH_PX, normalizeMapLevels } from '../../doc/levels.js';
import { withAutoObjectLabel } from '../../layout/object-naming.js';
import { getTextModeFromCreation, normalizeTextData } from '../../doc/text-object.js';
import { replaceSelection } from '../../selection/selection-utils.js';
import { applyMapLevels, commandResult, createDefaultSection, getActiveLevel, type MapCommandHandlerResult, type MapCommandHandlerState, updateCounts } from '../reducer-context.js';
import { projectMapDocumentToEditorFields } from '../../migration/project-map-document.js';

const OPERATIONAL_SEAT_STATUSES = new Set(['SOLD', 'HELD', 'COMPLIMENTARY']);

export function getDefaultActiveLevelId(levels: EventMapLevelDTO[]) {
  const normalized = normalizeMapLevels(levels);
  const otherLevels = normalized.filter((level) => !isPlateiaBaseLevel(level));
  if (otherLevels.length > 0) return otherLevels.at(-1)?.id ?? null;
  return normalized.find((level) => isPlateiaBaseLevel(level))?.id ?? null;
}

export function handleAddObject(state: MapCommandHandlerState, command: Extract<MapCommand, { type: 'ADD_OBJECT' }>): MapCommandHandlerResult {
  const { id, tool, point, size } = command.payload;
  const level = getActiveLevel(state.nextMap, state.activeLevelId);
  if (!level) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        activeLevelId: state.activeLevelId,
        warnings: ['Crie ou selecione um ambiente antes de adicionar itens ao mapa.'],
      }),
    };
  }
  if (tool === 'section') {
    const section = createDefaultSection(state.nextMap, level.id, point, size?.width && size?.height ? { width: size.width, height: size.height } : undefined, state.runtime);
    if (state.nextMap.document) {
      const sectionObject = state.nextMap.objects.find((object) => object.sectionId === section.id);
      const width = sectionObject?.width ?? 320;
      const height = sectionObject?.height ?? 180;
      const document = {
        ...state.nextMap.document,
        sections: [...state.nextMap.document.sections, {
          id: section.id,
          levelId: section.levelId,
          name: section.name,
          color: section.color,
          lotId: section.lotId,
          capacity: section.capacity,
          status: section.status,
          notes: section.notes,
          position: { x: point.x, y: point.y },
          rotation: 0,
          outline: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
          blockIds: [],
          blocks: [],
        }],
        visualElements: state.nextMap.objects.map((object) => ({ ...object, data: { ...object.data } })),
      };
      const projection = projectMapDocumentToEditorFields(document, state.nextMap);
      state.nextMap.document = document;
      state.nextMap.sections = projection.sections;
      state.nextMap.objects = projection.objects;
      state.nextMap.seats = projection.seats;
    }
    state.createdId = section.id;
    updateCounts(state.nextMap);
    state.nextSelection = replaceSelection({ type: 'section', id: section.id });
    return;
  }
  if (tool === 'seat' || tool === 'row') {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        activeLevelId: state.activeLevelId,
        warnings: ['Use a ferramenta de assentos para criar fileiras e lugares.'],
      }),
    };
  }

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
  if (!config) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        activeLevelId: state.activeLevelId,
        warnings: ['Este tipo de item não pode ser adicionado ao mapa.'],
      }),
    };
  }
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
    sortOrder: getNextMapLayerSortOrder(state.nextMap),
  };
  if (state.nextMap.document) {
    state.nextMap.document = {
      ...state.nextMap.document,
      visualElements: [...state.nextMap.document.visualElements, object],
    };
    const projection = projectMapDocumentToEditorFields(state.nextMap.document, state.nextMap);
    state.nextMap.sections = projection.sections;
    state.nextMap.objects = projection.objects;
    state.nextMap.seats = projection.seats;
  } else {
    state.nextMap.objects.push(object);
  }
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
  if (!level) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        activeLevelId: state.activeLevelId,
        warnings: ['O ambiente selecionado não foi encontrado.'],
      }),
    };
  }
  if (isPlateiaBaseLevel(level)) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        activeLevelId: state.activeLevelId,
        warnings: ['O ambiente principal do mapa não pode ser removido.'],
      }),
    };
  }

  const seatsForLevel = state.nextMap.seats.filter((seat) => seat.levelId === levelId);
  if (seatsForLevel.some((seat) => OPERATIONAL_SEAT_STATUSES.has(seat.status))) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        activeLevelId: state.activeLevelId,
        warnings: ['Este ambiente contém ingressos vendidos, reservados ou cortesia e não pode ser removido.'],
      }),
    };
  }

  const removedSeatIds = new Set(seatsForLevel.map((seat) => seat.id));
  const removedObjectIds = new Set(state.nextMap.objects.filter((object) => object.levelId === levelId).map((object) => object.id));
  const removedSectionIds = new Set(state.nextMap.sections.filter((section) => section.levelId === levelId).map((section) => section.id));
  const removedDocumentSections = state.nextMap.document?.sections.filter((section) => section.levelId === levelId) ?? [];
  const removedBlockIds = new Set(removedDocumentSections.flatMap((section) => section.blocks.map((block) => block.id)));
  const removedRowIds = new Set(removedDocumentSections.flatMap((section) => section.blocks.flatMap((block) => block.rows.map((row) => row.id))));
  state.nextMap.levels = state.nextMap.levels.filter((entry) => entry.id !== levelId);
  if (state.nextMap.document) {
    const document = {
      ...state.nextMap.document,
      sections: state.nextMap.document.sections.filter((section) => section.levelId !== levelId),
      visualElements: state.nextMap.document.visualElements.filter((object) => object.levelId !== levelId),
    };
    const projection = projectMapDocumentToEditorFields(document, state.nextMap);
    state.nextMap.document = document;
    state.nextMap.sections = projection.sections;
    state.nextMap.objects = projection.objects;
    state.nextMap.seats = projection.seats;
  } else {
    state.nextMap.seats = state.nextMap.seats.filter((seat) => seat.levelId !== levelId);
    state.nextMap.objects = state.nextMap.objects.filter((object) => object.levelId !== levelId);
    state.nextMap.sections = state.nextMap.sections.filter((section) => section.levelId !== levelId);
  }
  applyMapLevels(state.nextMap);
  updateCounts(state.nextMap);
  state.nextActiveLevelId = state.activeLevelId === levelId ? getDefaultActiveLevelId(state.nextMap.levels) : state.activeLevelId;
  state.nextSelection = state.nextSelection.filter((item) => {
    if (item.type === 'level') return item.id !== levelId;
    if (item.type === 'object') return !removedObjectIds.has(item.id);
    if (item.type === 'section') return !removedSectionIds.has(item.id);
    if (item.type === 'seat') return !removedSeatIds.has(item.id);
    if (item.type === 'seatblock') return !removedBlockIds.has(item.id);
    if (item.type === 'seatrow') return !removedRowIds.has(item.id);
    return true;
  });
}
