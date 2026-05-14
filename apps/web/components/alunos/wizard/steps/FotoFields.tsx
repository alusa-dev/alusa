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
        <div className="relative h-40 w-40 overflow-hidden rounded-full border border-slate-200 bg-white ring-1 ring-slate-200/60 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:ring-[color:var(--color-border-default)]">
          {hasFoto ? (
            <img
              src={fotoPreview ?? ''}
              alt="Foto do aluno"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full select-none items-center justify-center text-sm font-medium text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">
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
              className="h-7 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)]"
              onClick={onEdit}
            >
              Ajustar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-slate-300 bg-white text-red-600 hover:bg-red-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:hover:bg-red-950/30"
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
            'flex h-40 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center shadow-sm transition ' +
            (dragActive
              ? 'border-brand-accent bg-brand-accent/10'
              : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:hover:border-[color:var(--color-border-strong)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.04)]')
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
            className="flex items-center gap-1 border-slate-300 bg-white text-slate-700 shadow-none hover:bg-slate-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)]"
          >
            <Upload className="h-4 w-4" />
            <span>{hasFoto ? 'Substituir' : 'Upload'}</span>
          </Button>
          <p className="mt-3 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            {hasFoto
              ? 'Arraste uma nova imagem ou clique para substituir.'
              : 'Escolha uma imagem ou arraste e solte aqui.'}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]">
            JPG ou PNG até 5MB.
          </p>
        </div>
      </div>
    </div>
  );
}
