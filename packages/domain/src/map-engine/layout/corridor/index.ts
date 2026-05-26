export {
  cloneEventMap,
  DEFAULT_CORRIDOR_GAP,
  DEFAULT_CORRIDOR_THICKNESS,
  expandRectWithSpacing,
  getCorridorSpacing,
  inferCorridorAxisFromSize,
  inferSmartCorridorAxisFromCoreRect,
  MIN_CORRIDOR_THICKNESS,
  readCorridorThickness,
  reconcileCorridorGeometry,
  resolveSmartCorridorLayout,
} from '../smart-corridor-layout.js';
export { toGlobal, toLocal } from '../../geometry/rotation.js';

export {
  applyCorridorReflow,
  CORRIDOR_DRAG_COMMIT_ITERATIONS,
  CORRIDOR_DRAG_PREVIEW_ITERATIONS,
  CORRIDOR_REFLOW_ITERATIONS,
  type CorridorReflowOptions,
} from './corridor-reflow.js';

export {
  buildRigidGroupDragPreview,
  buildSmartCorridorDragPreview,
  resolveCorridorDragMode,
} from './corridor-drag-preview.js';

export type {
  CorridorDragMode,
  CorridorDragSession,
  SmartCorridorDragPreviewOptions,
} from './corridor-preview-types.js';

export {
  applyCorridorPreviewPatch,
  buildSmartCorridorTransformPreview,
  resetCorridorPreviewFromBase,
  type CorridorTransformPreviewPatch,
} from './corridor-transform-preview.js';

export {
  corridorAffectsSection,
  collectAffectedSectionIds,
  getSectionContext,
  mapCorridorToSectionLocal,
  translateSectionCorridorBase,
  translateSeatCorridorBase,
} from './corridor-section-base.js';

export {
  ensureCorridorSplitAnchors,
  getCorridorSplitCenter,
  isCorridorAutoFit,
  persistCorridorMetadataOnly,
  resolveCorridorAxis,
  updateCorridorSplitAnchors,
  updateCorridorSplitAnchorsOnDrag,
  type CorridorAxis,
} from './corridor-split-anchors.js';

export {
  extractCorridorDragCommitUpdates,
  extractGroupDragCommitUpdates,
} from './corridor-extract-commit.js';
