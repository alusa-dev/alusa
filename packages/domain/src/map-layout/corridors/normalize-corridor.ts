import type { SmartCorridor, SmartCorridorAxis } from './types.js';

const QUARTER_TURNS = [0, 90, 180, 270];

/**
 * Restringe a rotação ao quarter-turn mais próximo.
 * Invariante MVP: corredores só giram em 90°.
 */
export function snapSmartCorridorRotation(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360;
  let closest = QUARTER_TURNS[0];
  let minDiff = Infinity;
  for (const turn of QUARTER_TURNS) {
    const rawDiff = Math.abs(normalized - turn);
    // considera wrap-around: 350° está a 10° de 0°
    const diff = Math.min(rawDiff, 360 - rawDiff);
    if (diff < minDiff) {
      minDiff = diff;
      closest = turn;
    }
  }
  return closest;
}

/**
 * Deriva o eixo a partir da rotação normalizada.
 * 0° / 180° → HORIZONTAL  |  90° / 270° → VERTICAL
 */
export function classifyCorridorAxis(rotationDeg: number): SmartCorridorAxis {
  const snapped = snapSmartCorridorRotation(rotationDeg);
  return snapped === 90 || snapped === 270 ? 'VERTICAL' : 'HORIZONTAL';
}

/** Normaliza todos os campos derivados de um SmartCorridor. */
export function normalizeCorridor(raw: SmartCorridor): SmartCorridor {
  const rotation = snapSmartCorridorRotation(raw.rotation);
  const axis = classifyCorridorAxis(rotation);
  return {
    ...raw,
    rotation,
    axis,
    thickness: Math.max(1, raw.thickness),
    length: Math.max(1, raw.length),
    clearance: Math.max(0, raw.clearance),
  };
}
