import {
  MIN_OBJECT_SIZE,
  clampFontSize,
  getTextMode,
  isCornerResizeAnchor,
  isHorizontalResizeAnchor,
  isVerticalResizeAnchor,
} from '@alusa/domain';
import type Konva from 'konva';
import type { EventMapObjectDTO } from '../api/event-map-service';

export type ObjectTransformRoutingFlags = {
  useUniformGroupTransform: boolean;
  useGenericTransform: boolean;
  useCorridorTransformerPipeline: boolean;
};

export type CommitObjectTransformParams = {
  object: EventMapObjectDTO;
  node: Konva.Node;
  transformer: Konva.Transformer | null;
  routing: ObjectTransformRoutingFlags;
  updateObject: (id: string, patch: Partial<EventMapObjectDTO>) => void;
  lastTransformCommitRef: { current: Map<string, { x: number; y: number }> };
};

export function commitObjectTransform({
  object,
  node,
  transformer,
  routing,
  updateObject,
  lastTransformCommitRef,
}: CommitObjectTransformParams) {
  const { useUniformGroupTransform, useGenericTransform, useCorridorTransformerPipeline } = routing;

  if (
    useUniformGroupTransform ||
    useGenericTransform ||
    (object.type === 'CORRIDOR' && useCorridorTransformerPipeline)
  ) {
    node.scaleX(1);
    node.scaleY(1);
    return;
  }

  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    node.scaleX(1);
    node.scaleY(1);
    return;
  }

  if (object.type === 'TEXT') {
    const mode = getTextMode(object);
    const anchor = transformer?.getActiveAnchor() ?? '';
    const currentFontSize = Number(object.data.fontSize ?? 22);
    node.scaleX(1);
    node.scaleY(1);
    const x = node.x();
    const y = node.y();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    lastTransformCommitRef.current.set(object.id, { x, y });
    const rotation = node.rotation();

    if (mode === 'auto' || isCornerResizeAnchor(anchor) || !anchor) {
      const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
      updateObject(object.id, {
        x,
        y,
        width: null,
        height: null,
        rotation,
        data: {
          ...object.data,
          textMode: 'auto',
          fontSize: clampFontSize(currentFontSize * uniformScale),
        },
      });
      return;
    }

    if (mode === 'fixed-width') {
      if (isHorizontalResizeAnchor(anchor)) {
        updateObject(object.id, {
          x,
          y,
          width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
          height: null,
          rotation,
          data: { ...object.data, textMode: 'fixed-width' },
        });
        return;
      }

      const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
      updateObject(object.id, {
        x,
        y,
        width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
        height: null,
        rotation,
        data: {
          ...object.data,
          textMode: 'fixed-width',
          fontSize: clampFontSize(currentFontSize * uniformScale),
        },
      });
      return;
    }

    if (isHorizontalResizeAnchor(anchor)) {
      updateObject(object.id, {
        x,
        y,
        width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
        height: object.height,
        rotation,
        data: { ...object.data, textMode: 'area' },
      });
      return;
    }

    if (isVerticalResizeAnchor(anchor)) {
      updateObject(object.id, {
        x,
        y,
        width: object.width,
        height: Math.max(MIN_OBJECT_SIZE, (object.height ?? node.height() ?? 60) * scaleY),
        rotation,
        data: { ...object.data, textMode: 'area' },
      });
      return;
    }

    const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
    updateObject(object.id, {
      x,
      y,
      width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
      height: Math.max(MIN_OBJECT_SIZE, (object.height ?? node.height() ?? 60) * scaleY),
      rotation,
      data: {
        ...object.data,
        textMode: 'area',
        fontSize: clampFontSize(currentFontSize * uniformScale),
      },
    });
    return;
  }

  const nextWidth = Math.max(MIN_OBJECT_SIZE, (object.width ?? 100) * scaleX);
  const nextHeight = Math.max(MIN_OBJECT_SIZE, (object.height ?? 60) * scaleY);
  node.scaleX(1);
  node.scaleY(1);
  const x = node.x();
  const y = node.y();
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
    return;
  }
  lastTransformCommitRef.current.set(object.id, { x, y });
  updateObject(object.id, {
    x,
    y,
    width: nextWidth,
    height: nextHeight,
    rotation: node.rotation(),
  });
}
