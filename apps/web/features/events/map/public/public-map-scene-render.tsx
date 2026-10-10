import type { ReactNode } from 'react';
import type { EventSeatStatus } from '@alusa/shared';
import {
  mapPointsLocalToWorld,
  pathToPolyline,
  resolveSeatCountForRow,
  type EventMapDocument,
} from '@alusa/domain';

import { PublicMapTextSvg } from './public-map-text-render';
import { getObjectAppearance, seatFill } from '../canvas/render/map-object-appearance';
import { publicSeatTooltip } from './public-order-utils';

export type PublicMapSceneObject = {
  id: string;
  type: import('../api/event-map-service').EventMapObjectDTO['type'];
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  data?: Record<string, unknown>;
};

export type PublicMapSceneSeat = {
  id: string;
  sectionId?: string | null;
  technicalCode: string;
  x: number;
  y: number;
  rotation: number;
  size?: number | null;
  status: string;
  displayLabel: string;
  sectionName: string;
};

export type PublicMapSceneGuide = {
  id: string;
  sectionId: string;
  sectionColor: string;
  curved: boolean;
  points: string;
  rowLabel: string | null;
  labelPosition: { x: number; y: number } | null;
};

export type PublicMapSceneItem<S extends PublicMapSceneSeat = PublicMapSceneSeat> =
  | { kind: 'object'; id: string; sortOrder: number; object: PublicMapSceneObject }
  | { kind: 'row-guides'; id: string; sortOrder: number; guide: PublicMapSceneGuide }
  | { kind: 'seat'; id: string; sortOrder: number; seat: S };

type RenderSortItem = {
  kind: PublicMapSceneItem['kind'];
  id: string;
  sortOrder: number;
  object?: Pick<PublicMapSceneObject, 'type' | 'data'>;
};

export function sortPublicMapRenderItems<T extends RenderSortItem>(items: T[]) {
  const kindPriority = { object: 0, 'row-guides': 1, seat: 2 } as const;
  return [...items].sort(
    (left, right) => {
      const leftIsText = left.kind === 'object' && left.object?.type === 'TEXT';
      const rightIsText = right.kind === 'object' && right.object?.type === 'TEXT';
      if (leftIsText !== rightIsText) return leftIsText ? 1 : -1;

      const leftIsFilledObject = left.kind === 'object' && left.object != null &&
        getObjectAppearance({ type: left.object.type, data: left.object.data ?? {} }).fill != null;
      const rightIsFilledObject = right.kind === 'object' && right.object != null &&
        getObjectAppearance({ type: right.object.type, data: right.object.data ?? {} }).fill != null;
      if (leftIsFilledObject && right.kind === 'seat') return -1;
      if (rightIsFilledObject && left.kind === 'seat') return 1;

      return left.sortOrder - right.sortOrder || kindPriority[left.kind] - kindPriority[right.kind] || left.id.localeCompare(right.id);
    },
  );
}

export function buildPublicMapSceneItems<
  S extends PublicMapSceneSeat,
  O extends PublicMapSceneObject & { sectionId?: string | null; sortOrder?: number },
>({
  levelId,
  document,
  levelObjects,
  levelSeats,
  allObjects,
  sections,
}: {
  levelId: string;
  document: EventMapDocument | null;
  levelObjects: O[];
  levelSeats: S[];
  allObjects: O[];
  sections: Array<{ id: string; sortOrder?: number }>;
}): PublicMapSceneItem<S>[] {
  const guides = document && Array.isArray(document.sections)
    ? document.sections
      .filter((section) => section.levelId === levelId && !section.hidden && section.blocks.length > 0)
      .flatMap((section) => section.blocks.flatMap((block) => block.rows.flatMap((row, rowIndex) => {
        if (resolveSeatCountForRow(block, row, rowIndex, block.rows.length) <= 0) return [];
        const points = mapPointsLocalToWorld(
          pathToPolyline(row.path, row.path.type === 'ARC' ? 48 : 24),
          section.position,
          section.rotation,
        );
        const firstPoint = points[0] ?? null;
        return [{
          id: row.id,
          sectionId: section.id,
          sectionColor: section.color,
          curved: row.path.type !== 'LINE',
          points: points.map((point) => `${point.x},${point.y}`).join(' '),
          rowLabel: block.numberingMode === 'NUMERIC' ? null : row.label,
          labelPosition: firstPoint ? { x: firstPoint.x - 22, y: firstPoint.y - 8 } : null,
        }];
      })))
    : [];
  const sectionObjectOrder = new Map(allObjects
    .filter((object) => object.type === 'SECTION' && object.sectionId)
    .map((object) => [object.sectionId!, object.sortOrder ?? 0]));
  const sectionOrder = new Map(sections.map((section) => [section.id, section.sortOrder ?? 0]));
  const items: PublicMapSceneItem<S>[] = [
    ...levelObjects.map((object) => ({ kind: 'object' as const, id: object.id, sortOrder: object.sortOrder ?? 0, object })),
    ...guides.map((guide) => ({
      kind: 'row-guides' as const,
      id: guide.id,
      sortOrder: sectionObjectOrder.get(guide.sectionId) ?? sectionOrder.get(guide.sectionId) ?? 0,
      guide,
    })),
    ...levelSeats.map((seat) => ({
      kind: 'seat' as const,
      id: seat.id,
      sortOrder: seat.sectionId ? sectionObjectOrder.get(seat.sectionId) ?? sectionOrder.get(seat.sectionId) ?? 0 : 0,
      seat,
    })),
  ];
  return sortPublicMapRenderItems(items);
}

function toSeatAppearanceStatus(status: string): EventSeatStatus {
  switch (status) {
    case 'AVAILABLE':
    case 'HELD':
    case 'SOLD':
    case 'BLOCKED':
    case 'UNAVAILABLE':
    case 'COMPLIMENTARY':
      return status;
    default:
      return 'UNAVAILABLE';
  }
}

function renderSceneObject(object: PublicMapSceneObject): ReactNode {
  const data = object.data ?? {};
  if (object.type === 'TEXT') {
    return <PublicMapTextSvg key={object.id} object={object} />;
  }

  const width = object.width ?? 180;
  const height = object.height ?? 90;
  const shape = typeof data.shape === 'string' ? data.shape : null;
  const opacity = Number(data.opacity ?? (object.type === 'SECTION' ? 0 : 1));
  const cornerRadius = Number(data.cornerRadius ?? (object.type === 'TABLE' ? 999 : shape ? 0 : 8));
  const appearance = getObjectAppearance({ type: object.type, data });
  const dash = appearance.dash?.join(' ');

  return (
    <g key={object.id} transform={`translate(${object.x} ${object.y}) rotate(${object.rotation})`} opacity={opacity} pointerEvents="none">
      {shape === 'circle' || shape === 'ellipse' ? (
        <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={appearance.fill ?? 'none'} stroke={appearance.stroke ?? 'none'} strokeWidth={appearance.strokeWidth} strokeDasharray={dash} />
      ) : shape === 'triangle' ? (
        <polygon
          points={Array.from({ length: 3 }, (_, index) => {
            const angle = (index * 2 * Math.PI) / 3;
            const radius = Math.min(width, height) / 2;
            return `${width / 2 + radius * Math.sin(angle)},${height / 2 - radius * Math.cos(angle)}`;
          }).join(' ')}
          transform={`rotate(30 ${width / 2} ${height / 2})`}
          fill={appearance.fill ?? 'none'} stroke={appearance.stroke ?? 'none'} strokeWidth={appearance.strokeWidth} strokeDasharray={dash}
        />
      ) : (
        <rect width={width} height={height} rx={cornerRadius} fill={appearance.fill ?? 'none'} stroke={appearance.stroke ?? 'none'} strokeWidth={appearance.strokeWidth} strokeDasharray={dash} />
      )}
    </g>
  );
}

export function PublicMapSceneRenderer<S extends PublicMapSceneSeat>({
  items,
  selectedSeatIds,
  isSeatInteractive,
  onSeatClick,
}: {
  items: PublicMapSceneItem<S>[];
  selectedSeatIds: string[];
  isSeatInteractive: (_seat: S) => boolean;
  onSeatClick: (_seat: S) => void;
}) {
  return <>{items.map((item) => {
    if (item.kind === 'object') return renderSceneObject(item.object);
    if (item.kind === 'row-guides') {
      return (
        <g key={item.guide.id} pointerEvents="none">
          <polyline points={item.guide.points} fill="none" stroke={`${item.guide.sectionColor}44`} strokeWidth={2} strokeDasharray={item.guide.curved ? '5 4' : undefined} opacity={0.55} />
          {item.guide.rowLabel && item.guide.labelPosition ? (
            <text
              x={item.guide.labelPosition.x}
              y={item.guide.labelPosition.y}
              fontSize={10}
              fill={`${item.guide.sectionColor}99`}
              dominantBaseline="hanging"
              className="pointer-events-none select-none"
            >
              {item.guide.rowLabel}
            </text>
          ) : null}
        </g>
      );
    }
    const seat = item.seat;
    const selected = selectedSeatIds.includes(seat.id);
    const interactive = isSeatInteractive(seat);
    const radius = (seat.size ?? 24) / 2;
    const classes = `${selected ? 'fill-brand-accent stroke-brand-accent' : ''} ${interactive ? 'cursor-pointer' : 'cursor-not-allowed'}`;
    return (
      <g key={seat.id} transform={`rotate(${seat.rotation} ${seat.x} ${seat.y})`}>
        <title>{publicSeatTooltip(seat.status, seat.displayLabel, seat.sectionName)}</title>
        <circle data-public-seat data-testid={`public-seat-${seat.technicalCode}`} cx={seat.x} cy={seat.y} r={radius} stroke={selected ? undefined : '#ffffff'} strokeWidth={selected ? 4 : 2} fill={selected ? undefined : seatFill(toSeatAppearanceStatus(seat.status))} className={classes} onClick={() => onSeatClick(seat)} />
        <text x={seat.x} y={seat.y + 4} textAnchor="middle" fontSize={Math.max(9, radius * 0.65)} fontWeight="bold" className="pointer-events-none select-none fill-white">{seat.displayLabel}</text>
      </g>
    );
  })}</>;
}
