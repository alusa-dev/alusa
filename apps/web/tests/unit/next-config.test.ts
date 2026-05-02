/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config.mjs';

describe('next.config rewrites', () => {
  it('protege /uploads antes do filesystem público do Next', async () => {
    const rewrites = await nextConfig.rewrites?.();

    expect(rewrites).toEqual(
      expect.objectContaining({
        beforeFiles: expect.arrayContaining([
          { source: '/uploads/:path*', destination: '/api/files/uploads/:path*' },
        ]),
      }),
    );
  });
});
