import { MIN_OBJECT_SIZE, findMapBlockOwner, findMapRowOwner, getObjectBounds, shortestRotationDelta } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../../api/event-map-service';
import {
  applyObjectTransformLivePreview,
  beginObjectTransformSession,
  readObjectTransformCommitFromNodes,
  readSeatTransformFromNode,
  resolveLiveObjectTransformScale,
  resetNodeScale,
  type ObjectTransformSession,
} from '../adapters/konva-transform-adapter';
import Konva from 'konva';
import type { MapTransformSessionKind } from './transform-routing';
import type { MapSelectionItem } from '@alusa/domain';

export type UniformTransformSession = ObjectTransformSession;

export type MapTransformSession = {
  kind: MapTransformSessionKind;
  transformAnchor: string;
  initialTransformerRotation: number;
  objectTransform: ObjectTransformSession | null;
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  parametricItems: Array<Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }>>;
  initialParametricTransforms: Map<string, Konva.Transform>;
  parametricPreviewSnapshots: ParametricPreviewSnapshot[];
};

type ParametricPreviewSnapshot = {
  itemKey: string;
  id: string;
  kind: 'seat' | 'line' | 'label';
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  points?: number[];
};

export type MapTransformStageContext = { stage: Konva.Stage; transformer: Konva.Transformer };

export type MapTransformCommitResult = {
  objectUpdates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seatUpdates: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
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
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  parametricItems?: Array<Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }>>;
  stage: Konva.Stage;
  transformer: Konva.Transformer;
}): MapTransformSession | null {
  const objectTransform = beginObjectTransformSession(input.map, input.selectedObjectIds, input.stage, input.transformer);
  const parametricItems = input.parametricItems ?? [];
  const initialParametricTransforms = new Map<string, Konva.Transform>();
  const parametricPreviewSnapshots: ParametricPreviewSnapshot[] = [];
  const capturedNodes = new Set<string>();
  if (input.map.document) {
    for (const item of parametricItems) {
      const itemKey = `${item.type}:${item.id}`;
      const proxy = input.stage.findOne(`#node-${item.type}-${item.id}`);
      if (proxy) initialParametricTransforms.set(itemKey, proxy.getTransform().copy());
      const owner = item.type === 'seatblock'
        ? findMapBlockOwner(input.map.document, item.id)
        : findMapRowOwner(input.map.document, item.id);
      const rows = owner
        ? (item.type === 'seatblock' ? owner.block.rows : owner.block.rows.filter((row) => row.id === item.id))
        : [];
    for (const row of rows) {
      for (const seatId of row.seatIds) {
        if (capturedNodes.has(`node-${seatId}`)) continue;
        const node = input.stage.findOne(`#node-${seatId}`);
        if (node) {
          capturedNodes.add(`node-${seatId}`);
          parametricPreviewSnapshots.push({ itemKey, id: `node-${seatId}`, kind: 'seat', x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() });
        }
      }
      for (const [id, kind] of [[`node-seatrow-line-${row.id}`, 'line'], [`node-seatrow-label-${row.id}`, 'label']] as const) {
        if (capturedNodes.has(id)) continue;
        const node = input.stage.findOne(`#${id}`);
        if (!node) continue;
        capturedNodes.add(id);
        parametricPreviewSnapshots.push({
          itemKey,
          id,
          kind,
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
          ...(kind === 'line' ? { points: (node as Konva.Line).points() } : {}),
        });
      }
    }
    }
  }
  if (!objectTransform && input.selectedSeatIds.length === 0 && initialParametricTransforms.size === 0) return null;
  return {
    kind: input.kind,
    transformAnchor: input.transformer.getActiveAnchor() ?? '',
    initialTransformerRotation: input.transformer.rotation(),
    objectTransform,
    selectedObjectIds: input.selectedObjectIds,
    selectedSeatIds: input.selectedSeatIds,
    parametricItems,
    initialParametricTransforms,
    parametricPreviewSnapshots,
  };
}

export function isSemanticGenericRotation(session: MapTransformSession | null) {
  return session?.kind === 'generic' && session.transformAnchor === 'rotater';
}

function readNodeScale(stage: Konva.Stage, objectId: string) {
  const node = stage.findOne(`#node-${objectId}`);
  if (!node) return null;
  return { scaleX: node.scaleX(), scaleY: node.scaleY() };
}

export function applyMapTransformLivePreview(session: MapTransformSession, ctx: MapTransformStageContext) {
  if (session.parametricItems.length > 0 && session.initialParametricTransforms.size > 0) {
    for (const item of session.parametricItems) {
      const itemKey = `${item.type}:${item.id}`;
      const initialTransform = session.initialParametricTransforms.get(itemKey);
      const proxy = ctx.stage.findOne(`#node-${item.type}-${item.id}`);
      if (!proxy || !initialTransform) continue;
      const delta = proxy.getTransform().copy().multiply(initialTransform.copy().invert()).getMatrix();
      const [a, b, c, d, e, f] = delta;
      const scale = Math.hypot(a ?? 1, b ?? 0);
      const rotation = Math.atan2(b ?? 0, a ?? 1) * (180 / Math.PI);
      for (const snapshot of session.parametricPreviewSnapshots.filter((entry) => entry.itemKey === itemKey)) {
        const node = ctx.stage.findOne(`#${snapshot.id}`);
        if (!node) continue;
        const transformPoint = (x: number, y: number) => ({ x: (a ?? 1) * x + (c ?? 0) * y + (e ?? 0), y: (b ?? 0) * x + (d ?? 1) * y + (f ?? 0) });
      if (snapshot.kind === 'line' && snapshot.points) {
        const points: number[] = [];
        for (let index = 0; index < snapshot.points.length; index += 2) {
          const point = transformPoint(snapshot.points[index]!, snapshot.points[index + 1]!);
          points.push(point.x, point.y);
        }
        node.position({ x: 0, y: 0 });
        (node as Konva.Line).points(points);
      } else {
        const point = transformPoint(snapshot.x, snapshot.y);
        node.position(point);
        if (snapshot.kind === 'seat') {
          node.rotation(snapshot.rotation + rotation);
          node.scaleX(snapshot.scaleX * scale);
          node.scaleY(snapshot.scaleY * scale);
        }
      }
    }
    }
    ctx.transformer.forceUpdate();
    return;
  }
  if (!session.objectTransform) return;
  if (session.kind === 'generic') {
    ctx.transformer.forceUpdate();
    return;
  }
  const scale = resolveLiveObjectTransformScale(session.objectTransform, (objectId) => readNodeScale(ctx.stage, objectId));
  applyObjectTransformLivePreview({ session: session.objectTransform, stage: ctx.stage, transformer: ctx.transformer, scale });
  ctx.transformer.forceUpdate();
}

export function restoreParametricLivePreview(session: MapTransformSession, stage: Konva.Stage) {
  for (const snapshot of session.parametricPreviewSnapshots) {
    const node = stage.findOne(`#${snapshot.id}`);
    if (!node) continue;
    node.position({ x: snapshot.x, y: snapshot.y });
    node.rotation(snapshot.rotation);
    node.scaleX(snapshot.scaleX);
    node.scaleY(snapshot.scaleY);
    if (snapshot.kind === 'line' && snapshot.points) (node as Konva.Line).points(snapshot.points);
  }
}

export function resetParametricPreviewScales(session: MapTransformSession, stage: Konva.Stage) {
  for (const snapshot of session.parametricPreviewSnapshots) {
    if (snapshot.kind !== 'seat') continue;
    const node = stage.findOne(`#${snapshot.id}`);
    if (!node) continue;
    node.scaleX(snapshot.scaleX);
    node.scaleY(snapshot.scaleY);
  }
}

export function buildMapTransformCommit(
  session: MapTransformSession,
  ctx: MapTransformStageContext,
  map: EventMapDTO,
): MapTransformCommitResult {
  const objectUpdates: MapTransformCommitResult['objectUpdates'] = [];
  const seatUpdates: MapTransformCommitResult['seatUpdates'] = [];

  if (session.objectTransform) {
    if (session.kind === 'generic') {
      objectUpdates.push(
        ...readObjectTransformCommitFromNodes(ctx.stage, session.objectTransform, [...session.objectTransform.snapshots.keys()], {
          scaleMode: 'independent',
        }).map((entry) => ({ id: entry.id, patch: entry.patch })),
      );
    } else {
      const scale = resolveLiveObjectTransformScale(session.objectTransform, (objectId) => readNodeScale(ctx.stage, objectId));
      applyObjectTransformLivePreview({ session: session.objectTransform, stage: ctx.stage, transformer: ctx.transformer, scale });
      const selectedIds = session.kind === 'uniform' ? session.selectedObjectIds : [...session.objectTransform.snapshots.keys()];
      objectUpdates.push(
        ...readObjectTransformCommitFromNodes(ctx.stage, session.objectTransform, selectedIds).map((entry) => ({
          id: entry.id,
          patch: entry.patch,
        })),
      );
    }
  }

  for (const objectId of session.selectedObjectIds) {
    const object = map.objects.find((entry) => entry.id === objectId);
    const node = ctx.stage.findOne(`#node-${objectId}`);
    if (!object || !node || object.type === 'TEXT' || session.kind !== 'generic') continue;
    const bounds = getObjectBounds(object);
    const x = node.x();
    const y = node.y();
    const width = Math.max(MIN_OBJECT_SIZE, bounds.width * Math.abs(node.scaleX() || 1));
    const height = Math.max(MIN_OBJECT_SIZE, bounds.height * Math.abs(node.scaleY() || 1));
    const rotation = node.rotation();
    resetNodeScale(node);
    if ([x, y, width, height, rotation].every(Number.isFinite)) objectUpdates.push({ id: objectId, patch: { x, y, width, height, rotation } });
  }

  for (const seatId of session.selectedSeatIds) {
    const seat = map.seats.find((entry) => entry.id === seatId);
    const node = ctx.stage.findOne(`#node-${seatId}`);
    if (!seat || !node || seat.status === 'SOLD') continue;
    const patch = readSeatTransformFromNode(node, seat.size ?? 24);
    if (patch) seatUpdates.push({ id: seatId, patch });
  }

  return { objectUpdates, seatUpdates };
}

export function resetMapTransformTransformer(session: MapTransformSession, transformer: Konva.Transformer) {
  if (isSemanticGenericRotation(session)) transformer.rotation(0);
  transformer.forceUpdate();
}

export { shortestRotationDelta };
