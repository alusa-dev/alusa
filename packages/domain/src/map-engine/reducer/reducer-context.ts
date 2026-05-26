import type {
  EventMapDTO,
  EventMapObjectDTO,
  EventMapSectionDTO,
} from '../types/event-map-types.js';
import type { MapCommand } from '../commands/command-types.js';
import type { MapEngineRuntime } from '../ports/runtime-ports.js';
import type { MapSelection } from '../selection/selection-utils.js';
import { normalizeMapLevels } from '../geometry/level-utils.js';

export const DEFAULT_COLORS = ['#6d28d9', '#0f766e', '#2563eb', '#db2777', '#ea580c', '#16a34a'];

export function cloneMap(map: EventMapDTO): EventMapDTO {
  return JSON.parse(JSON.stringify(map)) as EventMapDTO;
}

let fallbackIdSequence = 0;

export function createLocalId(prefix: string, runtime?: MapEngineRuntime) {
  if (runtime?.createId) return runtime.createId(prefix);
  fallbackIdSequence += 1;
  return `${prefix}_${fallbackIdSequence}`;
}

export function getActiveLevel(map: EventMapDTO | null, activeLevelId: string | null) {
  if (!map) return null;
  return map.levels.find((level) => level.id === activeLevelId) ?? map.levels[0] ?? null;
}

export function updateCounts(map: EventMapDTO) {
  map.counts = {
    levels: map.levels.length,
    sections: map.sections.length,
    seats: map.seats.length,
    availableSeats: map.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.publicVisible).length,
  };
}

export function applyMapLevels(map: EventMapDTO) {
  map.levels = normalizeMapLevels(map.levels);
}

export function createDefaultSection(
  map: EventMapDTO,
  levelId: string,
  point: { x: number; y: number },
  size?: { width: number; height: number },
  runtime?: MapEngineRuntime,
) {
  const color = DEFAULT_COLORS[map.sections.length % DEFAULT_COLORS.length];
  const sectionId = createLocalId('section', runtime);
  const objectId = createLocalId('object', runtime);
  const sectionName = `Setor ${map.sections.length + 1}`;
  const section: EventMapSectionDTO = {
    id: sectionId,
    levelId,
    lotId: null,
    lot: null,
    name: sectionName,
    color,
    capacity: null,
    status: 'ACTIVE',
    notes: null,
  };
  const object: EventMapObjectDTO = {
    id: objectId,
    levelId,
    sectionId,
    type: 'SECTION',
    data: { label: sectionName, fill: color },
    x: point.x,
    y: point.y,
    width: size?.width ?? 320,
    height: size?.height ?? 180,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: map.objects.length,
  };

  map.sections.push(section);
  map.objects.push(object);
  return section;
}

export function ensureSection(
  map: EventMapDTO,
  levelId: string,
  point: { x: number; y: number },
  runtime?: MapEngineRuntime,
) {
  return map.sections.find((section) => section.levelId === levelId) ?? createDefaultSection(map, levelId, point, undefined, runtime);
}

export type CommandResult = {
  map: EventMapDTO;
  document: EventMapDTO;
  selection?: MapSelection;
  createdId?: string | null;
  activeLevelId?: string | null;
  undoCommand?: MapCommand | null;
  patches: MapCommand[];
  inversePatches: MapCommand[];
  warnings: string[];
};

export type ExecuteMapCommandContext = {
  activeLevelId?: string | null;
  selection?: MapSelection;
  runtime?: MapEngineRuntime;
};

export function commandResult(input: {
  map: EventMapDTO;
  selection: MapSelection;
  createdId?: string | null;
  activeLevelId?: string | null;
  undoCommand?: MapCommand | null;
  patches?: MapCommand[];
  warnings?: string[];
}): CommandResult {
  const undoCommand = input.undoCommand ?? null;
  return {
    map: input.map,
    document: input.map,
    selection: input.selection,
    createdId: input.createdId ?? null,
    activeLevelId: input.activeLevelId ?? null,
    undoCommand,
    patches: input.patches ?? [],
    inversePatches: undoCommand ? [undoCommand] : [],
    warnings: input.warnings ?? [],
  };
}

export type MapCommandHandlerState = {
  beforeMap: EventMapDTO;
  nextMap: EventMapDTO;
  selection: MapSelection;
  nextSelection: MapSelection;
  activeLevelId: string | null;
  nextActiveLevelId: string | null;
  createdId: string | null;
  runtime?: MapEngineRuntime;
};

export type MapCommandHandlerResult = void | { earlyReturn: CommandResult };
