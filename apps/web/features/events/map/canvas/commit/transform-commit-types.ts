import type { MapCommand } from '@alusa/domain';

export type CanvasTransformCommand = Extract<
  MapCommand,
  { type: 'TRANSFORM_CORRIDOR' | 'RESIZE_OBJECTS' | 'ROTATE_OBJECTS' | 'MOVE_OBJECTS' }
>;
