import { getTextMode, measureTextWidth } from '../doc/text-object.js';

export function getObjectBounds(object: {
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  type: string;
  data?: Record<string, unknown>;
}) {
  if (object.type === 'TEXT') {
    const fontSize = Number(object.data?.fontSize ?? 22);
    const lineHeight = Number(object.data?.lineHeight ?? 1.2);
    const text = String(object.data?.text ?? 'Texto');
    const lineCount = Math.max(1, text.split('\n').length);
    const mode = getTextMode({
      width: object.width,
      height: object.height,
      data: object.data ?? {},
    });
    const width =
      object.width ??
      (mode === 'auto'
        ? measureTextWidth(text, fontSize, {
            fontFamily: String(object.data?.fontFamily ?? 'Inter, sans-serif'),
            fontWeight: String(object.data?.fontWeight ?? 'normal'),
            letterSpacing: Number(object.data?.letterSpacing ?? 0),
          })
        : Math.max(24, Math.min(480, text.length * fontSize * 0.55)));
    const height = object.height ?? Math.max(fontSize * lineHeight, fontSize * lineHeight * lineCount);
    return { x: object.x, y: object.y, width, height };
  }

  const width = object.width ?? 180;
  const height = object.height ?? 90;
  return { x: object.x, y: object.y, width, height };
}
