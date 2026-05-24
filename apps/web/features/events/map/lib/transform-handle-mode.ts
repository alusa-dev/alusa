import {
  isCornerResizeAnchor,
  isEdgeResizeAnchor,
  resolveCorridorResizeMode,
  shouldUseUniformGroupScale,
  type CorridorResizeMode,
} from './corridor-resize-mode';

export type TransformHandleMode =
  | 'rotate'
  | 'edge'
  | 'corner'
  | 'corner-group'
  | 'uniform-scale';

export type TransformerScaleOptions = {
  keepRatio: boolean;
  centeredScaling: boolean;
  handleMode: TransformHandleMode;
  resizeMode: CorridorResizeMode | null;
};

export function resolveHandleMode(anchor: string, corridorCount: number): TransformHandleMode {
  if (anchor === 'rotater') return 'rotate';
  if (corridorCount >= 2 && isCornerResizeAnchor(anchor)) return 'corner-group';
  if (isEdgeResizeAnchor(anchor)) return 'edge';
  if (isCornerResizeAnchor(anchor)) return 'corner';
  return 'corner';
}

export function resolveCorridorTransformerScaleOptions(anchor: string, corridorCount: number): TransformerScaleOptions {
  const handleMode = resolveHandleMode(anchor, corridorCount);
  const uniform = shouldUseUniformGroupScale(anchor, corridorCount);

  return {
    keepRatio: uniform,
    centeredScaling: uniform,
    handleMode,
    resizeMode: anchor === 'rotater' ? null : resolveCorridorResizeMode(anchor),
  };
}

export function resolveUniformTransformerScaleOptions(): TransformerScaleOptions {
  return {
    keepRatio: true,
    centeredScaling: true,
    handleMode: 'uniform-scale',
    resizeMode: null,
  };
}

export function resolveGenericTransformerScaleOptions(shiftKey: boolean): TransformerScaleOptions {
  return {
    keepRatio: shiftKey,
    centeredScaling: false,
    handleMode: 'uniform-scale',
    resizeMode: null,
  };
}

export const DEFAULT_TRANSFORMER_SCALE_OPTIONS: TransformerScaleOptions = {
  keepRatio: false,
  centeredScaling: false,
  handleMode: 'corner',
  resizeMode: null,
};
