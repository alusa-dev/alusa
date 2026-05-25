import type { EventMapObjectDTO } from '../types/event-map-types.js';

export type TextMode = 'auto' | 'fixed-width' | 'area';

export const TEXT_MODE_LABELS: Record<TextMode, string> = {
  auto: 'Auto',
  'fixed-width': 'Largura fixa',
  area: 'Área fixa',
};

export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 512;
export const DEFAULT_FONT_SIZE = 22;

export const TEXT_CORNER_ANCHORS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;

export const TEXT_FIXED_WIDTH_ANCHORS = [
  ...TEXT_CORNER_ANCHORS,
  'middle-left',
  'middle-right',
] as const;

export const TEXT_AREA_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export function clampFontSizeValue(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value));
}

export function getTextMode(object: Pick<EventMapObjectDTO, 'width' | 'height' | 'data'>): TextMode {
  const stored = object.data?.textMode;
  if (stored === 'auto' || stored === 'fixed-width' || stored === 'area') {
    return stored;
  }

  const width = object.width;
  const height = object.height;
  if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
    return 'area';
  }
  if (typeof width === 'number' && width > 0) {
    return 'fixed-width';
  }
  return 'auto';
}

/** @deprecated Use getTextMode(object) === 'area' */
export function isMultilineTextObject(object: Pick<EventMapObjectDTO, 'width' | 'height' | 'data'>) {
  return getTextMode(object) === 'area';
}

export function isTextBoxMode(object: Pick<EventMapObjectDTO, 'width' | 'height' | 'data'>) {
  const mode = getTextMode(object);
  return mode === 'fixed-width' || mode === 'area';
}

export function getTextModeFromCreation(width: number | null, height: number | null): TextMode {
  if (width && height) return 'area';
  if (width) return 'fixed-width';
  return 'auto';
}

export function getTextDimensionsForMode(
  mode: TextMode,
  width?: number | null,
  height?: number | null,
): { width: number | null; height: number | null } {
  if (mode === 'auto') return { width: null, height: null };
  if (mode === 'fixed-width') {
    return { width: typeof width === 'number' && width > 0 ? width : 160, height: null };
  }
  return {
    width: typeof width === 'number' && width > 0 ? width : 160,
    height: typeof height === 'number' && height > 0 ? height : 60,
  };
}

export function getTextWrap(mode: TextMode): 'none' | 'word' {
  return mode === 'auto' ? 'none' : 'word';
}

export function getLegacyUniformTextMode(mode: TextMode): 'single-line' | 'multiline' {
  return mode === 'area' ? 'multiline' : 'single-line';
}

export function getTextResizeAnchors(mode: TextMode): readonly string[] {
  if (mode === 'auto') return TEXT_CORNER_ANCHORS;
  if (mode === 'fixed-width') return TEXT_FIXED_WIDTH_ANCHORS;
  return TEXT_AREA_ANCHORS;
}

export function isCornerResizeAnchor(anchor: string) {
  return (TEXT_CORNER_ANCHORS as readonly string[]).includes(anchor);
}

export function isHorizontalResizeAnchor(anchor: string) {
  return anchor === 'middle-left' || anchor === 'middle-right';
}

export function isVerticalResizeAnchor(anchor: string) {
  return anchor === 'top-center' || anchor === 'bottom-center';
}

export function getTextDecorationParts(data: Record<string, unknown>) {
  const underline = Boolean(data.underline) || data.textDecoration === 'underline';
  const lineThrough = Boolean(data.lineThrough) || data.textDecoration === 'line-through';
  return { underline, lineThrough };
}

export function getTextDecorationValue(data: Record<string, unknown>): string | undefined {
  const { underline, lineThrough } = getTextDecorationParts(data);
  if (underline && lineThrough) return 'underline line-through';
  if (underline) return 'underline';
  if (lineThrough) return 'line-through';
  return undefined;
}

export function buildTextFontStyle(data: Record<string, unknown>) {
  const weight = data.fontWeight === 'bold' ? 'bold' : 'normal';
  const style = data.italic ? 'italic' : '';
  return `${weight} ${style}`.trim();
}

export function measureTextWidth(
  text: string,
  fontSize: number,
  options?: {
    fontFamily?: string;
    fontWeight?: string;
    letterSpacing?: number;
  },
): number {
  const fontFamily = options?.fontFamily ?? 'Inter, sans-serif';
  const fontWeight = options?.fontWeight ?? 'normal';
  const letterSpacing = options?.letterSpacing ?? 0;
  const familyFactor = fontFamily.toLowerCase().includes('mono') ? 0.62 : 0.55;
  const weightFactor = fontWeight === 'bold' ? 1.08 : 1;

  const lines = text.split('\n');
  let maxWidth = fontSize;
  for (const line of lines) {
    const measured = (line || ' ').length * fontSize * familyFactor * weightFactor;
    maxWidth = Math.max(maxWidth, measured + letterSpacing * Math.max(0, line.length - 1));
  }
  return maxWidth;
}

export function normalizeTextData(data: Record<string, unknown>) {
  return {
    ...data,
    fontSize: clampFontSizeValue(Number(data.fontSize ?? DEFAULT_FONT_SIZE)),
    lineHeight: Number.isFinite(Number(data.lineHeight)) ? Number(data.lineHeight) : 1.2,
    letterSpacing: Number.isFinite(Number(data.letterSpacing)) ? Number(data.letterSpacing) : 0,
  };
}

export function applyTextModePatch(
  mode: TextMode,
  current: Pick<EventMapObjectDTO, 'width' | 'height' | 'data'>,
): Partial<EventMapObjectDTO> {
  const dims = getTextDimensionsForMode(mode, current.width, current.height);
  return {
    width: dims.width,
    height: dims.height,
    data: { ...current.data, textMode: mode },
  };
}
