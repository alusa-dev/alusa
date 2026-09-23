import type { MapCommand } from '@alusa/domain';

export type CanvasTransformCommand = Extract<
  MapCommand,
  {
    type:
      | 'RESIZE_OBJECTS'
      | 'RESIZE_SELECTION'
      | 'ROTATE_OBJECTS'
      | 'ROTATE_SELECTION'
      | 'MOVE_OBJECTS'
      | 'MOVE_SELECTION';
  }
>;
