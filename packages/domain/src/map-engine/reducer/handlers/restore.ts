import type { MapCommand } from '../../commands/command-types.js';
import {
  applyMapLevels,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
  updateCounts,
} from '../reducer-context.js';
import { projectMapDocumentToEditorFields } from '../../migration/project-map-document.js';

export function handleRestoreDeletedItems(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'RESTORE_DELETED_ITEMS' }>,
): MapCommandHandlerResult {
  const { objects, seats, sections, levels, document } = command.payload;
  for (const level of levels) {
    if (!state.nextMap.levels.some((l) => l.id === level.id)) {
      state.nextMap.levels.push(level);
    }
  }
  applyMapLevels(state.nextMap);
  for (const section of sections) {
    if (!state.nextMap.sections.some((s) => s.id === section.id)) {
      state.nextMap.sections.push(section);
    }
  }
  for (const object of objects) {
    if (!state.nextMap.objects.some((o) => o.id === object.id)) {
      state.nextMap.objects.push(object);
    }
  }
  for (const seat of seats) {
    if (!state.nextMap.seats.some((s) => s.id === seat.id)) {
      state.nextMap.seats.push(seat);
    }
  }
  if (document) {
    state.nextMap.document = document;
    const projection = projectMapDocumentToEditorFields(document, state.nextMap);
    state.nextMap.sections = projection.sections;
    state.nextMap.objects = projection.objects;
    state.nextMap.seats = projection.seats;
  }
  updateCounts(state.nextMap);
}

export function handleRestoreObjectGroups(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'RESTORE_OBJECT_GROUPS' }>,
): MapCommandHandlerResult {
  const { objects } = command.payload;
  const objectMap = new Map(objects.map((o) => [o.id, o.prevData]));
  state.nextMap.objects = state.nextMap.objects.map((object) => {
    if (objectMap.has(object.id)) {
      return {
        ...object,
        data: { ...objectMap.get(object.id) },
      };
    }
    return object;
  });
  if (state.nextMap.document) {
    const objectDataById = new Map(objects.map((entry) => [entry.id, entry.prevData]));
    state.nextMap.document = {
      ...state.nextMap.document,
      visualElements: state.nextMap.document.visualElements.map((element) => {
        const previousData = objectDataById.get(element.id);
        return previousData ? { ...element, data: { ...previousData } } : element;
      }),
    };
    const projection = projectMapDocumentToEditorFields(state.nextMap.document, state.nextMap);
    state.nextMap.sections = projection.sections;
    state.nextMap.objects = projection.objects;
    state.nextMap.seats = projection.seats;
    updateCounts(state.nextMap);
  }
}
