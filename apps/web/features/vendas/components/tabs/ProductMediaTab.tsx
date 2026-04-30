'use client';

import { useRef, useState, useCallback } from 'react';
import { ImagePlus, Star, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ProductImageDTO } from '../../services/product-image-service';
import {
  uploadProductImage,
  deleteProductImage,
  setPrimaryProductImage,
} from '../../services/product-image-service';

interface Props {
  productId: string | null; // null quando produto ainda não foi criado
  images: ProductImageDTO[];
  onChange: (images: ProductImageDTO[]) => void;
  pendingFiles: File[];
  onAddPendingFile: (file: File) => void;
  onRemovePendingFile: (index: number) => void;
}

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MB = 5;

export function ProductMediaTab({
  productId,
  images,
  onChange,
  pendingFiles,
  onAddPendingFile,
  onRemovePendingFile,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED.includes(file.type)) return 'Formato não suportado (use JPG, PNG ou WebP)';
    if (file.size > MAX_MB * 1024 * 1024) return `Arquivo muito grande (máx. ${MAX_MB}MB)`;
    return null;
  };

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);

      const file = files[0];
      const err = validateFile(file);
      if (err) { setError(err); return; }

      if (!productId) {
        onAddPendingFile(file);
        return;
      }

      setUploading(file.name);
      try {
        const image = await uploadProductImage(productId, file);
        onChange([...images, image]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading(null);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [productId, images, onChange, onAddPendingFile],
  );

  const handleDelete = async (imageId: string) => {
    if (!productId) return;
    try {
      await deleteProductImage(productId, imageId);
      onChange(images.filter((img) => img.id !== imageId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    if (!productId) return;
    try {
      const updated = await setPrimaryProductImage(productId, imageId);
      onChange(images.map((img) => ({ ...img, isPrimary: img.id === updated.id })));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      void handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect],
  );

  const totalCount = images.length + pendingFiles.length;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Adicionar imagem"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center transition',
          'hover:border-[#A94DFF]/40 hover:bg-[#A94DFF]/5',
          totalCount >= 8 && 'pointer-events-none opacity-50',
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-white shadow-sm">
          {uploading ? (
            <Loader2 className="size-5 animate-spin text-[#A94DFF]" />
          ) : (
            <ImagePlus className="size-5 text-slate-400" />
          )}
        </div>
        <p className="text-sm font-medium text-slate-700">
          {uploading ? 'Enviando...' : 'Arraste ou clique para adicionar'}
        </p>
        <p className="text-xs text-slate-400">JPG, PNG, WebP · máx. {MAX_MB}MB · até 8 imagens</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void handleFileSelect(e.target.files)}
          disabled={totalCount >= 8}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{error}</p>
      )}

      {/* Grid de imagens salvas */}
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {images.map((img) => (
            <div
              key={img.id}
              className={cn(
                'group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 aspect-square',
                img.isPrimary && 'ring-2 ring-[#A94DFF]',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.altText ?? 'Imagem do produto'}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/40 to-transparent px-2 pb-2 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  title={img.isPrimary ? 'Imagem principal' : 'Marcar como principal'}
                  onClick={() => void handleSetPrimary(img.id)}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full transition',
                    img.isPrimary
                      ? 'bg-yellow-400 text-yellow-900'
                      : 'bg-white/80 text-slate-500 hover:bg-yellow-400 hover:text-yellow-900',
                  )}
                >
                  <Star className="size-3" fill={img.isPrimary ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  title="Remover imagem"
                  onClick={() => void handleDelete(img.id)}
                  className="flex size-6 items-center justify-center rounded-full bg-white/80 text-red-500 transition hover:bg-red-500 hover:text-white"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              {img.isPrimary && (
                <span className="absolute left-1 top-1 rounded-full bg-[#A94DFF] px-1.5 py-0.5 text-[9px] font-semibold text-white leading-none">
                  Principal
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pending files (produto novo ainda não salvo) */}
      {pendingFiles.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {pendingFiles.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="group relative overflow-hidden rounded-xl border border-dashed border-[#A94DFF]/40 bg-[#A94DFF]/5 aspect-square"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                className="h-full w-full object-cover opacity-70"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-black/50 px-2 py-0.5 text-[9px] text-white">Pendente</span>
              </div>
              <button
                type="button"
                onClick={() => onRemovePendingFile(i)}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-white/90 text-red-500 opacity-0 transition group-hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {totalCount === 0 && (
        <p className="text-center text-xs text-slate-400">Nenhuma imagem adicionada</p>
      )}
    </div>
  );
}
