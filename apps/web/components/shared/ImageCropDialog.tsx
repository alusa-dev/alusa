'use client';

import * as React from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { Button } from '@/components/ui/button';

export interface ImageCropDialogProps {
  src: string | null;
  open: boolean;
  aspect?: number;
  onClose: () => void;
  onApply: (_dataUrl: string) => void;
  title?: string;
  maxZoom?: number;
  mimeType?: string;
  quality?: number;
  round?: boolean;
  className?: string;
}

/* Util: cria elemento de imagem */
async function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/* Util: gera DataURL do recorte */
async function getCroppedImage(
  src: string,
  croppedAreaPixels: Area,
  mimeType: string,
  quality: number,
): Promise<string> {
  const image = await createImage(src);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context não disponível');
  const { width, height, x, y } = croppedAreaPixels;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL(mimeType, quality);
}

export function ImageCropDialog({
  src,
  open,
  aspect = 1,
  onClose,
  onApply,
  title = 'Ajustar corte',
  maxZoom = 3,
  mimeType = 'image/jpeg',
  quality = 0.9,
  className,
  round = true,
}: ImageCropDialogProps) {
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }, [open, src]);

  const onCropComplete = React.useCallback(
    (_: Area, areaPixels: Area) => setCroppedAreaPixels(areaPixels),
    [],
  );

  async function handleApply() {
    if (!src || !croppedAreaPixels) return;
    try {
      const dataUrl = await getCroppedImage(src, croppedAreaPixels, mimeType, quality);
      onApply(dataUrl);
      onClose(); // fecha modal após aplicar
    } catch (err) {
      console.error('Erro ao gerar recorte', err);
    }
  }

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 ${className || ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-lg space-y-4">
        <h4 id="crop-dialog-title" className="text-sm font-semibold text-slate-800">
          {title}
        </h4>

        <div className="relative h-72 w-full overflow-hidden rounded-md bg-slate-900/5">
          {src && (
            <>
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                objectFit="cover"
                cropShape={round ? 'round' : 'rect'}
                showGrid={false}
              />
              {round && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-[88%] aspect-square rounded-full ring-1 ring-white/40" />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={maxZoom}
            step={0.05}
            value={zoom}
            aria-label="Zoom da imagem"
            aria-valuemin={1}
            aria-valuemax={maxZoom}
            aria-valuenow={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full"
          />
          <span className="text-[11px] text-slate-500 w-10 text-right">{zoom.toFixed(2)}x</span>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-violet-600 text-white hover:bg-violet-700"
            onClick={handleApply}
          >
            Aplicar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ImageCropDialog;
