import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { buildCanvasTransformCommand, type TransformCommitPayload } from './build-canvas-transform-command';
import type { CanvasTransformCommand } from './transform-commit-types';

export function applyCanvasTransformCommit(command: CanvasTransformCommand | null) {
  if (!command) return;
  useEventMapEditorStore.getState().applyTransform(command);
}

export function applyCanvasTransformPayload(
  payload: TransformCommitPayload | null,
  options?: { forceCorridor?: boolean },
) {
  if (!payload) return;
  const map = useEventMapEditorStore.getState().map;
  applyCanvasTransformCommit(buildCanvasTransformCommand(payload, map, options));
}

export type { CanvasTransformCommand } from './transform-commit-types';
