import { describe, expect, it } from 'vitest';
import { readBoundedFormData } from '@/lib/upload-request';

describe('readBoundedFormData', () => {
  it('rejects an oversized declared request before parsing', async () => {
    const request = new Request('https://example.test/api/upload', {
      method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '100' }, body: '--x--',
    });
    await expect(readBoundedFormData(request, 10)).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it('enforces the limit when content length is missing', async () => {
    const body = new Uint8Array(32);
    const request = new Request('https://example.test/api/upload', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
    });
    await expect(readBoundedFormData(request, 16)).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it('parses a bounded multipart body', async () => {
    const form = new FormData();
    form.set('metadata', 'ok');
    const request = new Request('https://example.test/api/upload', { method: 'POST', body: form });
    const result = await readBoundedFormData(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.formData.get('metadata')).toBe('ok');
  });
});
