import { classifyTransformPayload, type TransformCommandPayload } from '@alusa/domain';
import type { EventMapDTO } from '../../api/event-map-service';
import type { CanvasTransformCommand } from './transform-commit-types';

export type TransformCommitPayload = TransformCommandPayload;

/** Classify generic transform payload into semantic transform commands. */
export function buildCanvasTransformCommand(
  payload: TransformCommitPayload,
  map: EventMapDTO | null,
  options?: { forceCorridor?: boolean },
): CanvasTransformCommand | null {
  return classifyTransformPayload(payload, map, options) as CanvasTransformCommand | null;
}
