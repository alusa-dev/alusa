import type { Point } from '../geometry/types.js';
import type { SmartCorridor } from './types.js';
import { rectToPolygon, createMatrix } from '../geometry/transform.js';
import { getCorridorCoreBounds } from './types.js';

/**
 * Converte o corredor em um polígono de 4 pontos em world-space.
 * Suporta rotação arbitrária (origin no ponto x/y do corredor).
 */
export function corridorToPolygon(corridor: SmartCorridor): Point[] {
  const bounds = getCorridorCoreBounds(corridor);
  const matrix = createMatrix({
    x: bounds.x,
    y: bounds.y,
    rotation: corridor.rotation,
    scaleX: 1,
    scaleY: 1,
  });
  // bounds com origin em 0,0 para que a matrix cuide da translação
  return rectToPolygon(
    { x: 0, y: 0, width: bounds.width, height: bounds.height },
    matrix,
  );
}

/**
 * Converte o corredor + clearance em polígono world-space.
 */
export function corridorClearanceToPolygon(corridor: SmartCorridor): Point[] {
  const bounds = {
    x: -corridor.clearance,
    y: -corridor.clearance,
    width: corridor.length + corridor.clearance * 2,
    height: corridor.thickness + corridor.clearance * 2,
  };
  const matrix = createMatrix({
    x: corridor.x,
    y: corridor.y,
    rotation: corridor.rotation,
    scaleX: 1,
    scaleY: 1,
  });
  return rectToPolygon(bounds, matrix);
}
