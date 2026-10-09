'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

import { EventTicketArtworkCropDialog } from './EventTicketArtworkCropDialog';

type EventTicketArtworkSectionProps = {
  eventArtworkUrl?: string | null;
  pendingFile: File | null;
  onFileChange: (_file: File | null) => void;
  onRemove: () => Promise<void>;
};

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function EventTicketArtworkSection({ eventArtworkUrl, pendingFile, onFileChange, onRemove }: EventTicketArtworkSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(eventArtworkUrl ?? null);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [revokeCropImageOnClose, setRevokeCropImageOnClose] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!pendingFile) setPreviewUrl(eventArtworkUrl ?? null);
  }, [eventArtworkUrl, pendingFile]);

  useEffect(() => () => {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function openCropDialog(imageUrl: string, revokeOnClose: boolean) {
    setCropImageUrl(imageUrl);
    setRevokeCropImageOnClose(revokeOnClose);
    setCropDialogOpen(true);
  }

  function handleFileChange(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      toast.error({ title: 'Formato não suportado', description: 'Escolha uma imagem JPG, PNG ou WebP.' });
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error({ title: 'Imagem muito grande', description: 'O arquivo deve ter até 3 MB.' });
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    openCropDialog(URL.createObjectURL(file), true);
  }

  function handleCropCancel() {
    if (revokeCropImageOnClose && cropImageUrl?.startsWith('blob:')) URL.revokeObjectURL(cropImageUrl);
    setCropImageUrl(null);
    setRevokeCropImageOnClose(false);
    setCropDialogOpen(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleCropConfirm(file: File) {
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    onFileChange(file);
    if (revokeCropImageOnClose && cropImageUrl?.startsWith('blob:')) URL.revokeObjectURL(cropImageUrl);
    setCropImageUrl(null);
    setRevokeCropImageOnClose(false);
    setCropDialogOpen(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove();
      onFileChange(null);
      setPreviewUrl(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      toast.error({ title: 'Erro ao remover imagem', description: (error as Error).message });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Imagem do ingresso</h3>
          <p className="mt-1 text-xs text-slate-500">A imagem será recortada em formato quadrado e otimizada para impressão.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => handleFileChange(event.target.files?.[0])}
            aria-label="Escolher imagem do ingresso"
          />
          <Button type="button" onClick={() => inputRef.current?.click()}>
            {previewUrl ? 'Alterar imagem' : 'Escolher imagem'}
          </Button>
          {previewUrl ? (
            <>
              <Button type="button" variant="destructive" onClick={() => void handleRemove()} disabled={removing}>
                {removing ? 'Removendo…' : 'Remover imagem'}
              </Button>
            </>
          ) : null}
        </div>
      </section>
      <EventTicketArtworkCropDialog
        open={cropDialogOpen}
        imageUrl={cropImageUrl}
        onCancel={handleCropCancel}
        onConfirm={handleCropConfirm}
      />
    </>
  );
}
