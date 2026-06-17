import type { EventMapObjectDTO } from '../types/event-map-types.js';
import { clampFontSizeValue, getTextMode, measureTextWidth } from './text-object.js';

export type PublicTextObjectLike = Pick<EventMapObjectDTO, 'width' | 'height' | 'data'>;

function wrapLine(
  line: string,
  maxWidth: number,
  fontSize: number,
  options: { fontFamily: string; fontWeight: string; letterSpacing: number },
) {
  const words = line.split(/(\s+)/).filter((part) => part.length > 0);
  if (words.length === 0) return [''];

  const wrapped: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current}${word}` : word;
    const width = measureTextWidth(candidate, fontSize, options);
    if (width <= maxWidth || current.length === 0) {
      current = candidate;
      continue;
    }
    wrapped.push(current.trimEnd());
    current = word.trimStart();
  }

  if (current) wrapped.push(current.trimEnd());
  return wrapped.length > 0 ? wrapped : [''];
}

export function buildPublicMapTextLines(object: PublicTextObjectLike) {
  const data = object.data ?? {};
  const text = typeof data.text === 'string' ? data.text : 'Texto';
  const mode = getTextMode(object);
  const sourceLines = text.split('\n');

  if (mode === 'auto') return sourceLines;

  const maxWidth = Math.max(object.width ?? 160, 1);
  const fontSize = clampFontSizeValue(Number(data.fontSize ?? 22));
  const measureOptions = {
    fontFamily: String(data.fontFamily ?? 'Inter, sans-serif'),
    fontWeight: data.fontWeight === 'bold' ? 'bold' : 'normal',
    letterSpacing: Number(data.letterSpacing ?? 0),
  };

  return sourceLines.flatMap((line) => wrapLine(line, maxWidth, fontSize, measureOptions));
}

export function getPublicMapTextAnchor(align: string) {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

export function getPublicMapTextAnchorX(
  object: Pick<EventMapObjectDTO, 'x' | 'width' | 'height' | 'data'>,
  align: string,
) {
  const mode = getTextMode(object);
  const hasBoxWidth = mode !== 'auto' && typeof object.width === 'number' && object.width > 0;
  const width = object.width ?? 0;
  if (!hasBoxWidth) return object.x;
  if (align === 'center') return object.x + width / 2;
  if (align === 'right') return object.x + width;
  return object.x;
}

export function getPublicMapTextStartY(
  object: Pick<EventMapObjectDTO, 'y' | 'width' | 'height' | 'data'>,
  lineCount: number,
  fontSize: number,
  lineHeight: number,
) {
  const data = object.data ?? {};
  const mode = getTextMode(object);
  const verticalAlign = String(data.verticalAlign ?? 'top');
  const totalHeight = lineCount * fontSize * lineHeight;

  if (mode === 'area' && typeof object.height === 'number' && object.height > 0) {
    if (verticalAlign === 'middle') return object.y + (object.height - totalHeight) / 2;
    if (verticalAlign === 'bottom') return object.y + object.height - totalHeight;
  }

  return object.y;
}
