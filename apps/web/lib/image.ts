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

export type CroppedImageResult = {
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
  wasUpscaled: boolean;
};

type HighQualityCtx = CanvasRenderingContext2D & {
  imageSmoothingQuality: 'low' | 'medium' | 'high';
};

export async function generateCroppedImage(
  imageSrc: string,
  areaPixels: import('react-easy-crop').Area,
  opts: GenerateCroppedOptions = {},
): Promise<CroppedImageResult> {
  const { mimeType = 'image/jpeg', exportSize } = opts;
  const quality = Math.min(Math.max(opts.quality ?? 0.9, 0), 1);
  const image = await createImage(imageSrc);
  const width = Math.max(1, Math.round(areaPixels.width));
  const height = Math.max(1, Math.round(areaPixels.height));
  const x = Math.max(0, Math.round(areaPixels.x));
  const y = Math.max(0, Math.round(areaPixels.y));
  const longest = Math.max(width, height);
  const normalizedExportSize = exportSize && exportSize > 0 ? Math.round(exportSize) : longest;
  const scale = normalizedExportSize / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as HighQualityCtx | null;
  if (!ctx) throw new Error('Canvas 2D context not available');

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality !== undefined) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, y, width, height, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('Não foi possível codificar a imagem.')),
      mimeType,
      mimeType === 'image/png' ? undefined : quality,
    );
  });
  const dataUrl = await blobToDataUrl(blob);

  return {
    dataUrl,
    blob,
    width: targetWidth,
    height: targetHeight,
    wasUpscaled: normalizedExportSize > longest,
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Não foi possível ler a imagem processada.'));
    reader.onerror = () => reject(reader.error ?? new Error('Não foi possível ler a imagem processada.'));
    reader.readAsDataURL(blob);
  });
}
