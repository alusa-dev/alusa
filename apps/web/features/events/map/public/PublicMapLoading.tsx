'use client';

import { Button } from '@/components/ui/button';

export function PublicMapLoading({
  onBack,
  variant = 'full',
  className,
}: {
  onBack?: () => void;
  variant?: 'full' | 'preview';
  className?: string;
}) {
  return (
    <div
      className={`relative flex items-center justify-center bg-white px-6 ${
        variant === 'preview' ? 'h-full min-h-0 w-full' : 'min-h-[100svh] w-full'
      } ${className ?? ''}`}
    >
      {onBack ? (
        <Button type="button" variant="outline" className="absolute left-4 top-4" onClick={onBack}>
          Voltar à prévia
        </Button>
      ) : null}
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600"
        />
        <p className="text-sm font-medium text-slate-700">Carregando o mapa…</p>
      </div>
    </div>
  );
}
