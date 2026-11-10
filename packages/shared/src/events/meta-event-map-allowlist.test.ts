import { describe, expect, it } from 'vitest';

import { isMetaPixelMapSlug, META_PIXEL_MAP_SLUGS } from './meta-event-map-allowlist';

describe('Meta event map allowlist', () => {
  it('shares only the two approved public map slugs', () => {
    expect([...META_PIXEL_MAP_SLUGS]).toEqual([
      'map_58c37147e01c496f92bc6f5f',
      'map_dc0c9a1a841941138d558b3d',
    ]);
    expect(isMetaPixelMapSlug('map_58c37147e01c496f92bc6f5f')).toBe(true);
    expect(isMetaPixelMapSlug('other-map')).toBe(false);
  });
});
