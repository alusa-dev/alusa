'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_TICKET_MODE_LABELS,
  EVENT_TICKET_MODES,
  EVENT_TYPE_LABELS,
  SCHOOL_EVENT_TYPES,
} from '@alusa/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { saveEvent, type SchoolEventDTO } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { booleanValue, datetimeValue, FILTER_INPUT_CLASS, nullableString, numberValue, OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { useEventResources } from '../shared/useEventResources';

export function EventFormDialog({
  event,
  trigger,
  onSaved,
}: {
  event?: SchoolEventDTO | null;
  trigger: React.ReactNode;
  onSaved?: (event: SchoolEventDTO) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [regFeeText, setRegFeeText] = useState("");
  const resources = useEventResources();

  useEffect(() => {
    if (open) {
      const fee = event?.registrationFee ?? 0;
      setRegFeeText(fee > 0 ? fee.toFixed(2).replace('.', ',') : "");
    }
  }, [open, event]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => saveEvent(payload, event?.id),
    onSuccess: async (saved) => {
      toast.success({
        title: event ? 'Evento atualizado' : 'Evento criado',
        description: event ? 'As alterações do evento foram salvas com sucesso.' : 'O novo evento foi cadastrado com sucesso.'
      });
      await queryClient.invalidateQueries({ queryKey: eventQueryKeys.events });
      if (event?.id) await queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(event.id) });
      setOpen(false);
      onSaved?.(saved);
    },
    onError: (error) => toast.error({ title: 'Erro ao salvar evento', description: (error as Error).message }),
  });

  function handleSubmit(formData: FormData) {
    const regFeeRaw = nullableString(formData, 'registrationFee') ?? '';
    const registrationFee = regFeeRaw ? parseCurrencyInput(regFeeRaw) : undefined;

    mutation.mutate({
      name: nullableString(formData, 'name'),
      type: nullableString(formData, 'type'),
      description: nullableString(formData, 'description'),
      startsAt: datetimeValue(formData, 'startsAt'),
      endsAt: datetimeValue(formData, 'endsAt'),
      locationName: nullableString(formData, 'locationName'),
      locationAddress: nullableString(formData, 'locationAddress'),
      estimatedCapacity: numberValue(formData, 'estimatedCapacity'),
      responsibleUserId: nullableString(formData, 'responsibleUserId'),
      hasTickets: booleanValue(formData, 'hasTickets'),
      ticketMode: nullableString(formData, 'ticketMode'),
      hasCostumes: booleanValue(formData, 'hasCostumes'),
      hasFinancialControl: booleanValue(formData, 'hasFinancialControl'),
      registrationFee,
      notes: nullableString(formData, 'notes'),
    });
  }

  const userOptions = (resources.data?.users ?? []).map((user) => ({ value: user.id, label: user.nome }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        fullScreenMobile
        className="max-w-4xl w-full gap-0 overflow-hidden bg-slate-50 p-0 alusa-dark:bg-[color:var(--color-bg-card)] max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
      >
        <form action={handleSubmit} className="flex max-h-[88vh] min-h-0 flex-col max-md:max-h-none max-md:flex-1">
          <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] md:px-8 md:py-6">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
              {event ? 'Editar evento' : 'Novo evento'}
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-2xl text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
              Organize os dados básicos e as configurações operacionais do evento.
            </DialogDescription>
          </div>
          <div className="flex-1 space-y-6 overflow-y-auto scroll-smooth bg-slate-50 px-4 py-6 max-md:min-h-0 alusa-dark:bg-transparent md:px-8">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Dados básicos</span>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <Field label="Nome do evento">
                    <Input name="name" defaultValue={event?.name ?? ''} required className={FILTER_INPUT_CLASS} />
                  </Field>
                </div>
                <Field label="Tipo">
                  <NativeSelect
                    name="type"
                    required
                    defaultValue={event?.type ?? 'PRESENTATION'}
                    options={SCHOOL_EVENT_TYPES.map((type) => ({ value: type, label: EVENT_TYPE_LABELS[type] }))}
                  />
                </Field>
                <Field label="Início">
                  <DateTimeField name="startsAt" defaultValue={event?.startsAt} required />
                </Field>
                <Field label="Fim">
                  <DateTimeField name="endsAt" defaultValue={event?.endsAt} />
                </Field>
                <Field label="Capacidade estimada">
                  <Input type="number" min={1} name="estimatedCapacity" defaultValue={event?.estimatedCapacity ?? ''} className={FILTER_INPUT_CLASS} />
                </Field>
                <Field label="Local">
                  <Input name="locationName" defaultValue={event?.locationName ?? ''} className={FILTER_INPUT_CLASS} />
                </Field>
                <Field label="Endereço">
                  <Input name="locationAddress" defaultValue={event?.locationAddress ?? ''} className={FILTER_INPUT_CLASS} />
                </Field>
                <Field label="Responsável interno">
                  <NativeSelect
                    name="responsibleUserId"
                    defaultValue={event?.responsibleUserId}
                    placeholder="Sem responsável"
                    options={userOptions}
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Descrição">
                  <Textarea name="description" defaultValue={event?.description ?? ''} className="min-h-20 rounded-lg border-slate-200 shadow-none" />
                </Field>
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Configurações</span>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {[
                  ['hasTickets', 'Terá ingressos?', event?.hasTickets ?? false],
                  ['hasCostumes', 'Terá figurinos?', event?.hasCostumes ?? false],
                  ['hasFinancialControl', 'Controle financeiro?', event?.hasFinancialControl ?? true],
                ].map(([name, label, checked]) => (
                  <label key={String(name)} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                    <input name={String(name)} type="checkbox" defaultChecked={Boolean(checked)} className="h-4 w-4 rounded border-slate-300 accent-violet-700" />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-4">
                <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo de ingresso">
                  <NativeSelect
                    name="ticketMode"
                    defaultValue={event?.ticketMode ?? (event?.hasTickets ? 'SIMPLE' : 'NONE')}
                    options={EVENT_TICKET_MODES.map((mode) => ({ value: mode, label: EVENT_TICKET_MODE_LABELS[mode] }))}
                  />
                </Field>
                <Field label="Taxa de inscrição sugerida">
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                      R$
                    </span>
                    <Input
                      name="registrationFee"
                      type="text"
                      value={regFeeText}
                      onChange={(e) => setRegFeeText(formatCurrencyInput(e.target.value))}
                      className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                    />
                  </div>
                </Field>
              </div>
              </div>
              <div className="mt-4">
                <Field label="Observações">
                  <Textarea name="notes" defaultValue={event?.notes ?? ''} className="min-h-20 rounded-lg border-slate-200 shadow-none" />
                </Field>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] md:px-8">
            <Button type="button" variant="outline" className={cn(OUTLINE_BUTTON_CLASS, 'min-w-32')} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending} className={cn(PRIMARY_BUTTON_CLASS, 'min-w-40')}>
              {mutation.isPending ? 'Salvando...' : 'Salvar evento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
