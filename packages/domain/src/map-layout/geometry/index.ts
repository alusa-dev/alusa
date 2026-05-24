export type { ID, Point, Size, Bounds, Matrix2D, Transform2D } from './types.js';
export { toRadians, toDegrees, createMatrix, multiplyPoint, rectToPolygon, worldDeltaToLocalDelta, rotatePointAroundCenter, getSelectionCenter, scalePointFromBounds, polygonToBounds, boundsOverlap } from './transform.js';
export { polygonsIntersect, pointInPolygon } from './collision.js';
export type { SpatialItem } from './spatial-index.js';
export { buildSpatialIndex, findCandidateItems, boundsToSpatialItem } from './spatial-index.js';
