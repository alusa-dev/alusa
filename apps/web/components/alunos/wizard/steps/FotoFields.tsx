'use client';

import { Button } from '@/components/ui/button';
import { Upload } from '@/components/icons/icons';
import * as React from 'react';

type Props = {
  fotoPreview: string | null;
  avatarFallback: string;
  onEdit: () => void;
  onReplace: () => void; // abre input de arquivo
  onRemove: () => void;
};

export default function FotoFields({
  fotoPreview,
  avatarFallback,
  onEdit,
  onReplace,
  onRemove,
}: Props) {
  const [dragActive, setDragActive] = React.useState(false);
  const hasFoto = !!fotoPreview;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      // delega seleção para o handler externo (abre cropping depois)
      onReplace();
    }
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {/* Preview lateral (quando existir) */}
      <div className="flex items-start gap-4">
        {/* Círculo agora com mesma altura da dropzone (h-40) */}
        <div className="relative h-40 w-40 overflow-hidden rounded-full border border-slate-200 bg-white ring-1 ring-slate-200/60">
          {hasFoto ? (
            <img
              src={fotoPreview ?? ''}
              alt="Foto do aluno"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full select-none items-center justify-center text-sm font-medium text-slate-500">
              {avatarFallback}
            </div>
          )}
        </div>
        {hasFoto && (
          <div className="flex flex-col gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              onClick={onEdit}
            >
              Ajustar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-slate-300 bg-white text-red-600 hover:bg-red-50"
              onClick={onRemove}
            >
              Remover
            </Button>
          </div>
        )}
      </div>

      {/* Área única estilo exemplo */}
      <div className="flex-1">
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onReplace();
            }
          }}
          onClick={onReplace}
          aria-label={hasFoto ? 'Substituir foto do aluno' : 'Adicionar foto do aluno'}
          className={
            'flex h-40 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center transition shadow-sm ' +
            (dragActive
              ? 'border-brand-accent bg-brand-accent/10'
              : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100')
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              onReplace();
            }}
            className="bg-white text-slate-700 hover:bg-slate-50 border-slate-300 shadow-none flex items-center gap-1"
          >
            <Upload className="h-4 w-4" />
            <span>{hasFoto ? 'Substituir' : 'Upload'}</span>
          </Button>
          <p className="mt-3 text-xs text-slate-500">
            {hasFoto
              ? 'Arraste uma nova imagem ou clique para substituir.'
              : 'Escolha uma imagem ou arraste e solte aqui.'}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">JPG ou PNG até 5MB.</p>
        </div>
      </div>
    </div>
  );
}
