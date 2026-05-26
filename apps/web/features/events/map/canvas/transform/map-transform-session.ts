import { MIN_OBJECT_SIZE, getObjectBounds } from '@alusa/domain';
import type { CorridorTransformPreviewPatch, ObjectTransformSnapshot } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../../api/event-map-service';
import {
  applyObjectTransformLivePreview,
  beginObjectTransformSession,
  readObjectTransformCommitFromNodes,
  readSeatGroupTransformFromNode,
  readSeatTransformFromNode,
  resolveLiveObjectTransformScale,
  resetNodeScale,
  type ObjectTransformSession,
} from '../adapters/konva-transform-adapter';
import { applyCorridorTransformLivePreview, beginCorridorTransformToolSession, buildCorridorTransformCommitPatches, resetCorridorTransformer } from '../corridor/corridor-transform-session';
import type { CorridorSnapCommitContext, CorridorTransformStageContext, CorridorTransformToolSession } from '../corridor/corridor-transform-session';

import Konva from 'konva';

import type { MapTransformSessionKind } from './transform-routing';

export type UniformTransformSession = ObjectTransformSession;

export type MapTransformSession = {
  kind: MapTransformSessionKind;
  corridor: CorridorTransformToolSession | null;
  objectTransform: ObjectTransformSession | null;
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectedSeatGroupIds: string[];
};

export type MapTransformStageContext = CorridorTransformStageContext & {
  snap?: CorridorSnapCommitContext;
};

export type MapTransformCommitResult = {
  objectUpdates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seatUpdates: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
  seatGroupUpdates: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }>;
  corridorPatches: CorridorTransformPreviewPatch[];
};

export function beginUniformTransformSession(
  map: EventMapDTO,
  selectedObjectIds: string[],
  stage: Konva.Stage,
  transformer: Konva.Transformer,
): UniformTransformSession | null {
  return beginObjectTransformSession(map, selectedObjectIds, stage, transformer);
}

export function beginMapTransformSession(input: {
  kind: MapTransformSessionKind;
  map: EventMapDTO;
  corridorIds: string[];
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectedSeatGroupIds: string[];
  stage: Konva.Stage;
  transformer: Konva.Transformer;
}): MapTransformSession | null {
  const { kind, map, corridorIds, selectedObjectIds, selectedSeatIds, selectedSeatGroupIds, stage, transformer } = input;

  if (kind === 'corridor') {
    const corridor = beginCorridorTransformToolSession(map, corridorIds, transformer, stage);
    if (!corridor) return null;
    return {
      kind,
      corridor,
      objectTransform: null,
      selectedObjectIds,
      selectedSeatIds,
      selectedSeatGroupIds,
    };
  }

  if (kind === 'uniform') {
    const objectTransform = beginObjectTransformSession(map, selectedObjectIds, stage, transformer);
    if (!objectTransform) return null;
    return {
      kind,
      corridor: null,
      objectTransform,
      selectedObjectIds,
      selectedSeatIds,
      selectedSeatGroupIds,
    };
  }

  const objectTransform = beginObjectTransformSession(map, selectedObjectIds, stage, transformer, {
    excludeCorridors: true,
  });
  if (!objectTransform && selectedSeatIds.length === 0 && selectedSeatGroupIds.length === 0) return null;

  return {
    kind: 'generic',
    corridor: null,
    objectTransform,
    selectedObjectIds,
    selectedSeatIds,
    selectedSeatGroupIds,
  };
}

function readNodeScale(stage: Konva.Stage, objectId: string) {
  const node = stage.findOne(`#node-${objectId}`);
  if (!node) return null;
  return { scaleX: node.scaleX(), scaleY: node.scaleY() };
}

export function applyMapTransformLivePreview(
  session: MapTransformSession,
  ctx: MapTransformStageContext,
) {
  const { stage, transformer } = ctx;

  if (session.kind === 'corridor' && session.corridor) {
    applyCorridorTransformLivePreview(session.corridor, ctx);
    transformer.forceUpdate();
    return;
  }

  if (session.objectTransform) {
    const scale = resolveLiveObjectTransformScale(session.objectTransform, (objectId) =>
      readNodeScale(stage, objectId),
    );
    applyObjectTransformLivePreview({ session: session.objectTransform, stage, transformer, scale });
    transformer.forceUpdate();
  }
}

export function buildMapTransformCommit(
  session: MapTransformSession,
  ctx: MapTransformStageContext,
  map: EventMapDTO,
): MapTransformCommitResult {
  const { stage, transformer } = ctx;
  const objectUpdates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seatUpdates: Array<{ id: string; patch: Partial<EventSeatDTO> }> = [];
  const seatGroupUpdates: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }> = [];
  let corridorPatches: CorridorTransformPreviewPatch[] = [];

  if (session.kind === 'corridor' && session.corridor) {
    corridorPatches = buildCorridorTransformCommitPatches(session.corridor, ctx, ctx.snap);
  } else if (session.objectTransform) {
    const scale = resolveLiveObjectTransformScale(session.objectTransform, (objectId) =>
      readNodeScale(stage, objectId),
    );
    applyObjectTransformLivePreview({ session: session.objectTransform, stage, transformer, scale });
    const selectedIds =
      session.kind === 'uniform' ? session.selectedObjectIds : [...session.objectTransform.snapshots.keys()];
    const updates = readObjectTransformCommitFromNodes(stage, session.objectTransform, selectedIds);
    for (const entry of updates) {
      objectUpdates.push({ id: entry.id, patch: entry.patch });
    }
  }

  for (const objectId of session.selectedObjectIds) {
    const object = map.objects.find((entry) => entry.id === objectId);
    const node = stage.findOne(`#node-${objectId}`);
    if (!object || !node || object.type === 'TEXT' || object.type === 'CORRIDOR') continue;
    if (session.kind === 'uniform' || session.kind === 'generic') continue;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const bounds = getObjectBounds(object);
    const x = node.x();
    const y = node.y();
    const width = Math.max(MIN_OBJECT_SIZE, bounds.width * Math.abs(scaleX || 1));
    const height = Math.max(MIN_OBJECT_SIZE, bounds.height * Math.abs(scaleY || 1));
    const rotation = node.rotation();

    resetNodeScale(node);

    if (![x, y, width, height, rotation].every(Number.isFinite)) continue;
    objectUpdates.push({ id: objectId, patch: { x, y, width, height, rotation } });
  }

  for (const seatId of session.selectedSeatIds) {
    const seat = map.seats.find((entry) => entry.id === seatId);
    const node = stage.findOne(`#node-${seatId}`);
    if (!seat || !node || seat.status === 'SOLD') continue;

    const patch = readSeatTransformFromNode(node, seat.size ?? 24);
    if (!patch) continue;
    seatUpdates.push({ id: seatId, patch });
  }

  for (const groupId of session.selectedSeatGroupIds) {
    const group = map.seatGroups?.find((entry) => entry.id === groupId);
    const node = stage.findOne(`#node-seatgroup-${groupId}`);
    if (!group || !node || group.locked) continue;

    const patch = readSeatGroupTransformFromNode(node, group);
    if (!patch) continue;
    seatGroupUpdates.push({ id: groupId, patch });
  }

  return { objectUpdates, seatUpdates, seatGroupUpdates, corridorPatches };
}

export function resetMapTransformTransformer(session: MapTransformSession, transformer: Konva.Transformer) {
  if (session.kind === 'corridor') {
    resetCorridorTransformer(transformer);
  }
}

export type { ObjectTransformSnapshot };
