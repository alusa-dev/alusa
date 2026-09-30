import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPresignedUpload } from '@/lib/r2-storage';

describe('presigned R2 upload contract', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('signs the exact content length and content type and requires reservation metadata', async () => {
    vi.stubEnv('R2_BUCKET_NAME', 'alusa-test-bucket');
    vi.stubEnv('R2_ACCOUNT_ID', 'test-account');
    vi.stubEnv('R2_ACCESS_KEY_ID', 'test-access-key');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret-key');

    const signed = await createPresignedUpload({
      key: 'uploads/pending/conta-1/12345678-1234-1234-1234-123456789012',
      contentType: 'application/pdf',
      reservationId: '12345678-1234-1234-1234-123456789012',
      expectedSize: 1234,
      expiresInSeconds: 60,
    });
    const url = new URL(signed);
    const signedHeaders = decodeURIComponent(url.searchParams.get('X-Amz-SignedHeaders') ?? '');
    expect(signedHeaders.split(';')).toContain('content-length');
    expect(signedHeaders.split(';')).toContain('content-type');
    expect(signedHeaders.split(';')).toContain('x-amz-meta-upload-reservation-id');
    expect(signedHeaders.split(';')).toContain('x-amz-meta-expected-size');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
  });
});
