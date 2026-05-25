import type { EventMapObjectDTO } from '../types/event-map-types.js';
import type { MapTool } from '../types/event-map-types.js';

const OBJECT_NAME_PREFIX_BY_KEY: Record<string, string> = {
  section: 'Setor',
  table: 'Mesa',
  stage: 'Palco',
  text: 'Texto',
  blocked: 'Sessão bloqueada',
  corridor: 'Corredor',
  booth: 'Camarote',
  general: 'Área geral',
  'shape-square': 'Quadrado',
  'shape-circle': 'Círculo',
  'shape-ellipse': 'Elipse',
  'shape-triangle': 'Triângulo',
};

export function getObjectNamingKeyFromTool(tool: MapTool): string | null {
  if (tool in OBJECT_NAME_PREFIX_BY_KEY) return tool;
  return null;
}

export function getObjectNamingKey(object: EventMapObjectDTO): string | null {
  if (object.sectionId && object.type === 'SECTION') return 'section';

  const shape = typeof object.data.shape === 'string' ? object.data.shape : null;
  if (object.type === 'GENERAL_AREA' && shape) {
    const shapeKey = `shape-${shape}`;
    if (shapeKey in OBJECT_NAME_PREFIX_BY_KEY) return shapeKey;
  }

  if (object.type === 'TABLE') return 'table';
  if (object.type === 'STAGE') return 'stage';
  if (object.type === 'TEXT') return 'text';
  if (object.type === 'BLOCKED_AREA') return 'blocked';
  if (object.type === 'CORRIDOR') return 'corridor';
  if (object.type === 'BOOTH') return 'booth';
  if (object.type === 'GENERAL_AREA') return 'general';

  return null;
}

export function getNextObjectDisplayName(
  objects: EventMapObjectDTO[],
  tool: MapTool,
  sectionsCount?: number,
): string | null {
  const namingKey = getObjectNamingKeyFromTool(tool);
  if (!namingKey) return null;

  const prefix = OBJECT_NAME_PREFIX_BY_KEY[namingKey];
  const count =
    namingKey === 'section'
      ? (sectionsCount ?? objects.filter((object) => object.type === 'SECTION').length) + 1
      : objects.filter((object) => getObjectNamingKey(object) === namingKey).length + 1;

  return `${prefix} ${count}`;
}

export function withAutoObjectLabel(
  data: Record<string, unknown>,
  tool: MapTool,
  objects: EventMapObjectDTO[],
  sectionsCount?: number,
): Record<string, unknown> {
  const label = getNextObjectDisplayName(objects, tool, sectionsCount);
  if (!label) return data;

  if (tool === 'text') {
    return { ...data, label, text: data.text ?? '' };
  }

  return { ...data, label };
}

export function getNextDuplicateObjectDisplayName(object: EventMapObjectDTO, objects: EventMapObjectDTO[]) {
  const namingKey = getObjectNamingKey(object);
  if (!namingKey) {
    return String(object.data.label ?? object.data.text ?? object.type);
  }

  const prefix = OBJECT_NAME_PREFIX_BY_KEY[namingKey];
  const count = objects.filter((entry) => getObjectNamingKey(entry) === namingKey).length + 1;
  return `${prefix} ${count}`;
}

export function withDuplicateObjectLabel(object: EventMapObjectDTO, objects: EventMapObjectDTO[]) {
  const label = getNextDuplicateObjectDisplayName(object, objects);
  if (object.type === 'TEXT') {
    return { ...object.data, label, text: object.data.text ?? '' };
  }
  return { ...object.data, label };
}
