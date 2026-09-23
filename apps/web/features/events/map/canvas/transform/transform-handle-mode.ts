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
  resizeMode: 'edge' | 'corner' | null;
};

export function resolveHandleMode(anchor: string, _selectionCount = 0): TransformHandleMode {
  if (anchor === 'rotater') return 'rotate';
  if (anchor === 'middle-left' || anchor === 'middle-right' || anchor === 'top-center' || anchor === 'bottom-center') return 'edge';
  return 'corner';
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
