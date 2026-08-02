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
import { generateCroppedImage, type CroppedImageResult } from '@/lib/image';
import type { Area } from 'react-easy-crop';
import { cn } from '@/lib/utils';
import { Minus, Plus } from '@/components/icons/icons';

export type ImageCropDialogProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  src: string | null;
  aspect?: number;
  round?: boolean;
  minZoom?: number;
  maxZoom?: number;
  exportMime?: 'image/jpeg' | 'image/png' | 'image/webp';
  exportQuality?: number; // 0..1
  exportSize?: number; // lado maior final (default 512)
  showGridWhenRect?: boolean;
  title?: string;
  description?: string;
  applyLabel?: string;
  applyingLabel?: string;
  onApply: (_result: CroppedImageResult) => void | Promise<void>;
  className?: string;
};

export function ImageCropDialog({
  open,
  onOpenChange,
  src,
  aspect = 1,
  round = true,
  minZoom = 1,
  maxZoom = 3,
  exportMime = 'image/jpeg',
  exportQuality = 0.9,
  exportSize = 512,
  title = 'Ajustar corte',
  description = 'Arraste a imagem para enquadrar e use o controle para ajustar o zoom.',
  applyLabel = 'Aplicar recorte',
  applyingLabel = 'Processando...',
  onApply,
  className,
  showGridWhenRect = true,
}: ImageCropDialogProps) {
  const zoomControlId = React.useId();
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset quando dialog abre ou src muda
  React.useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(minZoom);
    setCroppedAreaPixels(null);
    setLoading(false);
    setError(null);
  }, [open, src, minZoom]);

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
      await onApply(result);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error && e.message
        ? e.message
        : 'Não foi possível salvar a imagem. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const updateZoom = React.useCallback((nextZoom: number) => {
    setZoom(Math.min(maxZoom, Math.max(minZoom, Number(nextZoom.toFixed(2)))));
  }, [maxZoom, minZoom]);

  const lowResolution = Boolean(
    croppedAreaPixels && exportSize > 0 && (
      croppedAreaPixels.width < exportSize || croppedAreaPixels.height < exportSize
    ),
  );

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (loading && !nextOpen) return;
    onOpenChange(nextOpen);
  }, [loading, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[520px] flex-col gap-0 overflow-hidden rounded-2xl border-white/70 p-0 shadow-xl sm:w-full',
          className,
        )}
        closeDisabled={loading}
        aria-busy={loading}
      >
        <DialogHeader className="shrink-0 gap-1 px-4 pb-3 pt-4 pr-11 text-left sm:px-5 sm:pt-5">
          <DialogTitle className="text-base font-semibold tracking-[-0.01em] text-slate-950">
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-slate-600">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 [scrollbar-gutter:stable] sm:px-5">
          <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-xl bg-slate-950">
            {src ? (
              <ImageCropper
                image={src}
                aspect={aspect}
                round={round}
                showGridWhenRect={showGridWhenRect}
                crop={crop}
                zoom={zoom}
                minZoom={minZoom}
                maxZoom={maxZoom}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
                className="rounded-xl bg-slate-950"
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-md bg-slate-100 text-xs text-slate-500">
                Sem imagem
              </div>
            )}
            {loading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-950/65 text-white backdrop-blur-[2px]">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                <span className="text-sm font-medium">{applyingLabel}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3" role="group" aria-label="Controle de zoom">
              <label htmlFor={zoomControlId} className="sr-only">
                Zoom
              </label>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => updateZoom(zoom - 0.1)}
                disabled={!src || loading || zoom <= minZoom}
                className="size-9 shrink-0 rounded-full border-slate-200 bg-white text-slate-600 shadow-none hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                aria-label="Diminuir zoom"
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </Button>
              <input
                id={zoomControlId}
                type="range"
                min={minZoom}
                max={maxZoom}
                step={0.01}
                value={zoom}
                aria-label="Zoom da imagem"
                aria-valuemin={minZoom}
                aria-valuemax={maxZoom}
                aria-valuenow={zoom}
                aria-valuetext={`${Math.round(zoom * 100)} por cento`}
                onChange={(e) => updateZoom(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-violet-700 disabled:cursor-not-allowed [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-violet-700 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-violet-700 [&::-webkit-slider-thumb]:shadow-sm"
                disabled={!src || loading}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => updateZoom(zoom + 0.1)}
                disabled={!src || loading || zoom >= maxZoom}
                className="size-9 shrink-0 rounded-full border-slate-200 bg-white text-slate-600 shadow-none hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                aria-label="Aumentar zoom"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
          </div>
          {lowResolution ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              O recorte selecionado tem menos de {exportSize}×{exportSize}px e poderá perder nitidez.
            </p>
          ) : null}
          {error ? (
            <p role="alert" aria-live="polite" className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 bg-white px-4 pb-4 pt-5 sm:px-5 sm:pb-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
            className="h-9 min-w-24 border-slate-200 text-sm text-slate-700 shadow-none hover:bg-slate-50"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={!croppedAreaPixels || loading}
            className="h-9 min-w-28 bg-violet-700 text-sm text-white shadow-none hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? applyingLabel : applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImageCropDialog;
