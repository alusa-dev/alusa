import type { EventMapObjectDTO } from '../api/event-map-service';

import { cn } from '@/lib/utils';

function getPreviewStyle(object: EventMapObjectDTO) {
  if (object.type === 'STAGE') return { fill: '#111827', stroke: '#111827' };
  if (object.type === 'BLOCKED_AREA') return { fill: '#e2e8f0', stroke: '#94a3b8' };
  if (object.type === 'CORRIDOR') return { fill: '#f8fafc', stroke: '#cbd5e1' };
  if (object.type === 'TABLE') return { fill: '#fefce8', stroke: '#ca8a04' };
  if (object.type === 'BOOTH') return { fill: '#fff7ed', stroke: '#ea580c' };
  if (object.type === 'GENERAL_AREA' && object.data.shape) {
    return { fill: String(object.data.fill ?? '#ffffff'), stroke: String(object.data.stroke ?? '#64748b') };
  }
  if (object.type === 'GENERAL_AREA') return { fill: '#ecfeff', stroke: '#0891b2' };
  if (object.type === 'TEXT') return { fill: String(object.data.fill ?? '#0f172a'), stroke: '#cbd5e1' };
  if (object.type === 'SECTION') return { fill: String(object.data.fill ?? '#6d28d9'), stroke: String(object.data.fill ?? '#6d28d9') };
  return { fill: String(object.data.fill ?? '#f8fafc'), stroke: String(object.data.stroke ?? '#cbd5e1') };
}

function getPreviewBorderStyle(object: EventMapObjectDTO) {
  const strokeStyle = object.data.strokeStyle;
  if (strokeStyle === 'dashed') return 'dashed';
  if (strokeStyle === 'dotted') return 'dotted';
  if (object.type === 'CORRIDOR') return 'dashed';
  return 'solid';
}

function getPreviewRadius(object: EventMapObjectDTO, shape: string | null) {
  if (object.type === 'TABLE') return '9999px';
  const cornerRadius = Number(object.data.cornerRadius ?? (shape ? 0 : 8));
  if (cornerRadius >= 999) return '9999px';
  if (shape === 'circle' || shape === 'ellipse') return '9999px';
  return `${Math.min(cornerRadius, 4)}px`;
}

export function MapObjectPreview({
  object,
  className,
  size = 16,
}: {
  object: EventMapObjectDTO;
  className?: string;
  size?: number;
}) {
  const style = getPreviewStyle(object);
  const shape = typeof object.data.shape === 'string' ? object.data.shape : null;
  const opacity = Number(object.data.opacity ?? (object.type === 'SECTION' ? 0.85 : 1));
  const borderStyle = getPreviewBorderStyle(object);
  const borderRadius = getPreviewRadius(object, shape);

  if (object.type === 'TEXT') {
    const label = String(object.data.text ?? object.data.label ?? 'T').trim().charAt(0).toUpperCase() || 'T';
    return (
      <span
        aria-hidden
        className={cn('relative inline-flex shrink-0 items-center justify-center rounded-[3px] border bg-white text-[9px] font-semibold leading-none', className)}
        style={{ width: size, height: size, borderColor: style.stroke, color: style.fill }}
      >
        {label}
      </span>
    );
  }

  if (shape === 'triangle') {
    return (
      <span
        aria-hidden
        className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
        style={{ width: size, height: size }}
      >
        <span
          className="block"
          style={{
            width: size - 2,
            height: size - 2,
            clipPath: 'polygon(50% 8%, 8% 92%, 92% 92%)',
            backgroundColor: style.fill,
            opacity,
            boxShadow: `inset 0 0 0 1px ${style.stroke}`,
          }}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn('relative inline-flex shrink-0', className)}
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: style.fill,
        opacity,
        border: `1px ${borderStyle} ${style.stroke}`,
      }}
    />
  );
}

export function MapSectionPreview({
  color,
  className,
  size = 16,
}: {
  color: string;
  className?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 rounded-[3px] border border-black/10', className)}
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

export function MapLevelPreview({
  className,
  size = 16,
  width,
  height,
}: {
  className?: string;
  size?: number;
  width?: number;
  height?: number;
}) {
  const previewWidth = width ?? size;
  const previewHeight = height ?? size;

  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 rounded-[3px] border border-slate-300 bg-white', className)}
      style={{ width: previewWidth, height: previewHeight }}
    />
  );
}
