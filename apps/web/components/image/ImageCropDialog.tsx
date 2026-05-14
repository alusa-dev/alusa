'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ImageCropper } from './ImageCropper';
import { generateCroppedImage } from '@/lib/image';
import type { Area } from 'react-easy-crop';
import { cn } from '@/lib/utils';

export type ImageCropDialogProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  src: string | null;
  aspect?: number;
  round?: boolean;
  maxZoom?: number;
  exportMime?: 'image/jpeg' | 'image/png' | 'image/webp';
  exportQuality?: number; // 0..1
  exportSize?: number; // lado maior final (default 512)
  showGridWhenRect?: boolean;
  title?: string;
  onApply: (_result: { dataUrl: string; blob: Blob; width: number; height: number }) => void;
  className?: string;
};

export function ImageCropDialog({
  open,
  onOpenChange,
  src,
  aspect = 1,
  round = true,
  maxZoom = 3,
  exportMime = 'image/jpeg',
  exportQuality = 0.9,
  exportSize = 512,
  title = 'Ajustar corte',
  onApply,
  className,
  showGridWhenRect = true,
}: ImageCropDialogProps) {
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset quando dialog abre ou src muda
  React.useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setLoading(false);
    setError(null);
  }, [open, src]);

  const handleCropComplete = React.useCallback((area: Area) => {
    setCroppedAreaPixels(area);
  }, []);

  async function handleApply() {
    if (!src || !croppedAreaPixels) return;
    setLoading(true);
    setError(null);
    try {
      const result = await generateCroppedImage(src, croppedAreaPixels, {
        mimeType: exportMime,
        quality: exportQuality,
        exportSize,
      });
      onApply(result);
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      setError('Não foi possível gerar o recorte. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[calc(100vw-2rem)] max-w-lg gap-4 rounded-2xl sm:w-full',
          className,
        )}
        aria-labelledby="image-crop-title"
      >
        <DialogHeader>
          <DialogTitle id="image-crop-title">{title}</DialogTitle>
          <DialogDescription className="text-xs text-slate-600">
            Ajuste o zoom e posicione o recorte antes de aplicar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative h-72 w-full">
            {src ? (
              <ImageCropper
                image={src}
                aspect={aspect}
                round={round}
                showGridWhenRect={showGridWhenRect}
                crop={crop}
                zoom={zoom}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-md bg-slate-100 text-xs text-slate-500">
                Sem imagem
              </div>
            )}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-white/60">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-violet-600" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={maxZoom}
              step={0.05}
              value={zoom}
              aria-label="Zoom"
              aria-valuemin={1}
              aria-valuemax={maxZoom}
              aria-valuenow={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
              disabled={!src || loading}
            />
            <span className="w-12 text-right text-[11px] text-slate-500">{zoom.toFixed(2)}x</span>
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Use imagens quadradas e bem iluminadas; o recorte será ajustado depois.
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={!croppedAreaPixels || loading}
            className="bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Aplicando...' : 'Aplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImageCropDialog;
