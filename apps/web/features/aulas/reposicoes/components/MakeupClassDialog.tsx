'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AulasLookupItemDTO, CalendarEventListItemDTO } from '@/features/aulas/dtos';
import { listAgendaEvents } from '@/features/aulas/agenda/services/agenda-service';
import { createMakeupClass } from '@/features/aulas/reposicoes/services/makeup-service';
import { MAKEUP_SCOPE_OPTIONS } from '@/features/aulas/types';
import { TZDateMini } from '@date-fns/tz';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatInstantInAccountZone,
  normalizeAccountTimeZoneClient,
} from '@/lib/agenda-timezone';

type MakeupClassDialogProps = {
  open: boolean;
  resources: {
    turmas: AulasLookupItemDTO[];
    alunos: AulasLookupItemDTO[];
  };
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  accountTimeZone?: string;
};

const EMPTY_VALUE = '__NONE__';
const CONTROL_CLASS = 'h-10 rounded-xl border-slate-200 bg-white text-[13px]';

type MakeupFormValues = {
  scope: 'INDIVIDUAL' | 'COLETIVA';
  destinationMode: 'create' | 'existing';
  alunoId: string;
  turmaOrigemId: string;
  turmaDestinoId: string;
  eventoOrigemId: string;
  eventoDestinoId: string;
  title: string;
  startDate?: Date;
  startTime: string;
  endDate?: Date;
  endTime: string;
  observacao: string;
};

function getInitialValues(): MakeupFormValues {
  return {
    scope: 'INDIVIDUAL',
    destinationMode: 'create',
    alunoId: '',
    turmaOrigemId: '',
    turmaDestinoId: '',
    eventoOrigemId: '',
    eventoDestinoId: '',
    title: '',
    startDate: undefined,
    startTime: '',
    endDate: undefined,
    endTime: '',
    observacao: '',
  };
}

function combineDateAndTimeZoned(date: Date | undefined, time: string, accountTz: string): string | null {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;

  const zCal = new TZDateMini(date.getTime(), normalizeAccountTimeZoneClient(accountTz));
  const [hours, minutes] = time.split(':').map(Number);
  const z = new TZDateMini(
    zCal.getFullYear(),
    zCal.getMonth(),
    zCal.getDate(),
    hours,
    minutes,
    0,
    0,
    normalizeAccountTimeZoneClient(accountTz),
  );
  const iso = new Date(z.getTime()).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function FieldLabel({ children }: { children: string }) {
  return <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{children}</label>;
}

function SectionBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function MakeupClassDialog({
  open,
  resources,
  onOpenChange,
  onSaved,
  accountTimeZone = DEFAULT_ACCOUNT_TIMEZONE,
}: MakeupClassDialogProps) {
  const tz = accountTimeZone;
  const [sourceEvents, setSourceEvents] = useState<CalendarEventListItemDTO[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<MakeupFormValues>(getInitialValues);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const run = async () => {
      try {
        setLoadingEvents(true);
        const start = new Date();
        start.setDate(start.getDate() - 30);
        const end = new Date();
        end.setDate(end.getDate() + 60);

        const result = await listAgendaEvents({
          start: start.toISOString(),
          end: end.toISOString(),
          type: ['AULA', 'REPOSICAO'],
          includeResources: false,
        });

        if (!cancelled) {
          setSourceEvents(result.data.events);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setValues(getInitialValues());
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    const startAt = combineDateAndTimeZoned(values.startDate, values.startTime, tz);
    const endAt = combineDateAndTimeZoned(values.endDate, values.endTime, tz);

    try {
      setSubmitting(true);
      setError(null);

      if (values.scope === 'INDIVIDUAL' && !values.alunoId) {
        throw new Error('Selecione o aluno para reposição individual.');
      }

      if (values.destinationMode === 'create' && (!startAt || !endAt)) {
        throw new Error('Informe data e hora de início e fim do evento de destino.');
      }

      await createMakeupClass({
        scope: values.scope,
        alunoId: values.scope === 'INDIVIDUAL' ? values.alunoId || null : null,
        eventoOrigemId: values.eventoOrigemId,
        eventoDestinoId:
          values.destinationMode === 'existing' ? values.eventoDestinoId || null : null,
        turmaOrigemId: values.turmaOrigemId,
        turmaDestinoId: values.turmaDestinoId,
        observacao: values.observacao.trim() || null,
        destinationEvent:
          values.destinationMode === 'create'
            ? {
                title: values.title.trim() || undefined,
                startAt: startAt!,
                endAt: endAt!,
                professorIds: [],
              }
            : undefined,
      });

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const sourceEvent = sourceEvents.find((event) => event.id === values.eventoOrigemId);
  const destinationEvent = sourceEvents.find((event) => event.id === values.eventoDestinoId);
  const canSubmit =
    !submitting &&
    Boolean(values.eventoOrigemId && values.turmaOrigemId && values.turmaDestinoId) &&
    (values.scope === 'COLETIVA' || Boolean(values.alunoId)) &&
    (values.destinationMode === 'existing'
      ? Boolean(values.eventoDestinoId)
      : Boolean(values.startDate && values.startTime && values.endDate && values.endTime));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-3xl gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="border-b border-slate-100 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-slate-900">Nova reposição</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Associe origem e destino da reposição para manter a trilha operacional completa.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[76vh] overflow-y-auto px-6 py-6">
          <div className="space-y-5">
            <SectionBlock
              title="Vínculo da reposição"
              description="Defina escopo, origem acadêmica e quem participa da compensação."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabel>Escopo</FieldLabel>
                  <Select
                    value={values.scope}
                    onValueChange={(value: 'INDIVIDUAL' | 'COLETIVA') =>
                      setValues((current) => ({
                        ...current,
                        scope: value,
                        alunoId: value === 'COLETIVA' ? '' : current.alunoId,
                      }))
                    }
                  >
                    <SelectTrigger className={CONTROL_CLASS} data-testid="makeup-scope">
                      <SelectValue placeholder="Escopo" />
                    </SelectTrigger>
                    <SelectContent>
                      {MAKEUP_SCOPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <FieldLabel>Aluno</FieldLabel>
                  <Select
                    value={values.alunoId || EMPTY_VALUE}
                    onValueChange={(value) =>
                      setValues((current) => ({ ...current, alunoId: value === EMPTY_VALUE ? '' : value }))
                    }
                    disabled={values.scope !== 'INDIVIDUAL'}
                  >
                    <SelectTrigger className={CONTROL_CLASS} data-testid="makeup-aluno">
                      <SelectValue placeholder="Aluno" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_VALUE}>Sem aluno específico</SelectItem>
                      {resources.alunos.map((aluno) => (
                        <SelectItem key={aluno.id} value={aluno.id}>
                          {aluno.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {values.scope === 'INDIVIDUAL'
                      ? 'Selecione o aluno que receberá a reposição.'
                      : 'Reposição coletiva não exige aluno específico.'}
                  </p>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <FieldLabel>Evento de origem</FieldLabel>
                  <Select
                    value={values.eventoOrigemId || EMPTY_VALUE}
                    onValueChange={(value) => {
                      if (value === EMPTY_VALUE) {
                        setValues((current) => ({ ...current, eventoOrigemId: '', turmaOrigemId: '' }));
                        return;
                      }
                      const nextSourceEvent = sourceEvents.find((event) => event.id === value);
                      setValues((current) => ({
                        ...current,
                        eventoOrigemId: value,
                        turmaOrigemId: nextSourceEvent?.turma?.id ?? '',
                      }));
                    }}
                  >
                    <SelectTrigger className={CONTROL_CLASS} data-testid="makeup-evento-origem">
                      <SelectValue placeholder={loadingEvents ? 'Carregando eventos...' : 'Selecione o evento'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_VALUE}>Selecione</SelectItem>
                      {sourceEvents.map((event) => (
                        <SelectItem key={event.id} value={event.id}>
                          {event.title} • {new Date(event.startAt).toLocaleDateString('pt-BR')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sourceEvent ? (
                    <p className="text-xs text-slate-500">
                      Origem selecionada: {sourceEvent.title} em{' '}
                      {formatInstantInAccountZone(sourceEvent.startAt, "dd/MM/yyyy 'às' HH:mm", tz)}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <FieldLabel>Turma origem</FieldLabel>
                  <Select
                    value={values.turmaOrigemId || EMPTY_VALUE}
                    onValueChange={(value) =>
                      setValues((current) => ({ ...current, turmaOrigemId: value === EMPTY_VALUE ? '' : value }))
                    }
                  >
                    <SelectTrigger className={CONTROL_CLASS} data-testid="makeup-turma-origem">
                      <SelectValue placeholder="Turma origem" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_VALUE}>Selecione</SelectItem>
                      {resources.turmas.map((turma) => (
                        <SelectItem key={turma.id} value={turma.id}>
                          {turma.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <FieldLabel>Turma destino</FieldLabel>
                  <Select
                    value={values.turmaDestinoId || EMPTY_VALUE}
                    onValueChange={(value) =>
                      setValues((current) => ({ ...current, turmaDestinoId: value === EMPTY_VALUE ? '' : value }))
                    }
                  >
                    <SelectTrigger className={CONTROL_CLASS} data-testid="makeup-turma-destino">
                      <SelectValue placeholder="Turma destino" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_VALUE}>Selecione</SelectItem>
                      {resources.turmas.map((turma) => (
                        <SelectItem key={turma.id} value={turma.id}>
                          {turma.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SectionBlock>

            <SectionBlock
              title="Destino operacional"
              description="Escolha entre vincular um evento existente ou criar um novo evento de reposição."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <FieldLabel>Destino da reposição</FieldLabel>
                  <Select
                    value={values.destinationMode}
                    onValueChange={(value: 'create' | 'existing') =>
                      setValues((current) => ({
                        ...current,
                        destinationMode: value,
                        eventoDestinoId: value === 'existing' ? current.eventoDestinoId : '',
                        startDate: value === 'create' ? current.startDate : undefined,
                        startTime: value === 'create' ? current.startTime : '',
                        endDate: value === 'create' ? current.endDate : undefined,
                        endTime: value === 'create' ? current.endTime : '',
                      }))
                    }
                  >
                    <SelectTrigger className={CONTROL_CLASS} data-testid="makeup-destination-mode">
                      <SelectValue placeholder="Como definir o destino" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="create">Criar novo evento destino</SelectItem>
                      <SelectItem value="existing">Usar evento já existente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {values.destinationMode === 'existing' ? (
                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel>Evento destino</FieldLabel>
                    <Select
                      value={values.eventoDestinoId || EMPTY_VALUE}
                      onValueChange={(value) => {
                        if (value === EMPTY_VALUE) {
                          setValues((current) => ({ ...current, eventoDestinoId: '' }));
                          return;
                        }
                        const nextDestinationEvent = sourceEvents.find((event) => event.id === value);
                        setValues((current) => ({
                          ...current,
                          eventoDestinoId: value,
                          turmaDestinoId: nextDestinationEvent?.turma?.id ?? current.turmaDestinoId,
                        }));
                      }}
                    >
                      <SelectTrigger className={CONTROL_CLASS} data-testid="makeup-evento-destino">
                        <SelectValue placeholder={loadingEvents ? 'Carregando eventos...' : 'Selecione o evento destino'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={EMPTY_VALUE}>Selecione</SelectItem>
                        {sourceEvents.map((event) => (
                          <SelectItem key={event.id} value={event.id}>
                            {event.title} • {new Date(event.startAt).toLocaleDateString('pt-BR')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {destinationEvent ? (
                      <p className="text-xs text-slate-500">
                        Destino selecionado: {destinationEvent.title} em{' '}
                        {formatInstantInAccountZone(destinationEvent.startAt, "dd/MM/yyyy 'às' HH:mm", tz)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <FieldLabel>Título do evento destino</FieldLabel>
                      <Input
                        value={values.title}
                        onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
                        className={CONTROL_CLASS}
                        placeholder="Ex.: Reposição • Ballet Intermediário"
                        data-testid="makeup-destination-title"
                      />
                    </div>

                    <div className="space-y-2">
                      <FieldLabel>Início</FieldLabel>
                      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2" data-testid="makeup-destination-start">
                        <DatePicker
                          variant="input"
                          value={values.startDate}
                          onChange={(date) => setValues((current) => ({ ...current, startDate: date }))}
                          placeholder="dd/mm/aaaa"
                          className={CONTROL_CLASS}
                        />
                        <Input
                          type="time"
                          value={values.startTime}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, startTime: event.target.value }))
                          }
                          className={CONTROL_CLASS}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <FieldLabel>Fim</FieldLabel>
                      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2" data-testid="makeup-destination-end">
                        <DatePicker
                          variant="input"
                          value={values.endDate}
                          onChange={(date) => setValues((current) => ({ ...current, endDate: date }))}
                          placeholder="dd/mm/aaaa"
                          className={CONTROL_CLASS}
                        />
                        <Input
                          type="time"
                          value={values.endTime}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, endTime: event.target.value }))
                          }
                          className={CONTROL_CLASS}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </SectionBlock>

            <SectionBlock
              title="Observação"
              description="Registre contexto, combinação com responsável acadêmico ou detalhes úteis para auditoria."
            >
              <div className="space-y-2">
                <FieldLabel>Observação</FieldLabel>
                <Textarea
                  value={values.observacao}
                  onChange={(event) => setValues((current) => ({ ...current, observacao: event.target.value }))}
                  className="min-h-[120px] rounded-2xl border-slate-200 bg-white"
                  placeholder="Contexto da reposição, justificativa ou combinação com professor/aluno."
                />
              </div>
            </SectionBlock>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-slate-100 px-6 py-4 sm:justify-between">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="makeup-submit"
          >
            {submitting ? 'Salvando...' : 'Criar reposição'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
