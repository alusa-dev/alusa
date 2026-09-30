import { describe, expect, it } from 'vitest';

import { detectMimeTypeFromBuffer, validateImageDimensions, validateUploadBuffer } from '@/lib/upload-security';

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

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

  it('rejeita imagens acima do limite compartilhado de pixels ou dimensão lateral', () => {
    const oversized = pngHeader(10_000, 5_000);
    expect(validateImageDimensions(oversized)).toMatchObject({ ok: false });
    expect(validateUploadBuffer({
      buffer: oversized,
      fileName: 'product.png',
      declaredMimeType: 'image/png',
      fileSize: oversized.byteLength,
      maxSizeBytes: 1024,
      allowedMimeTypes: ['image/png'],
      allowedExtensions: ['.png'],
    })).toEqual({
      ok: false,
      error: 'Imagem excede o limite de dimensões permitido (máximo 40 megapixels e 16.384 px por lado).',
    });
  });

  it('aceita imagem dentro do limite compartilhado', () => {
    expect(validateImageDimensions(pngHeader(2_000, 2_000))).toEqual({ ok: true, width: 2_000, height: 2_000 });
  });
});
