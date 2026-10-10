'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CreatorIcon } from '@/components/icons/hugeicons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { createEventMap, deleteEventMap, duplicateEventMap, listEventMaps, uploadEventMapReferenceChart } from '../api/event-map-service';
import { getEvent } from '../../events-service';

type CreationIntent = 'blank' | 'reference-plan';

function toLocalDateTimeInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function CreateEventMapRoute({ eventId }: { eventId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateMapId = searchParams.get('templateMapId');
  const queryClient = useQueryClient();
  const eventQuery = useQuery({ queryKey: ['events', 'detail', eventId], queryFn: () => getEvent(eventId) });
  const mapsQuery = useQuery({ queryKey: ['events', 'maps', eventId], queryFn: () => listEventMaps(eventId) });
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<CreationIntent | null>(null);
  const [selectedMode, setSelectedMode] = useState<CreationIntent | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [sessionFieldsReady, setSessionFieldsReady] = useState(false);

  useEffect(() => {
    if (!eventQuery.isFetched || mapsQuery.isLoading || sessionFieldsReady) return;
    const template = mapsQuery.data?.find((map) => map.id === templateMapId);
    const mapsCount = mapsQuery.data?.length ?? 0;
    setSessionName(template ? `${template.name} (cópia)` : `Sessão ${String(mapsCount + 1).padStart(2, '0')}`);
    setStartsAt(toLocalDateTimeInput(template?.startsAt ?? eventQuery.data?.startsAt));
    setEndsAt(toLocalDateTimeInput(template ? template.endsAt : eventQuery.data?.endsAt));
    setLocationName(template ? template.locationName ?? '' : eventQuery.data?.locationName ?? '');
    setLocationAddress(template ? template.locationAddress ?? '' : eventQuery.data?.locationAddress ?? '');
    setSessionFieldsReady(true);
  }, [eventQuery.data, eventQuery.isFetched, mapsQuery.data, mapsQuery.isLoading, sessionFieldsReady, templateMapId]);

  async function createAndOpen(creationMode: CreationIntent, referenceFile?: File) {
    const trimmedSessionName = sessionName.trim();
    const sessionStartsAt = fromLocalDateTimeInput(startsAt);
    const sessionEndsAt = fromLocalDateTimeInput(endsAt);
    if (!trimmedSessionName || !sessionStartsAt) {
      toast.error({ title: 'Informe o nome e o horário da sessão' });
      return;
    }
    if (sessionEndsAt && new Date(sessionEndsAt) <= new Date(sessionStartsAt)) {
      toast.error({ title: 'Horário inválido', description: 'O término deve ser posterior ao início da sessão.' });
      return;
    }

    setBusy(creationMode);
    let createdMap: Awaited<ReturnType<typeof createEventMap>> | null = null;

    try {
      const session = {
        name: trimmedSessionName,
        startsAt: sessionStartsAt,
        endsAt: sessionEndsAt,
        locationName: locationName.trim() || null,
        locationAddress: locationAddress.trim() || null,
      };
      createdMap = templateMapId
        ? await duplicateEventMap(eventId, templateMapId, session)
        : await createEventMap(eventId, { ...session, creationMode });
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

      if (createdMap && creationMode === 'reference-plan') {
        try {
          const cleanup = await deleteEventMap(eventId, createdMap.id);
          if (cleanup.action !== 'DELETE') throw new Error('O mapa não pôde ser removido com segurança.');
          await queryClient.invalidateQueries({ queryKey: ['events', 'maps', eventId] });
        } catch {
          toast.error({ title: 'O mapa foi criado, mas não pôde ser removido', description: 'Abra o editor para concluir a configuração ou exclua o rascunho manualmente.' });
          router.replace(`/events/${eventId}/maps/${createdMap.id}/editor`);
        }
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
    if (busy || (!selectedMode && !templateMapId)) return;
    if (templateMapId) {
      void createAndOpen('blank');
      return;
    }
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
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight sm:text-2xl">
              {templateMapId ? 'Duplicar mapa para outra sessão' : 'Criar sessão e mapa'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Cada sessão tem horário, link e disponibilidade de assentos próprios.
            </p>
          </div>
        </header>

        {!templateMapId ? (
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
        ) : null}

        <section aria-labelledby="session-details-title" className="mt-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 id="session-details-title" className="text-sm font-semibold text-slate-950">Dados da sessão</h2>
          <p className="mt-1 text-xs text-slate-500">Essas informações serão exibidas na página pública e nos ingressos.</p>
          {templateMapId ? (
            <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
              O desenho e os assentos serão copiados. As reservas, vendas e disponibilidade desta sessão começarão independentes.
            </p>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700 sm:col-span-2">
              Nome da sessão
              <Input value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={120} required disabled={busy !== null || !sessionFieldsReady} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Início
              <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required disabled={busy !== null || !sessionFieldsReady} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Término
              <Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={busy !== null || !sessionFieldsReady} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Local
              <Input value={locationName} onChange={(event) => setLocationName(event.target.value)} maxLength={255} disabled={busy !== null || !sessionFieldsReady} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Endereço
              <Input value={locationAddress} onChange={(event) => setLocationAddress(event.target.value)} maxLength={500} disabled={busy !== null || !sessionFieldsReady} />
            </label>
          </div>
          {!sessionFieldsReady ? (
            <p className="mt-3 text-xs text-slate-500">Carregando os dados do evento para sugerir a sessão…</p>
          ) : eventQuery.isError ? (
            <p className="mt-3 text-xs text-amber-700">Não foi possível sugerir os dados do evento. Preencha as informações da sessão manualmente.</p>
          ) : null}
        </section>

        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            disabled={(!selectedMode && !templateMapId) || busy !== null || !sessionFieldsReady || !sessionName.trim() || !startsAt}
            aria-busy={busy !== null}
            onClick={continueWithSelectedMode}
            className="h-10 w-full rounded-lg bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 sm:w-auto"
          >
            {templateMapId && busy !== null
              ? 'Criando sessão…'
              : templateMapId
                ? 'Criar sessão duplicada'
                : busy === 'blank'
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
