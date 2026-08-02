'use client';

import * as React from 'react';
import Cropper, { type Area, type MediaSize } from 'react-easy-crop';
import { cn } from '@/lib/cn';

export type ImageCropperProps = {
  image: string;
  aspect?: number; // default 1
  round?: boolean; // default true
  showGridWhenRect?: boolean; // exibe grid se não for round
  crop: { x: number; y: number };
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  onCropChange: (_c: { x: number; y: number }) => void;
  onZoomChange: (_z: number) => void;
  onCropComplete: (_area: Area) => void; // area em px
  onMediaLoaded?: (_media: MediaSize) => void;
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
  minZoom = 1,
  maxZoom = 3,
  onCropChange,
  onZoomChange,
  onCropComplete,
  onMediaLoaded,
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
        minZoom={minZoom}
        maxZoom={maxZoom}
        aspect={aspect}
        onCropChange={onCropChange}
        onZoomChange={onZoomChange}
        onCropComplete={(_, area) => onCropComplete(area)}
        onMediaLoaded={onMediaLoaded}
        objectFit="cover"
        showGrid={!round && showGridWhenRect}
        restrictPosition
        cropShape={round ? 'round' : 'rect'}
        style={round ? { cropAreaStyle: { border: '2px solid rgb(255 255 255)' } } : undefined}
        roundCropAreaPixels
        zoomWithScroll
        zoomSpeed={0.8}
        keyboardStep={2}
      />
    </div>
  );
});

export default ImageCropper;
