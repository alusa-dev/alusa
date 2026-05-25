import type { EventMapObjectDTO } from '../api/event-map-service';
import { readCorridorNodeScaledSize } from './corridor-canvas';

import type Konva from 'konva';

/** Read live corridor geometry from Konva during preview transforms. */
export function resolveLiveCorridorObject(
  stage: Konva.Stage,
  object: EventMapObjectDTO,
): EventMapObjectDTO {
  const node = stage.findOne(`#node-${object.id}`);
  if (!node || object.type !== 'CORRIDOR') return object;

  const { width, height } = readCorridorNodeScaledSize(node);
  return {
    ...object,
    x: node.x(),
    y: node.y(),
    width,
    height,
    rotation: node.rotation(),
  };
}

export function resolveCorridorObjectsForUnion(
  stage: Konva.Stage | null,
  objects: EventMapObjectDTO[],
  livePreview: boolean,
): EventMapObjectDTO[] {
  if (!livePreview || !stage) return objects;

  return objects.map((object) => {
    if (object.type !== 'CORRIDOR') return object;
    return resolveLiveCorridorObject(stage, object);
  });
}

export function resolveCorridorObjectsForRender(
  stage: Konva.Stage | null,
  objects: EventMapObjectDTO[],
  livePreview: boolean,
): EventMapObjectDTO[] {
  return resolveCorridorObjectsForUnion(stage, objects, livePreview);
}
