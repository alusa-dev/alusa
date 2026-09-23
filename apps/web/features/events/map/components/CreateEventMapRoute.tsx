'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { CreatorIcon } from '@/components/icons/hugeicons';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { createEventMap, uploadEventMapReferenceChart } from '../api/event-map-service';

type CreationIntent = 'blank' | 'reference-plan';

export function CreateEventMapRoute({ eventId }: { eventId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<CreationIntent | null>(null);
  const [selectedMode, setSelectedMode] = useState<CreationIntent | null>(null);

  async function createAndOpen(creationMode: CreationIntent, referenceFile?: File) {
    setBusy(creationMode);
    let createdMap: Awaited<ReturnType<typeof createEventMap>> | null = null;

    try {
      createdMap = await createEventMap(eventId, {
        name: 'Mapa sem título',
        creationMode,
      });
      await queryClient.invalidateQueries({ queryKey: ['events', 'maps', eventId] });

      if (creationMode === 'reference-plan' && referenceFile) {
        await uploadEventMapReferenceChart(eventId, createdMap.id, referenceFile);
      }

      router.replace(`/events/${eventId}/maps/${createdMap.id}/editor`);
    } catch (error) {
      toast.error({
        title: creationMode === 'reference-plan' ? 'Não foi possível preparar a planta' : 'Não foi possível criar o mapa',
        description: error instanceof Error ? error.message : 'Tente novamente.',
      });

      if (createdMap) {
        router.replace(`/events/${eventId}/maps/${createdMap.id}/editor`);
      }
    } finally {
      setBusy(null);
      if (referenceInputRef.current) referenceInputRef.current.value = '';
    }
  }

  function handleReferenceSelection(file: File | undefined) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error({ title: 'Formato não suportado', description: 'Use uma imagem JPG, PNG ou WebP.' });
      if (referenceInputRef.current) referenceInputRef.current.value = '';
      return;
    }
    void createAndOpen('reference-plan', file);
  }

  function continueWithSelectedMode() {
    if (busy || !selectedMode) return;
    if (selectedMode === 'reference-plan') {
      referenceInputRef.current?.click();
      return;
    }
    void createAndOpen('blank');
  }

  return (
    <main className="min-h-[100svh] bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <section className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-4xl flex-col justify-center sm:min-h-[calc(100svh-6rem)]">
        <header className="mb-8 flex items-start gap-3 sm:mb-10">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-0.5 h-9 w-9 shrink-0 rounded-lg text-slate-500 hover:bg-white hover:text-slate-950"
            onClick={() => router.replace(`/events/${eventId}`)}
            aria-label="Voltar para o evento"
          >
            <CreatorIcon name="back" size={18} />
          </Button>
          <div>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight sm:text-2xl">Criar mapa de assentos</h1>
            <p className="mt-1 text-sm text-slate-500">Escolha como deseja preparar o espaço.</p>
          </div>
        </header>

        <fieldset disabled={busy !== null} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Como deseja começar?</legend>
          {([
            {
              mode: 'blank' as const,
              title: 'Em branco',
              description: 'Monte o espaço do zero com setores, fileiras, assentos e outros elementos.',
              icon: 'map' as const,
            },
            {
              mode: 'reference-plan' as const,
              title: 'Importar planta',
              description: 'Envie a imagem do local e desenhe os assentos por cima dela no editor.',
              icon: 'reference' as const,
            },
          ]).map((option) => {
            const selected = selectedMode === option.mode;
            return (
              <label
                key={option.mode}
                className={cn(
                  'group relative flex min-h-[9rem] cursor-pointer flex-col gap-3 rounded-xl border-2 p-4 text-left transition-colors sm:min-h-[8.75rem] sm:p-5',
                  'active:scale-[0.99] focus-within:outline-none focus-within:ring-0 focus-within:bg-[#e6d6fb] focus-within:text-[#2b2634]',
                  selected
                    ? 'border-transparent bg-[#e6d6fb] text-[#2b2634]'
                    : 'border-transparent bg-white hover:bg-[#e6d6fb] hover:text-[#2b2634]',
                  busy !== null && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="map-creation-mode"
                  value={option.mode}
                  checked={selected}
                  onChange={() => setSelectedMode(option.mode)}
                  className="peer sr-only focus:outline-none focus-visible:outline-none"
                />
                {selected && (
                  <span className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-brand-accent text-white" aria-hidden="true">
                    <CreatorIcon name="success" size={13} />
                  </span>
                )}
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg',
                    selected
                      ? 'bg-white/60 text-brand-accent'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-white/60 group-hover:text-brand-accent group-focus-within:bg-white/60 group-focus-within:text-brand-accent',
                  )}
                  aria-hidden="true"
                >
                  <CreatorIcon name={option.icon} size={20} />
                </span>
                <span className="pr-8">
                  <span className="block font-medium">{option.title}</span>
                  <span className={cn('mt-0.5 block text-sm', selected ? 'text-[#2b2634]/70' : 'text-slate-500 group-hover:text-[#2b2634]/70 group-focus-within:text-[#2b2634]/70')}>
                    {option.description}
                  </span>
                  {option.mode === 'reference-plan' && (
                    <span className={cn('mt-1 block text-xs', selected ? 'text-[#2b2634]/70' : 'text-slate-500 group-hover:text-[#2b2634]/70 group-focus-within:text-[#2b2634]/70')}>
                      JPG, PNG ou WebP
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            disabled={!selectedMode || busy !== null}
            aria-busy={busy !== null}
            onClick={continueWithSelectedMode}
            className="h-10 w-full rounded-lg bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 sm:w-auto"
          >
            {busy === 'blank'
              ? 'Criando mapa…'
              : busy === 'reference-plan'
                ? 'Preparando planta…'
                : selectedMode === 'reference-plan'
                  ? 'Escolher imagem'
                  : 'Continuar'}
            {busy === null && <CreatorIcon name="continue" size={16} />}
          </Button>
        </div>

        <input
          ref={referenceInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => handleReferenceSelection(event.target.files?.[0])}
        />
      </section>
    </main>
  );
}
