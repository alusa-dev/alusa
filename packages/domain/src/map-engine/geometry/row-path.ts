import type { MapPoint, SeatRowPath } from '../model/event-map-document.js';

export type PathSample = { point: MapPoint; tangent: MapPoint; distance: number };

const EPSILON = 0.000001;

function distance(a: MapPoint, b: MapPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalize(vector: MapPoint): MapPoint {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= EPSILON) return { x: 1, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function linePoint(path: Extract<SeatRowPath, { type: 'LINE' }>, progress: number) {
  const point = {
    x: path.start.x + (path.end.x - path.start.x) * progress,
    y: path.start.y + (path.end.y - path.start.y) * progress,
  };
  return { point, tangent: normalize({ x: path.end.x - path.start.x, y: path.end.y - path.start.y }) };
}

function arcDelta(path: Extract<SeatRowPath, { type: 'ARC' }>) {
  const raw = path.endAngle - path.startAngle;
  if (path.clockwise) return raw >= 0 ? raw - Math.PI * 2 : raw;
  return raw <= 0 ? raw + Math.PI * 2 : raw;
}

export function arcSweepDegrees(path: Extract<SeatRowPath, { type: 'ARC' }>) {
  return (Math.abs(arcDelta(path)) * 180) / Math.PI;
}

export function resizeArcPathToLength(path: Extract<SeatRowPath, { type: 'ARC' }>, length: number) {
  const delta = arcDelta(path);
  const magnitude = Math.max(Math.abs(delta), EPSILON);
  const midpointAngle = path.startAngle + delta / 2;
  const anchor = {
    x: path.center.x + path.radius * Math.cos(midpointAngle),
    y: path.center.y + path.radius * Math.sin(midpointAngle),
  };
  const radius = Math.max(1, Math.max(0, length) / magnitude);
  return {
    ...path,
    radius,
    center: {
      x: anchor.x - radius * Math.cos(midpointAngle),
      y: anchor.y - radius * Math.sin(midpointAngle),
    },
  };
}

/** Builds a predictable minor arc through the supplied endpoints. */
export function createArcPathFromChord(start: MapPoint, end: MapPoint, sweepDegrees = 60, clockwise = true): Extract<SeatRowPath, { type: 'ARC' }> {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const sweep = (Math.max(5, Math.min(170, sweepDegrees)) * Math.PI) / 180;
  if (chord <= EPSILON) {
    return { type: 'ARC', center: { ...start }, radius: 120, startAngle: Math.PI, endAngle: 0, clockwise: false };
  }

  const radius = chord / (2 * Math.sin(sweep / 2));
  const offset = radius * Math.cos(sweep / 2);
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const bulgeDirection = clockwise ? 1 : -1;
  const center = {
    x: midpoint.x + bulgeDirection * (dy / chord) * offset,
    y: midpoint.y - bulgeDirection * (dx / chord) * offset,
  };
  return {
    type: 'ARC',
    center,
    radius,
    startAngle: Math.atan2(start.y - center.y, start.x - center.x),
    endAngle: Math.atan2(end.y - center.y, end.x - center.x),
    clockwise: true,
  };
}

/** Changes arc curvature around its existing center and midpoint direction. */
export function setArcSweep(path: Extract<SeatRowPath, { type: 'ARC' }>, sweepDegrees: number, clockwise = path.clockwise) {
  const currentDelta = arcDelta(path);
  const direction = clockwise ? -1 : 1;
  const sweep = (Math.max(5, Math.min(170, sweepDegrees)) * Math.PI) / 180;
  const midpointAngle = path.startAngle + currentDelta / 2;
  const anchor = {
    x: path.center.x + path.radius * Math.cos(midpointAngle),
    y: path.center.y + path.radius * Math.sin(midpointAngle),
  };
  const radius = Math.max(1, (path.radius * Math.abs(currentDelta)) / sweep);
  return {
    ...path,
    radius,
    center: {
      x: anchor.x - radius * Math.cos(midpointAngle),
      y: anchor.y - radius * Math.sin(midpointAngle),
    },
    startAngle: midpointAngle - (direction * sweep) / 2,
    endAngle: midpointAngle + (direction * sweep) / 2,
    clockwise,
  };
}

function arcPoint(path: Extract<SeatRowPath, { type: 'ARC' }>, progress: number) {
  const delta = arcDelta(path);
  const angle = path.startAngle + delta * progress;
  const point = {
    x: path.center.x + path.radius * Math.cos(angle),
    y: path.center.y + path.radius * Math.sin(angle),
  };
  const sign = delta >= 0 ? 1 : -1;
  return { point, tangent: normalize({ x: -Math.sin(angle) * sign, y: Math.cos(angle) * sign }) };
}

function bezierPoint(path: Extract<SeatRowPath, { type: 'BEZIER' }>, t: number) {
  const u = 1 - t;
  const point = {
    x: u ** 3 * path.p0.x + 3 * u ** 2 * t * path.p1.x + 3 * u * t ** 2 * path.p2.x + t ** 3 * path.p3.x,
    y: u ** 3 * path.p0.y + 3 * u ** 2 * t * path.p1.y + 3 * u * t ** 2 * path.p2.y + t ** 3 * path.p3.y,
  };
  const tangent = normalize({
    x: 3 * u ** 2 * (path.p1.x - path.p0.x) + 6 * u * t * (path.p2.x - path.p1.x) + 3 * t ** 2 * (path.p3.x - path.p2.x),
    y: 3 * u ** 2 * (path.p1.y - path.p0.y) + 6 * u * t * (path.p2.y - path.p1.y) + 3 * t ** 2 * (path.p3.y - path.p2.y),
  });
  return { point, tangent };
}

function polylineSamples(path: Extract<SeatRowPath, { type: 'POLYLINE' }>) {
  const samples: PathSample[] = [];
  let accumulated = 0;
  for (let index = 0; index < path.points.length - 1; index += 1) {
    const start = path.points[index]!;
    const end = path.points[index + 1]!;
    const segmentLength = distance(start, end);
    if (segmentLength <= EPSILON) continue;
    const tangent = normalize({ x: end.x - start.x, y: end.y - start.y });
    if (samples.length === 0) samples.push({ point: start, tangent, distance: accumulated });
    accumulated += segmentLength;
    samples.push({ point: end, tangent, distance: accumulated });
  }
  return samples;
}

export function pathLength(path: SeatRowPath) {
  switch (path.type) {
    case 'LINE':
      return distance(path.start, path.end);
    case 'ARC':
      return Math.abs(path.radius * arcDelta(path));
    case 'POLYLINE':
      return polylineSamples(path).at(-1)?.distance ?? 0;
    case 'BEZIER': {
      const samples = buildArcLengthTable(path);
      return samples.at(-1)?.distance ?? 0;
    }
  }
}

export function buildArcLengthTable(path: Extract<SeatRowPath, { type: 'BEZIER' }>, sampleCount = 128) {
  const samples: PathSample[] = [];
  let accumulated = 0;
  let previous = bezierPoint(path, 0);
  samples.push({ point: previous.point, tangent: previous.tangent, distance: 0 });
  for (let index = 1; index <= sampleCount; index += 1) {
    const current = bezierPoint(path, index / sampleCount);
    accumulated += distance(previous.point, current.point);
    samples.push({ point: current.point, tangent: current.tangent, distance: accumulated });
    previous = current;
  }
  return samples;
}

export function pointAtDistance(path: SeatRowPath, targetDistance: number) {
  const length = pathLength(path);
  const clamped = Math.max(0, Math.min(length, targetDistance));
  if (length <= EPSILON) {
    const start = path.type === 'LINE' ? path.start : path.type === 'ARC' ? path.center : path.type === 'POLYLINE' ? path.points[0] : path.p0;
    return { point: start ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  }

  if (path.type === 'LINE') return linePoint(path, clamped / length);
  if (path.type === 'ARC') return arcPoint(path, clamped / length);

  const samples = path.type === 'POLYLINE' ? polylineSamples(path) : buildArcLengthTable(path);
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    if (clamped <= current.distance) {
      const span = current.distance - previous.distance;
      const progress = span <= EPSILON ? 0 : (clamped - previous.distance) / span;
      return {
        point: {
          x: previous.point.x + (current.point.x - previous.point.x) * progress,
          y: previous.point.y + (current.point.y - previous.point.y) * progress,
        },
        tangent: normalize({
          x: previous.tangent.x + (current.tangent.x - previous.tangent.x) * progress,
          y: previous.tangent.y + (current.tangent.y - previous.tangent.y) * progress,
        }),
      };
    }
  }
  const last = samples.at(-1)!;
  return { point: last.point, tangent: last.tangent };
}

export function pathToPolyline(path: SeatRowPath, sampleCount = 128): MapPoint[] {
  if (path.type === 'POLYLINE') return path.points.map((point) => ({ ...point }));
  if (path.type === 'LINE') return [{ ...path.start }, { ...path.end }];
  const count = path.type === 'ARC' ? Math.max(16, sampleCount) : sampleCount;
  const length = pathLength(path);
  return Array.from({ length: count + 1 }, (_, index) => pointAtDistance(path, (length * index) / count).point);
}
