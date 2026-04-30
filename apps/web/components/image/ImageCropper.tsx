'use client';

import * as React from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { cn } from '@/lib/cn';

export type ImageCropperProps = {
  image: string;
  aspect?: number; // default 1
  round?: boolean; // default true
  showGridWhenRect?: boolean; // exibe grid se não for round
  crop: { x: number; y: number };
  zoom: number;
  onCropChange: (_c: { x: number; y: number }) => void;
  onZoomChange: (_z: number) => void;
  onCropComplete: (_area: Area) => void; // area em px
  className?: string;
};

/**
 * Stateless wrapper sobre react-easy-crop.
 * Responsável apenas por renderizar o cropper e overlays auxiliares.
 */
export const ImageCropper = React.memo(function ImageCropper({
  image,
  aspect = 1,
  round = true,
  showGridWhenRect = true,
  crop,
  zoom,
  onCropChange,
  onZoomChange,
  onCropComplete,
  className,
}: ImageCropperProps) {
  return (
    <div
      className={cn('relative w-full h-full overflow-hidden bg-slate-900/5 rounded-md', className)}
    >
      <Cropper
        image={image}
        crop={crop}
        zoom={zoom}
        aspect={aspect}
        onCropChange={onCropChange}
        onZoomChange={onZoomChange}
        onCropComplete={(_, area) => onCropComplete(area)}
        objectFit="cover"
        showGrid={!round && showGridWhenRect}
        restrictPosition
        cropShape={round ? 'round' : 'rect'}
      />
      {round && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[88%] aspect-square rounded-full ring-1 ring-white/40" />
        </div>
      )}
    </div>
  );
});

export default ImageCropper;
