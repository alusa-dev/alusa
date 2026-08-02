import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateCroppedImage } from '@/lib/image';

describe('generateCroppedImage', () => {
  const originalCreateElement = document.createElement.bind(document);
  const drawImage = vi.fn();
  const context = {
    drawImage,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  };

  beforeEach(() => {
    drawImage.mockReset();

    class LoadedImage {
      crossOrigin = '';
      onload: null | (() => void) = null;
      onerror: null | ((_event: Event) => void) = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal('Image', LoadedImage);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      return {
        width: 0,
        height: 0,
        getContext: () => context,
        toBlob: (callback: BlobCallback, mimeType?: string) => {
          callback(new Blob([Uint8Array.from([1, 2, 3])], { type: mimeType ?? 'image/jpeg' }));
        },
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exporta o recorte quadrado diretamente em 512 por 512', async () => {
    const result = await generateCroppedImage(
      'blob:source',
      { x: 10.2, y: 20.4, width: 800, height: 800 },
      { mimeType: 'image/jpeg', quality: 0.9, exportSize: 512 },
    );

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.wasUpscaled).toBe(false);
    expect(result.blob.type).toBe('image/jpeg');
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 10, 20, 800, 800, 0, 0, 512, 512);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe('high');
  });

  it('informa quando o recorte precisa ser ampliado', async () => {
    const result = await generateCroppedImage(
      'blob:source',
      { x: 0, y: 0, width: 240, height: 240 },
      { exportSize: 512 },
    );

    expect(result.wasUpscaled).toBe(true);
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
  });
});
