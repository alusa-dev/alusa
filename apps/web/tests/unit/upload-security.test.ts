import { describe, expect, it } from 'vitest';

import { detectMimeTypeFromBuffer, validateUploadBuffer } from '@/lib/upload-security';

describe('upload-security', () => {
  it('detecta assinatura mágica de PDF', () => {
    const buffer = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

    expect(detectMimeTypeFromBuffer(buffer)).toBe('application/pdf');
  });

  it('rejeita arquivo quando MIME declarado diverge do conteúdo real', () => {
    const buffer = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

    const result = validateUploadBuffer({
      buffer,
      fileName: 'avatar.jpg',
      declaredMimeType: 'image/jpeg',
      fileSize: buffer.byteLength,
      maxSizeBytes: 1024,
      allowedMimeTypes: ['application/pdf', 'image/jpeg'],
      allowedExtensions: ['.pdf', '.jpg'],
    });

    expect(result).toEqual({
      ok: false,
      error: 'Tipo declarado do arquivo não confere com o conteúdo.',
    });
  });
});
