import { MIN_OBJECT_SIZE, MIN_UNIFORM_SCALE, buildUniformTransformUpdates, clampFontSize, clampObjectSize, clampUniformScale, computeUniformTransformPatch, getObjectBounds, getObjectTransformSnapshot, getSnapshotsUnionBounds, resolveLiveUniformScale } from '@alusa/domain';
import type { CorridorTransformPreviewPatch, ObjectTransformSnapshot } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';
import { applyCorridorTransformLivePreview, beginCorridorTransformToolSession, buildCorridorTransformCommitPatches, resetCorridorTransformer } from './corridor-transform-session';
import type { CorridorSnapCommitContext, CorridorTransformStageContext, CorridorTransformToolSession } from './corridor-transform-session';
import { applyGenericGroupTransform, beginGenericTransformSession, readGenericTransformCommitFromNodes, resolveLiveGenericScale } from './generic-group-transform';
import type { GenericTransformSession } from './generic-group-transform';

import Konva from 'konva';

export type MapTransformKind = 'corridor' | 'uniform' | 'generic';

export type UniformTransformSession = {
  snapshots: Map<string, ObjectTransformSnapshot>;
  initialBounds: ReturnType<typeof getSnapshotsUnionBounds>;
  initialRotation: number;
};

export type MapTransformSession = {
  kind: MapTransformKind;
  corridor: CorridorTransformToolSession | null;
  uniform: UniformTransformSession | null;
  generic: GenericTransformSession | null;
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

function readUniformTransformCommitFromNodes(
  stage: Konva.Stage,
  session: UniformTransformSession,
  selectedIds: string[],
) {
  const updates: Array<{ id: string; patch: ReturnType<typeof computeUniformTransformPatch> }> = [];

  for (const objectId of selectedIds) {
    const snapshot = session.snapshots.get(objectId);
    const node = stage.findOne(`#node-${objectId}`);
    if (!snapshot || !node) continue;

    if (snapshot.type === 'TEXT') {
      const textNode = node as Konva.Text;
      const fontSize = clampFontSize(textNode.fontSize());
      updates.push({
        id: objectId,
        patch: {
          x: textNode.x(),
          y: textNode.y(),
          rotation: textNode.rotation(),
          width:
            snapshot.textMode === 'multiline' && textNode.width() > 0
              ? clampObjectSize(textNode.width())
              : null,
          height:
            snapshot.textMode === 'multiline' && textNode.height() > 0
              ? clampObjectSize(textNode.height())
              : null,
          data: { fontSize },
        },
      });
      continue;
    }

    const scale = clampUniformScale(Math.max(Math.abs(node.scaleX()), Math.abs(node.scaleY()), MIN_UNIFORM_SCALE));
    updates.push({
      id: objectId,
      patch: {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: clampObjectSize(snapshot.width * scale),
        height: clampObjectSize(snapshot.height * scale),
      },
    });
  }

  return updates;
}

function applyUniformGroupTransform({
  session,
  stage,
  transformer,
  scale,
}: {
  session: UniformTransformSession;
  stage: Konva.Stage;
  transformer: Konva.Transformer;
  scale: number;
}) {
  const rotationDelta = transformer.rotation() - session.initialRotation;
  const updates = buildUniformTransformUpdates(
    session.snapshots,
    session.initialBounds.centerX,
    session.initialBounds.centerY,
    scale,
    rotationDelta,
  );

  for (const entry of updates) {
    const snapshot = session.snapshots.get(entry.id);
    const node = stage.findOne(`#node-${entry.id}`);
    if (!snapshot || !node) continue;

    node.x(entry.patch.x);
    node.y(entry.patch.y);
    node.rotation(entry.patch.rotation ?? 0);

    if (node instanceof Konva.Text) {
      node.scaleX(1);
      node.scaleY(1);
      if (snapshot.textMode === 'multiline' && typeof entry.patch.width === 'number') {
        node.width(entry.patch.width);
        node.wrap('word');
      } else {
        node.width(undefined);
        node.wrap('none');
      }
      const fontSize = entry.patch.data?.fontSize;
      if (typeof fontSize === 'number') node.fontSize(fontSize);
      continue;
    }

    node.scaleX(scale);
    node.scaleY(scale);
  }
}

export function beginUniformTransformSession(
  map: EventMapDTO,
  selectedObjectIds: string[],
  stage: Konva.Stage,
  transformer: Konva.Transformer,
): UniformTransformSession | null {
  const snapshots = new Map<string, ObjectTransformSnapshot>();

  for (const objectId of selectedObjectIds) {
    const object = map.objects.find((entry) => entry.id === objectId);
    if (!object) continue;
    snapshots.set(objectId, getObjectTransformSnapshot(object));

    const node = stage.findOne(`#node-${objectId}`);
    if (node) {
      node.scaleX(1);
      node.scaleY(1);
    }
  }

  if (snapshots.size === 0) return null;

  return {
    snapshots,
    initialBounds: getSnapshotsUnionBounds([...snapshots.values()]),
    initialRotation: transformer.rotation(),
  };
}

export function beginMapTransformSession(input: {
  kind: MapTransformKind;
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
      uniform: null,
      generic: null,
      selectedObjectIds,
      selectedSeatIds,
      selectedSeatGroupIds,
    };
  }

  if (kind === 'uniform') {
    const uniform = beginUniformTransformSession(map, selectedObjectIds, stage, transformer);
    if (!uniform) return null;
    return {
      kind,
      corridor: null,
      uniform,
      generic: null,
      selectedObjectIds,
      selectedSeatIds,
      selectedSeatGroupIds,
    };
  }

  const generic = beginGenericTransformSession(map, selectedObjectIds, stage, transformer);
  if (!generic && selectedSeatIds.length === 0 && selectedSeatGroupIds.length === 0) return null;

  return {
    kind: 'generic',
    corridor: null,
    uniform: null,
    generic,
    selectedObjectIds,
    selectedSeatIds,
    selectedSeatGroupIds,
  };
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

  if (session.kind === 'uniform' && session.uniform) {
    const scale = resolveLiveUniformScale(session.uniform.snapshots, (objectId) => {
      const node = stage.findOne(`#node-${objectId}`);
      if (!node) return null;
      return { scaleX: node.scaleX(), scaleY: node.scaleY() };
    });
    applyUniformGroupTransform({ session: session.uniform, stage, transformer, scale });
    transformer.forceUpdate();
    return;
  }

  if (session.kind === 'generic' && session.generic) {
    const scale = resolveLiveGenericScale(session.generic, (objectId) => {
      const node = stage.findOne(`#node-${objectId}`);
      if (!node) return null;
      return { scaleX: node.scaleX(), scaleY: node.scaleY() };
    });
    applyGenericGroupTransform({ session: session.generic, stage, transformer, scale });
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
  } else if (session.kind === 'uniform' && session.uniform) {
    const scale = resolveLiveUniformScale(session.uniform.snapshots, (objectId) => {
      const node = stage.findOne(`#node-${objectId}`);
      if (!node) return null;
      return { scaleX: node.scaleX(), scaleY: node.scaleY() };
    });
    applyUniformGroupTransform({ session: session.uniform, stage, transformer, scale });
    const updates = readUniformTransformCommitFromNodes(stage, session.uniform, session.selectedObjectIds);
    for (const entry of updates) {
      objectUpdates.push({ id: entry.id, patch: entry.patch });
    }
  } else if (session.kind === 'generic' && session.generic) {
    const scale = resolveLiveGenericScale(session.generic, (objectId) => {
      const node = stage.findOne(`#node-${objectId}`);
      if (!node) return null;
      return { scaleX: node.scaleX(), scaleY: node.scaleY() };
    });
    applyGenericGroupTransform({ session: session.generic, stage, transformer, scale });
    const updates = readGenericTransformCommitFromNodes(stage, session.generic);
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
    const width = clampObjectSize(bounds.width * Math.abs(scaleX || 1));
    const height = clampObjectSize(bounds.height * Math.abs(scaleY || 1));
    const rotation = node.rotation();

    node.scaleX(1);
    node.scaleY(1);

    if (![x, y, width, height, rotation].every(Number.isFinite)) continue;
    objectUpdates.push({ id: objectId, patch: { x, y, width, height, rotation } });
  }

  for (const seatId of session.selectedSeatIds) {
    const seat = map.seats.find((entry) => entry.id === seatId);
    const node = stage.findOne(`#node-${seatId}`);
    if (!seat || !node || seat.status === 'SOLD') continue;

    const scale = Math.max(Math.abs(node.scaleX() || 1), Math.abs(node.scaleY() || 1));
    const x = node.x();
    const y = node.y();
    const size = Math.max(MIN_OBJECT_SIZE, (seat.size ?? 24) * scale);
    const rotation = node.rotation();

    node.scaleX(1);
    node.scaleY(1);

    if (![x, y, size, rotation].every(Number.isFinite)) continue;
    seatUpdates.push({ id: seatId, patch: { x, y, size, rotation } });
  }

  for (const groupId of session.selectedSeatGroupIds) {
    const group = map.seatGroups?.find((entry) => entry.id === groupId);
    const node = stage.findOne(`#node-seatgroup-${groupId}`);
    if (!group || !node || group.locked) continue;

    const scaleX = Math.abs(node.scaleX() || 1);
    const scaleY = Math.abs(node.scaleY() || 1);
    const x = node.x();
    const y = node.y();
    const rotation = node.rotation();
    node.scaleX(1);
    node.scaleY(1);

    if (![x, y, rotation, scaleX, scaleY].every(Number.isFinite)) continue;
    seatGroupUpdates.push({
      id: groupId,
      patch: {
        x,
        y,
        rotation,
        seatWidth: Math.max(MIN_OBJECT_SIZE, group.seatWidth * scaleX),
        seatHeight: Math.max(MIN_OBJECT_SIZE, group.seatHeight * scaleY),
        gapX: Math.max(0, group.gapX * scaleX),
        gapY: Math.max(0, group.gapY * scaleY),
        paddingLeft: Math.max(0, group.paddingLeft * scaleX),
        paddingRight: Math.max(0, group.paddingRight * scaleX),
        paddingTop: Math.max(0, group.paddingTop * scaleY),
        paddingBottom: Math.max(0, group.paddingBottom * scaleY),
      },
    });
  }

  return { objectUpdates, seatUpdates, seatGroupUpdates, corridorPatches };
}

export function resetMapTransformTransformer(session: MapTransformSession, transformer: Konva.Transformer) {
  if (session.kind === 'corridor') {
    resetCorridorTransformer(transformer);
  }
}
