import {
  clampFontSizeValue,
  getTextMode,
  measureTextWidth,
  normalizeTextData,
} from '@alusa/domain';
import type Konva from 'konva';
import type { EventMapObjectDTO } from '../../api/event-map-service';

export function readKonvaTextMetrics(node: Konva.Text) {
  return {
    fontSize: Number(node.fontSize()),
    fontFamily: String(node.fontFamily()),
    fontWeight: node.fontStyle()?.includes('bold') ? 'bold' : 'normal',
    letterSpacing: Number(node.letterSpacing?.() ?? 0),
    lineHeight: Number(node.lineHeight?.() ?? 1.2),
  };
}

export function estimateTextWidth(text: string, fontSize: number, node?: Konva.Text) {
  const metrics = node ? readKonvaTextMetrics(node) : undefined;
  return measureTextWidth(text, fontSize, metrics);
}

export function applyTextNodeLayout(
  node: Konva.Text,
  object: EventMapObjectDTO,
  patch?: Partial<EventMapObjectDTO>,
) {
  const merged = { ...object, ...patch, data: { ...object.data, ...(patch?.data ?? {}) } };
  const mode = getTextMode(merged);
  const fontSize = clampFontSizeValue(Number(merged.data.fontSize ?? 22));

  node.fontSize(fontSize);
  if (mode === 'auto') {
    node.width(undefined as unknown as number);
    node.height(undefined as unknown as number);
  } else if (mode === 'fixed-width') {
    node.width(Math.max(8, merged.width ?? node.width()));
    node.height(undefined as unknown as number);
  } else {
    node.width(Math.max(8, merged.width ?? node.width()));
    node.height(Math.max(8, merged.height ?? node.height()));
  }

  return normalizeTextData(merged.data);
}
