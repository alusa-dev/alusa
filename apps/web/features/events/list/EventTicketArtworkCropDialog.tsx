'use client';

import { useRef } from 'react';

import { ImageCropDialog } from '@/components/image/ImageCropDialog';

type EventTicketArtworkCropDialogProps = {
  open: boolean;
  imageUrl: string | null;
  onCancel: () => void;
  onConfirm: (_file: File) => void;
};

export function EventTicketArtworkCropDialog({ open, imageUrl, onCancel, onConfirm }: EventTicketArtworkCropDialogProps) {
  const skipNextCloseRef = useRef(false);

  return (
    <ImageCropDialog
      open={open}
      src={imageUrl}
      disableBackdropBlur
      aspect={1}
      round={false}
      exportMime="image/jpeg"
      exportQuality={0.9}
      exportSize={1200}
      title="Enquadrar imagem do ingresso"
      description="Arraste a imagem e ajuste o zoom. A área quadrada será preenchida por completo no ingresso."
      applyLabel="Usar esta imagem"
      applyingLabel="Preparando imagem…"
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        if (skipNextCloseRef.current) {
          skipNextCloseRef.current = false;
          return;
        }
        onCancel();
      }}
      onApply={({ blob }) => {
        skipNextCloseRef.current = true;
        onConfirm(new File([blob], 'ticket-artwork.jpg', { type: 'image/jpeg' }));
      }}
    />
  );
}
