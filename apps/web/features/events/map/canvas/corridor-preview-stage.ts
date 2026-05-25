import type { EventMapDTO } from '../api/event-map-service';
import { applyCorridorNodeFromModel } from './corridor-canvas';

import type Konva from 'konva';

function isKonvaGroup(node: Konva.Node): node is Konva.Group {
  return typeof (node as Konva.Group).getChildren === 'function';
}

function syncNodeSize(node: Konva.Node, width?: number, height?: number) {
  if (isKonvaGroup(node)) {
    const bodyRect = (node as Konva.Group).findOne('.corridor-body') as Konva.Rect | undefined;
    if (bodyRect) {
      if (typeof width === 'number') bodyRect.width(width);
      if (typeof height === 'number') bodyRect.height(height);
    }
    return;
  }
  if (typeof width === 'number') node.width(width);
  if (typeof height === 'number') node.height(height);
}

/** Sets the position of a seat node, accounting for nodes inside a seatGroup Group. */
function setSeatNodePosition(node: Konva.Node, worldX: number, worldY: number) {
  const parent = node.parent;
  if (parent && parent.className !== 'Layer') {
    const pRot = (parent.rotation() * Math.PI) / 180;
    const dx = worldX - parent.x();
    const dy = worldY - parent.y();
    const localX = dx * Math.cos(-pRot) - dy * Math.sin(-pRot);
    const localY = dx * Math.sin(-pRot) + dy * Math.cos(-pRot);
    node.position({ x: localX, y: localY });
  } else {
    node.position({ x: worldX, y: worldY });
  }
}

export function applyCorridorPreviewToStage(
  stage: Konva.Stage,
  preview: EventMapDTO,
  baseMap: EventMapDTO,
  corridorNodeIds: string[],
  levelId: string,
  options?: { syncCorridorGeometry?: boolean },
) {
  const baseSeatById = new Map(baseMap.seats.map((seat) => [seat.id, seat]));
  const baseObjectById = new Map(baseMap.objects.map((object) => [object.id, object]));

  for (const seat of preview.seats) {
    if (seat.levelId !== levelId || !seat.publicVisible) continue;

    const baseSeat = baseSeatById.get(seat.id);
    if (!baseSeat) continue;
    if (Math.abs(seat.x - baseSeat.x) < 0.001 && Math.abs(seat.y - baseSeat.y) < 0.001) continue;

    const node = stage.findOne(`#node-${seat.id}`);
    if (!node) continue;
    setSeatNodePosition(node, seat.x, seat.y);
  }

  for (const object of preview.objects) {
    if (object.levelId !== levelId || object.hidden) continue;

    const baseObject = baseObjectById.get(object.id);
    if (!baseObject) continue;

    const positionChanged =
      Math.abs(object.x - baseObject.x) >= 0.001 || Math.abs(object.y - baseObject.y) >= 0.001;
    const geometryChanged =
      object.type === 'CORRIDOR' &&
      corridorNodeIds.includes(`node-${object.id}`) &&
      (Math.abs((object.rotation ?? 0) - (baseObject.rotation ?? 0)) >= 0.001 ||
        Math.abs((object.width ?? 0) - (baseObject.width ?? 0)) >= 0.001 ||
        Math.abs((object.height ?? 0) - (baseObject.height ?? 0)) >= 0.001);

    if (!positionChanged && !geometryChanged) continue;

    const node = stage.findOne(`#node-${object.id}`);
    if (!node) continue;

    if (object.type === 'CORRIDOR') {
      if (options?.syncCorridorGeometry) {
        applyCorridorNodeFromModel(node, object);
      }
      continue;
    }

    if (!positionChanged) continue;
    node.position({ x: object.x, y: object.y });
  }
}

export function restoreCorridorStageFromMap(stage: Konva.Stage, map: EventMapDTO, levelId: string) {
  for (const seat of map.seats) {
    if (seat.levelId !== levelId || !seat.publicVisible) continue;
    const node = stage.findOne(`#node-${seat.id}`);
    if (!node) continue;
    setSeatNodePosition(node, seat.x, seat.y);
    node.rotation(seat.rotation ?? 0);
    node.scaleX(1);
    node.scaleY(1);
  }

  for (const object of map.objects) {
    if (object.levelId !== levelId || object.hidden) continue;
    const node = stage.findOne(`#node-${object.id}`);
    if (!node) continue;

    if (object.type === 'CORRIDOR') {
      applyCorridorNodeFromModel(node, object);
      continue;
    }

    node.position({ x: object.x, y: object.y });
    node.rotation(object.rotation ?? 0);
    syncNodeSize(node, object.width ?? undefined, object.height ?? undefined);
    node.scaleX(1);
    node.scaleY(1);
  }
}
