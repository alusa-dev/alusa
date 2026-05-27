import {
  clampFontSizeValue,
  getTextMode,
  isCornerResizeAnchor,
  isHorizontalResizeAnchor,
  isVerticalResizeAnchor,
} from '../doc/text-object.js';
import { MIN_OBJECT_SIZE } from '../operations/transform/uniform-transform.js';
import type { EventMapObjectDTO } from '../types/event-map-types.js';

export type TextTransformInput = {
  scaleX: number;
  scaleY: number;
  anchor: string;
  x: number;
  y: number;
  rotation: number;
  nodeWidth?: number;
  nodeHeight?: number;
};

export function buildTextTransformPatch(
  object: EventMapObjectDTO,
  input: TextTransformInput,
): Partial<EventMapObjectDTO> {
  const { scaleX, scaleY, anchor, x, y, rotation, nodeWidth, nodeHeight } = input;
  const mode = getTextMode(object);
  const currentFontSize = Number(object.data.fontSize ?? 22);

  if (mode === 'auto' || isCornerResizeAnchor(anchor) || !anchor) {
    const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
    return {
      x,
      y,
      width: null,
      height: null,
      rotation,
      data: {
        ...object.data,
        textMode: 'auto',
        fontSize: clampFontSizeValue(currentFontSize * uniformScale),
      },
    };
  }

  if (mode === 'fixed-width') {
    if (isHorizontalResizeAnchor(anchor)) {
      return {
        x,
        y,
        width: Math.max(MIN_OBJECT_SIZE, (object.width ?? nodeWidth ?? 160) * scaleX),
        height: null,
        rotation,
        data: { ...object.data, textMode: 'fixed-width' },
      };
    }

    const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
    return {
      x,
      y,
      width: Math.max(MIN_OBJECT_SIZE, (object.width ?? nodeWidth ?? 160) * scaleX),
      height: null,
      rotation,
      data: {
        ...object.data,
        textMode: 'fixed-width',
        fontSize: clampFontSizeValue(currentFontSize * uniformScale),
      },
    };
  }

  if (isHorizontalResizeAnchor(anchor)) {
    return {
      x,
      y,
      width: Math.max(MIN_OBJECT_SIZE, (object.width ?? nodeWidth ?? 160) * scaleX),
      height: object.height,
      rotation,
      data: { ...object.data, textMode: 'area' },
    };
  }

  if (isVerticalResizeAnchor(anchor)) {
    return {
      x,
      y,
      width: object.width,
      height: Math.max(MIN_OBJECT_SIZE, (object.height ?? nodeHeight ?? 60) * scaleY),
      rotation,
      data: { ...object.data, textMode: 'area' },
    };
  }

  const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
  return {
    x,
    y,
    width: Math.max(MIN_OBJECT_SIZE, (object.width ?? nodeWidth ?? 160) * scaleX),
    height: Math.max(MIN_OBJECT_SIZE, (object.height ?? nodeHeight ?? 60) * scaleY),
    rotation,
    data: {
      ...object.data,
      textMode: 'area',
      fontSize: clampFontSizeValue(currentFontSize * uniformScale),
    },
  };
}

export function buildShapeTransformPatch(
  object: EventMapObjectDTO,
  input: Pick<TextTransformInput, 'scaleX' | 'scaleY' | 'x' | 'y' | 'rotation'>,
): Partial<EventMapObjectDTO> {
  const nextWidth = Math.max(MIN_OBJECT_SIZE, (object.width ?? 100) * input.scaleX);
  const nextHeight = Math.max(MIN_OBJECT_SIZE, (object.height ?? 60) * input.scaleY);
  return {
    x: input.x,
    y: input.y,
    width: nextWidth,
    height: nextHeight,
    rotation: input.rotation,
  };
}
