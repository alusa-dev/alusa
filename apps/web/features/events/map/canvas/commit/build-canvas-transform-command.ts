import { classifyTransformPayload, type TransformCommandPayload } from '@alusa/domain';
import type { EventMapDTO } from '../../api/event-map-service';
import type { CanvasTransformCommand } from './transform-commit-types';

export type TransformCommitPayload = TransformCommandPayload;

/** Classify generic transform payload into semantic transform commands. */
export function buildCanvasTransformCommand(
  payload: TransformCommitPayload,
  map: EventMapDTO | null,
): CanvasTransformCommand | null {
  return classifyTransformPayload(payload, map) as CanvasTransformCommand | null;
}
