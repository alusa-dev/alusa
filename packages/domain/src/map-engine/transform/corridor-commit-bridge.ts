import type { CorridorTransformPreviewPatch } from '../layout/corridor/index.js';

export type CorridorTransformBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResizeCorridorEdgeOp = {
  kind: 'RESIZE_CORRIDOR_EDGE';
  corridorId: string;
  bounds: CorridorTransformBounds;
  rotation: number;
  handle: string;
};

export type RotateCorridorOp = {
  kind: 'ROTATE_CORRIDOR';
  corridorId: string;
  bounds: CorridorTransformBounds;
  rotation: number;
};

export type TransformCorridorGroupOp = {
  kind: 'TRANSFORM_CORRIDOR_GROUP';
  corridorIds: string[];
  mode: 'group-rotate' | 'group-resize';
  patches: Array<{
    corridorId: string;
    bounds: CorridorTransformBounds;
    rotation: number;
  }>;
};

/** Build domain corridor transform operations from editor commit patches. */
export function corridorPatchesToDomainOperations(
  patches: CorridorTransformPreviewPatch[],
  fallbackAnchor?: string,
): Array<ResizeCorridorEdgeOp | RotateCorridorOp | TransformCorridorGroupOp> {
  if (patches.length === 0) return [];

  const resolveHandle = (patch: CorridorTransformPreviewPatch) =>
    patch.anchor ?? fallbackAnchor ?? 'middle-right';

  if (patches.length === 1) {
    const patch = patches[0]!;
    const bounds = {
      x: patch.patch.x ?? 0,
      y: patch.patch.y ?? 0,
      width: patch.patch.width ?? 32,
      height: patch.patch.height ?? 280,
    };
    const rotation = patch.patch.rotation ?? 0;

    if (patch.mode === 'rotate' || patch.mode === 'group-rotate') {
      return [
        {
          kind: 'ROTATE_CORRIDOR',
          corridorId: patch.objectId,
          rotation,
          bounds,
        },
      ];
    }

    return [
      {
        kind: 'RESIZE_CORRIDOR_EDGE',
        corridorId: patch.objectId,
        bounds,
        rotation,
        handle: resolveHandle(patch),
      },
    ];
  }

  const mode = patches[0]?.mode === 'group-rotate' ? 'group-rotate' : 'group-resize';
  return [
    {
      kind: 'TRANSFORM_CORRIDOR_GROUP',
      corridorIds: patches.map((entry) => entry.objectId),
      mode,
      patches: patches.map((entry) => ({
        corridorId: entry.objectId,
        bounds: {
          x: entry.patch.x ?? 0,
          y: entry.patch.y ?? 0,
          width: entry.patch.width ?? 32,
          height: entry.patch.height ?? 280,
        },
        rotation: entry.patch.rotation ?? 0,
      })),
    },
  ];
}
