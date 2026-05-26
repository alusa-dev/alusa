import type { EventMapObjectDTO, EventSeatDTO } from '../api/event-map-service';

export function seatFill(status: EventSeatDTO['status']) {
  if (status === 'SOLD') return '#94a3b8';
  if (status === 'HELD') return '#f59e0b';
  if (status === 'BLOCKED' || status === 'UNAVAILABLE') return '#e2e8f0';
  if (status === 'COMPLIMENTARY') return '#8b5cf6';
  return '#10b981';
}

export function objectStyle(object: EventMapObjectDTO) {
  if (object.type === 'STAGE') return { fill: '#111827', stroke: '#111827', text: '#ffffff' };
  if (object.type === 'BLOCKED_AREA') return { fill: '#e2e8f0', stroke: '#94a3b8', text: '#475569' };
  if (object.type === 'CORRIDOR') return { fill: '#f8fafc', stroke: '#cbd5e1', text: '#64748b' };
  if (object.type === 'TABLE') return { fill: '#fefce8', stroke: '#ca8a04', text: '#854d0e' };
  if (object.type === 'BOOTH') return { fill: '#fff7ed', stroke: '#ea580c', text: '#9a3412' };
  if (object.type === 'GENERAL_AREA' && object.data.shape) {
    return { fill: String(object.data.fill ?? '#ffffff'), stroke: '#64748b', text: '#334155' };
  }
  if (object.type === 'GENERAL_AREA') return { fill: '#ecfeff', stroke: '#0891b2', text: '#155e75' };
  return { fill: String(object.data.fill ?? '#f8fafc'), stroke: '#cbd5e1', text: '#334155' };
}

export function getObjectStrokeDash(object: EventMapObjectDTO) {
  const strokeStyle = object.data.strokeStyle;
  if (strokeStyle === 'dashed') return [10, 6];
  if (strokeStyle === 'dotted') return [2, 6];
  if (object.type === 'CORRIDOR') return [8, 6];
  return undefined;
}

export function isObjectAppearanceEnabled(value: unknown, fallback = true) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

export function getObjectAppearance(object: EventMapObjectDTO) {
  const style = objectStyle(object);
  const fillEnabled = isObjectAppearanceEnabled(object.data.fillEnabled);
  const strokeEnabled = isObjectAppearanceEnabled(object.data.strokeEnabled);
  const strokeWidthEnabled = isObjectAppearanceEnabled(object.data.strokeWidthEnabled);
  const strokeWidth = Number(object.data.strokeWidth ?? 1.5);
  const effectiveStrokeWidth = strokeEnabled && strokeWidthEnabled ? strokeWidth : 0;

  return {
    fill: fillEnabled ? String(object.data.fill ?? style.fill) : undefined,
    stroke: strokeEnabled && effectiveStrokeWidth > 0 ? String(object.data.stroke ?? style.stroke) : undefined,
    strokeWidth: effectiveStrokeWidth,
    dash: strokeEnabled && strokeWidthEnabled ? getObjectStrokeDash(object) : undefined,
  };
}
