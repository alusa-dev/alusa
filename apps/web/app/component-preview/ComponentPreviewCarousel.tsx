'use client';

import { useState } from 'react';

import { ChevronLeft, ChevronRight } from '@/components/icons/icons';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { CheckoutResumePopup } from '@/features/platform-billing/components/CheckoutResumePopup';

const previews = [
  { id: 'loading-dots', label: 'Loading dots' },
  { id: 'checkout-resume', label: 'Popup de retomada da contratação' },
  { id: 'monthly-close-notice', label: 'Aviso de fechamento mensal' },
] as const;

export function ComponentPreviewCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const activePreview = previews[activeIndex];

  function replayPreview() {
    setPreviewGeneration((generation) => generation + 1);
  }

  function showPrevious() {
    setActiveIndex((current) => (current - 1 + previews.length) % previews.length);
  }

  function showNext() {
    setActiveIndex((current) => (current + 1) % previews.length);
  }

  return (
    <main className="relative flex min-h-svh w-full items-center justify-center bg-gray-50 px-16 py-8 sm:px-24">
      <button
        type="button"
        aria-label="Componente anterior"
        onClick={showPrevious}
        className="absolute left-4 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#512a82] sm:left-8"
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>

      <section aria-label="Pré-visualização de componentes" className="w-full max-w-3xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-gray-900">{activePreview.label}</h1>
          <p className="shrink-0 text-sm text-gray-500" aria-live="polite">
            {activeIndex + 1} / {previews.length}
          </p>
        </div>

        <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:min-h-96">
          {activePreview.id === 'loading-dots' ? (
            <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="flex h-48 items-center justify-center rounded-2xl border border-gray-200 bg-white">
                <LoadingDots label="Carregando pré-visualização em fundo branco" />
              </div>
              <div className="flex h-48 items-center justify-center rounded-2xl bg-black">
                <LoadingDots label="Carregando pré-visualização em fundo preto" />
              </div>
            </div>
          ) : activePreview.id === 'checkout-resume' ? (
            <CheckoutResumePopup
              key={previewGeneration}
              placement="inline"
              autoDismissMs={null}
              loading={false}
              onDismiss={replayPreview}
              onResume={replayPreview}
            />
          ) : (
            <div className="relative min-h-72 w-full self-stretch sm:min-h-96">
              <div className="absolute right-0 top-0">
                <CheckoutResumePopup
                  key={previewGeneration}
                  placement="inline"
                  autoDismissMs={null}
                  loading={false}
                  title="Sua mensalidade atual foi mantida"
                  description="O fechamento mensal mais recente não pôde ser confirmado. Mantenha os alunos e as matrículas atualizados para que os próximos fechamentos reflitam a realidade da escola."
                  actionLabel="Ver alunos"
                  onDismiss={replayPreview}
                  onResume={replayPreview}
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-center gap-2" aria-label="Selecionar componente">
          {previews.map((preview, index) => (
            <button
              key={preview.id}
              type="button"
              aria-label={`Mostrar ${preview.label}`}
              aria-current={index === activeIndex ? 'true' : undefined}
              onClick={() => setActiveIndex(index)}
              className={`size-2.5 rounded-full transition-colors ${index === activeIndex ? 'bg-[#512a82]' : 'bg-gray-300 hover:bg-gray-400'}`}
            />
          ))}
        </div>
      </section>

      <button
        type="button"
        aria-label="Próximo componente"
        onClick={showNext}
        className="absolute right-4 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#512a82] sm:right-8"
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
    </main>
  );
}
