export type { SmartCorridor, SmartCorridorAxis, CorridorBehavior, CorridorImpact, CorridorWarning, VisualSeatBlock, CorridorAttachment } from './types.js';
export { getCorridorCoreBounds, getCorridorClearanceBounds } from './types.js';
export { normalizeCorridor, snapSmartCorridorRotation, classifyCorridorAxis } from './normalize-corridor.js';
export { corridorToPolygon, corridorClearanceToPolygon } from './corridor-to-polygon.js';
export { mergeCorridorPolygons, corridorPolygonsIntersect, mergePolygons, clippingPolygonsIntersect } from './merge-corridors.js';
export { detectCorridorImpact, calculateAllCorridorImpacts } from './detect-corridor-impact.js';
