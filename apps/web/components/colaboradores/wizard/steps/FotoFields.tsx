'use client';
import { Button } from '@/components/ui/button';
import * as React from 'react';

type DropzoneGetRootProps = () => React.HTMLAttributes<HTMLElement>;
type DropzoneGetInputProps = () => React.InputHTMLAttributes<HTMLInputElement>;

export default function FotoFields({
  getRootProps,
  getInputProps,
  isDragActive,
  fotoPreview,
  onRemove,
  onOpenCrop,
}: {
  getRootProps: DropzoneGetRootProps;
  getInputProps: DropzoneGetInputProps;
  isDragActive: boolean;
  fotoPreview: string | null;
  onRemove: () => void;
  onOpenCrop: () => void;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
      <div className="md:col-span-2 space-y-4">
        <div
          {...getRootProps()}
          className={`flex h-44 cursor-pointer items-center justify-center rounded-lg border border-dashed ${
            isDragActive ? 'border-violet-300 bg-violet-50' : 'border-slate-300 bg-slate-50'
          } p-4 text-center`}
          aria-label="Área para enviar foto"
        >
          <input {...getInputProps()} />
          <div>
            <p className="text-sm text-slate-700">
              Arraste e solte uma foto aqui
              <span className="mx-1 text-slate-400">ou</span>
            </p>
            <div className="mt-2">
              <Button type="button" className="bg-violet-600 text-white hover:bg-violet-700">
                Escolher foto
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              Formatos aceitos: JPG ou PNG. Para melhor qualidade, use imagens quadradas (ex.:
              400×400px). Tamanho máximo: 5MB.
            </p>
          </div>
        </div>
        {fotoPreview && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={onOpenCrop}
            >
              Ajustar corte
            </Button>
            <Button
              type="button"
              onClick={onRemove}
              variant="outline"
              className="border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Remover foto
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center">
        <div className="h-44 w-44 overflow-hidden rounded-full border bg-slate-100">
          {fotoPreview ? (
            <img
              src={fotoPreview}
              alt="Pré-visualização da foto"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
              Sem foto
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
