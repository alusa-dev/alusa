import { corridorPatchesToDomainOperations } from '../corridor-domain-transform-bridge';

import { describe, expect, it } from 'vitest';

describe('corridor-domain-transform-bridge', () => {
  it('preserves anchor on single resize operations', () => {
    const ops = corridorPatchesToDomainOperations([
      {
        objectId: 'c1',
        mode: 'resize',
        anchor: 'middle-left',
        patch: { x: 1, y: 2, width: 32, height: 280, rotation: 0 },
      },
    ]);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      kind: 'RESIZE_CORRIDOR_EDGE',
      handle: 'middle-left',
    });
  });

  it('falls back to session anchor when patch anchor is missing', () => {
    const ops = corridorPatchesToDomainOperations(
      [
        {
          objectId: 'c1',
          mode: 'resize',
          patch: { x: 0, y: 0, width: 40, height: 300, rotation: 90 },
        },
      ],
      'top-center',
    );

    expect(ops[0]).toMatchObject({ handle: 'top-center' });
  });
});
