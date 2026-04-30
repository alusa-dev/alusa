/** Image utilities: load and crop images via canvas with high quality scaling. */

export async function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

export interface GenerateCroppedOptions {
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  quality?: number; // 0..1 (jpeg/webp)
  exportSize?: number; // maior lado resultante
}

type HighQualityCtx = CanvasRenderingContext2D & {
  imageSmoothingQuality: 'low' | 'medium' | 'high';
};

export async function generateCroppedImage(
  imageSrc: string,
  areaPixels: import('react-easy-crop').Area,
  opts: GenerateCroppedOptions = {},
): Promise<{ dataUrl: string; blob: Blob; width: number; height: number }> {
  const { mimeType = 'image/jpeg', quality = 0.9, exportSize } = opts;
  const image = await createImage(imageSrc);
  const { width, height, x, y } = areaPixels;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as HighQualityCtx | null;
  if (!ctx) throw new Error('Canvas 2D context not available');

  canvas.width = width;
  canvas.height = height;

  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality !== undefined) ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);

  // Optional scale pass
  if (exportSize && exportSize > 0) {
    const longest = Math.max(width, height);
    if (longest !== exportSize) {
      const scale = exportSize / longest;
      const targetW = Math.round(width * scale);
      const targetH = Math.round(height * scale);
      const scaled = document.createElement('canvas');
      scaled.width = targetW;
      scaled.height = targetH;
      const sctx = scaled.getContext('2d') as HighQualityCtx | null;
      if (!sctx) throw new Error('Canvas 2D context not available (scale)');
      sctx.imageSmoothingEnabled = true;
      if (sctx.imageSmoothingQuality !== undefined) sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(canvas, 0, 0, targetW, targetH);
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(scaled, 0, 0);
    }
  }

  const dataUrl = canvas.toDataURL(mimeType, mimeType === 'image/png' ? undefined : quality);
  const blob = await (await fetch(dataUrl)).blob();
  return { dataUrl, blob, width: canvas.width, height: canvas.height };
}
