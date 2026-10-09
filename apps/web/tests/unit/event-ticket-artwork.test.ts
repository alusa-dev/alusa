import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeEventTicketArtwork, validateTicketArtworkFile } from '@/src/server/media/event-ticket-artwork-storage.service';

function file(name: string, type: string, size = 10) {
  return new File([new Uint8Array(size)], name, { type });
}

describe('event ticket artwork upload validation', () => {
  it('accepts supported image types within the size limit', () => {
    expect(validateTicketArtworkFile(file('art.png', 'image/png'))).toBeNull();
  });

  it('rejects unsupported MIME types and oversized files', () => {
    expect(validateTicketArtworkFile(file('art.svg', 'image/svg+xml'))).toContain('JPG, PNG ou WebP');
    expect(validateTicketArtworkFile(file('art.jpg', 'image/jpeg', 3 * 1024 * 1024 + 1))).toContain('3 MB');
  });

  it('normalizes accepted artwork into a square print-ready JPEG', async () => {
    const input = await sharp({
      create: { width: 80, height: 40, channels: 3, background: { r: 92, g: 35, b: 160 } },
    }).png().toBuffer();

    const output = await normalizeEventTicketArtwork(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(1200);
    expect(output.byteLength).toBeLessThan(250_000);
  });
});
