import { pointInPolygon } from '../geometry/polygon-geometry.js';
import { pointAtDistance, pathLength } from '../geometry/row-path.js';
import { sectionLocalToWorld } from '../geometry/map-coordinate-transform.js';
import type {
  EventMapDocument,
  LayoutDiagnostic,
  MapSeatBlock,
  MapSeatRow,
  ResolvedMapLayout,
  SeatPlacement,
} from '../model/event-map-document.js';

const EPSILON = 0.001;

function pointInSection(point: { x: number; y: number }, outline: Array<{ x: number; y: number }>) {
  if (pointInPolygon(point, outline)) return true;
  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index]!;
    const end = outline[(index + 1) % outline.length]!;
    const cross = Math.abs((point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y));
    const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
    const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
    if (cross <= EPSILON && dot >= -EPSILON && dot <= lengthSquared + EPSILON) return true;
  }
  return false;
}

function safeSegments(block: MapSeatBlock, diagnostics: LayoutDiagnostic[]) {
  const segments = block.distribution.length > 0 ? block.distribution : [{ type: 'SEATS' as const, count: 0 }];
  for (const segment of segments) {
    if (segment.type === 'SEATS' && (!Number.isInteger(segment.count) || segment.count < 0)) {
      diagnostics.push({ type: 'INVALID_DISTRIBUTION', message: 'A quantidade de assentos do bloco é inválida.', blockId: block.id });
    }
    if (segment.type === 'GAP' && (!Number.isFinite(segment.width) || segment.width < 0)) {
      diagnostics.push({ type: 'INVALID_DISTRIBUTION', message: 'A largura do corredor é inválida.', blockId: block.id });
    }
  }
  return segments;
}

function seatCountFromSegments(segments: Array<{ type: 'SEATS'; count: number } | { type: 'GAP'; width: number }>) {
  return segments.reduce((total, segment) => total + (segment.type === 'SEATS' ? segment.count : 0), 0);
}

function resolveRowDistribution(
  block: MapSeatBlock,
  row: MapSeatRow,
  rowIndex: number,
  rowCount: number,
  diagnostics: LayoutDiagnostic[],
) {
  if (row.distribution) return safeSegments({ ...block, distribution: row.distribution }, diagnostics);

  const baseSegments = safeSegments(block, diagnostics);
  const baseCount = seatCountFromSegments(baseSegments);
  const mode = block.distributionMode ?? 'FIXED';
  if (mode === 'FIXED') return baseSegments;

  if (mode === 'PROGRESSIVE') {
    const first = Math.max(0, Math.round(block.firstRowSeatCount ?? baseCount));
    const last = Math.max(0, Math.round(block.lastRowSeatCount ?? first));
    const ratio = rowCount <= 1 ? 0 : rowIndex / (rowCount - 1);
    return [{ type: 'SEATS' as const, count: Math.round(first + (last - first) * ratio) }];
  }

  const length = pathLength(row.path);
  const pitch = row.seatSize + row.seatGap;
  const fitted = pitch > 0 ? Math.floor(Math.max(0, length - row.seatSize) / pitch) + 1 : 0;
  const minimum = Math.max(0, Math.round(block.fitMinimumSeatCount ?? 1));
  const maximum = Math.max(minimum, Math.round(block.fitMaximumSeatCount ?? baseCount));
  return [{ type: 'SEATS' as const, count: Math.min(maximum, Math.max(minimum, fitted)) }];
}

export function resolveSeatCountForRow(block: MapSeatBlock, row: MapSeatRow, rowIndex: number, rowCount: number) {
  return seatCountFromSegments(resolveRowDistribution(block, row, rowIndex, rowCount, []));
}

function buildDistances(segments: ReturnType<typeof safeSegments>, row: MapSeatRow, diagnostics: LayoutDiagnostic[]) {
  const pitch = row.seatSize + row.seatGap;
  if (!Number.isFinite(pitch) || pitch <= 0) {
    diagnostics.push({ type: 'INVALID_SPACING', message: 'O espaçamento da fileira é inválido.', rowId: row.id });
    return { distances: [], span: 0 };
  }
  let cursor = 0;
  const distances: number[] = [];
  for (const segment of segments) {
    if (segment.type === 'GAP') {
      cursor += segment.width;
      continue;
    }
    for (let index = 0; index < segment.count; index += 1) {
      distances.push(cursor + row.seatSize / 2 + index * pitch);
    }
    cursor += Math.max(0, segment.count - 1) * pitch + (segment.count > 0 ? row.seatSize : 0);
  }
  return { distances, span: cursor };
}

function progressiveOffset(block: MapSeatBlock, span: number, rowLength: number) {
  if ((block.distributionMode ?? 'FIXED') !== 'PROGRESSIVE') return 0;
  const remaining = Math.max(0, rowLength - span);
  if (block.distributionAlignment === 'RIGHT') return remaining;
  if (block.distributionAlignment === 'CENTER') return remaining / 2;
  return 0;
}

function seatRotation(tangent: { x: number; y: number }) {
  return (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
}

function resolveRow(row: MapSeatRow, block: MapSeatBlock, rowIndex: number, rowCount: number, sectionId: string, levelId: string, diagnostics: LayoutDiagnostic[]) {
  const segments = resolveRowDistribution(block, row, rowIndex, rowCount, diagnostics);
  const requestedSeatCount = seatCountFromSegments(segments);
  if (requestedSeatCount > row.seats.length) {
    diagnostics.push({ type: 'INVALID_DISTRIBUTION', message: 'A distribuição solicita mais assentos do que os IDs disponíveis na fileira.', blockId: block.id, rowId: row.id });
  }
  const length = pathLength(row.path);
  const distanceLayout = buildDistances(segments, row, diagnostics);
  const offset = progressiveOffset(block, distanceLayout.span, length);
  const distances = distanceLayout.distances.map((distance) => Math.min(length, distance + offset));
  const placements: SeatPlacement[] = [];
  for (let index = 0; index < distances.length; index += 1) {
    const seat = row.seats[index];
    if (!seat) continue;
    const sample = pointAtDistance(row.path, Math.min(length, distances[index]!));
    const localPosition = seat.position ?? sample.point;
    const technicalCode = seat.technicalCode ?? `${row.label}${index + 1}`;
    placements.push({
      seatId: seat.id,
      rowId: row.id,
      sectionId,
      levelId,
      label: seat.label,
      technicalCode,
      rowLabel: row.label,
      seatNumber: String(index + 1),
      rowIndex: seat.rowIndex,
      columnIndex: seat.columnIndex,
      x: localPosition.x,
      y: localPosition.y,
      rotation: seat.rotation ?? seatRotation(sample.tangent),
      size: row.seatSize,
      accessible: Boolean(seat.accessible),
      publicVisible: seat.publicVisible !== false,
    });
  }
  return placements;
}

export function resolveEventMapLayout(document: EventMapDocument): ResolvedMapLayout {
  const diagnostics: LayoutDiagnostic[] = [];
  const sections: ResolvedMapLayout['sections'] = [];
  const rows: ResolvedMapLayout['rows'] = [];
  const seats: SeatPlacement[] = [];

  for (const section of document.sections) {
    if (section.blocks.length === 0 && section.outline.length < 3) {
      diagnostics.push({ type: 'INVALID_SECTION', message: 'A seção precisa de pelo menos três pontos.', sectionId: section.id });
    }
    const resolvedRows: ResolvedMapLayout['rows'] = [];
    for (const block of section.blocks) {
      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
        const row = block.rows[rowIndex]!;
        const placements = resolveRow(row, block, rowIndex, block.rows.length, section.id, section.levelId, diagnostics);
        const resolvedRow = { rowId: row.id, sectionId: section.id, levelId: section.levelId, label: row.label, seatPlacements: placements };
        resolvedRows.push(resolvedRow);
        rows.push(resolvedRow);
        seats.push(...placements);

        for (const placement of placements) {
          const local = { x: placement.x, y: placement.y };
          if (section.outline.length >= 3 && !pointInSection(local, section.outline)) {
            diagnostics.push({ type: 'SEAT_OUTSIDE_SECTION', message: 'O assento está fora da seção.', sectionId: section.id, rowId: row.id, seatId: placement.seatId });
          }
        }
      }
    }
    sections.push({
      sectionId: section.id,
      levelId: section.levelId,
      outline: section.outline,
      worldPosition: sectionLocalToWorld({ x: 0, y: 0 }, section.position, section.rotation),
      rotation: section.rotation,
      rows: resolvedRows,
    });
  }

  for (let leftIndex = 0; leftIndex < seats.length; leftIndex += 1) {
    const left = seats[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < seats.length; rightIndex += 1) {
      const right = seats[rightIndex]!;
      if (left.sectionId !== right.sectionId) continue;
      const threshold = (left.size + right.size) / 2 - EPSILON;
      if (Math.hypot(left.x - right.x, left.y - right.y) < threshold) {
        diagnostics.push({ type: 'SEAT_OVERLAP', message: 'Dois assentos estão sobrepostos.', seatId: left.seatId, conflictingSeatId: right.seatId });
      }
    }
  }

  return { sections, rows, seats, diagnostics };
}
