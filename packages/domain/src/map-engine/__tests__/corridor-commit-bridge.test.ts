import { corridorPatchesToDomainOperations } from '../transform/corridor-commit-bridge.js';

import { describe, expect, it } from 'vitest';

describe('transform/corridor-commit-bridge', () => {
  it('maps single rotate patch to ROTATE_CORRIDOR', () => {
    const ops = corridorPatchesToDomainOperations([
      {
        objectId: 'c1',
        mode: 'rotate',
        patch: { x: 1, y: 2, width: 32, height: 280, rotation: 90 },
      },
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('ROTATE_CORRIDOR');
  });

  it('maps group patches to TRANSFORM_CORRIDOR_GROUP', () => {
    const ops = corridorPatchesToDomainOperations([
      {
        objectId: 'c1',
        mode: 'group-rotate',
        patch: { x: 1, y: 2, width: 32, height: 280, rotation: 90 },
      },
      {
        objectId: 'c2',
        mode: 'group-rotate',
        patch: { x: 3, y: 4, width: 180, height: 40, rotation: 90 },
      },
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('TRANSFORM_CORRIDOR_GROUP');
  });
});
