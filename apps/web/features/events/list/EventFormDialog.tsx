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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { saveEvent, type SchoolEventDTO } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, FILTER_INPUT_CLASS, getRoundedNowISOString, nullableString, numberValue, OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { useEventResources } from '../shared/useEventResources';
import { FieldHelpTooltip } from '@/components/ui/field-help-tooltip';

type PaymentRuleType = 'FIXED' | 'PERCENTAGE';

function parseOptionalNumber(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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
  const [interestText, setInterestText] = useState('');
  const [fineText, setFineText] = useState('');
  const [discountText, setDiscountText] = useState('');
  const [discountType, setDiscountType] = useState<PaymentRuleType>('PERCENTAGE');
  const [discountDaysText, setDiscountDaysText] = useState('0');
  const resources = useEventResources();

  useEffect(() => {
    if (open) {
      const fee = event?.registrationFee ?? 0;
      setRegFeeText(fee > 0 ? fee.toFixed(2).replace('.', ',') : "");
      setInterestText(event?.paymentRules?.interestPercent?.toString() ?? '');
      setFineText(event?.paymentRules?.fine?.value?.toString() ?? '');
      setDiscountText(event?.paymentRules?.discount?.value?.toString() ?? '');
      setDiscountType(event?.paymentRules?.discount?.type ?? 'PERCENTAGE');
      setDiscountDaysText(event?.paymentRules?.discount?.dueDateLimitDays?.toString() ?? '0');
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

    const ticketMode = nullableString(formData, 'ticketMode') ?? 'NONE';
    const interestPercent = parseOptionalNumber(formData.get('paymentInterestPercent'));
    const fineValue = parseOptionalNumber(formData.get('paymentFineValue'));
    const discountValue = parseOptionalNumber(formData.get('paymentDiscountValue'));
    const discountDays = Number(formData.get('paymentDiscountDueDateLimitDays') ?? 0);
    const paymentRules = interestPercent || fineValue || discountValue
      ? {
          interestPercent,
          fine: fineValue
            ? { value: fineValue, type: 'PERCENTAGE' }
            : null,
          discount: discountValue
            ? {
                value: discountValue,
                type: (formData.get('paymentDiscountType') ?? discountType) as PaymentRuleType,
                dueDateLimitDays: Number.isFinite(discountDays) && discountDays >= 0 ? Math.trunc(discountDays) : 0,
              }
            : null,
        }
      : null;

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
      hasTickets: ticketMode !== 'NONE',
      ticketMode,
      // These modules are available for every event; their visibility is not
      // a creation-time configuration option.
      hasCostumes: event?.hasCostumes ?? true,
      hasFinancialControl: event?.hasFinancialControl ?? true,
      registrationFee,
      paymentRules,
      contratoModeloId: nullableString(formData, 'contratoModeloId'),
      notes: nullableString(formData, 'notes'),
    });
  }

  const userOptions = (resources.data?.users ?? []).map((user) => ({ value: user.id, label: user.nome }));
  const defaultStartsAt = event?.startsAt ?? getRoundedNowISOString();

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
                  <DateTimeField name="startsAt" defaultValue={defaultStartsAt} required />
                </Field>
                <Field label="Fim (opcional)">
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
                <Field label="Responsável interno (opcional)">
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
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Contrato do evento</span>
              <div className="mt-4 max-w-xl">
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-xs font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                    <span>Modelo de contrato (opcional)</span>
                    <FieldHelpTooltip content="Quando selecionado, o contrato será gerado automaticamente para cada aluno inscrito." />
                  </div>
                  <NativeSelect
                    name="contratoModeloId"
                    defaultValue={event?.contratoModeloId ?? ''}
                    placeholder="Sem contrato para este evento"
                    options={(resources.data?.contratoModelos ?? []).map((modelo) => ({
                      value: modelo.id,
                      label: `${modelo.nome} · versão ${modelo.versao}`,
                    }))}
                  />
                </div>
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Configurações</span>
              <div className="mt-4">
                <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo de ingresso">
                  <NativeSelect
                    name="ticketMode"
                    defaultValue={event?.ticketMode ?? (event ? (event.hasTickets ? 'SIMPLE' : 'NONE') : 'SIMPLE')}
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
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
              <div>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Juros e Multa</span>
                <p className="mt-1 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                  Configure multa, juros e desconto por antecipação. Os campos são opcionais.
                </p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Multa por atraso</h3>
                  <p className="mb-3 text-xs text-gray-500">Aplicada no dia seguinte ao vencimento</p>
                  <div className="flex items-center gap-2">
                    <Input
                      name="paymentFineValue"
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      placeholder="Ex: 2.0"
                      value={fineText}
                      onChange={(e) => setFineText(e.target.value)}
                      className="h-9 w-24 rounded-md border-gray-300 text-sm"
                    />
                    <span className="text-sm text-gray-600">%</span>
                    <span className="ml-auto text-xs text-gray-400">máx. 10%</span>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Juros mensais</h3>
                  <p className="mb-3 text-xs text-gray-500">Aplicados proporcionalmente aos dias em atraso</p>
                  <div className="flex items-center gap-2">
                    <Input
                      name="paymentInterestPercent"
                      type="number"
                      min={0}
                      max={5}
                      step={0.1}
                      placeholder="Ex: 1.0"
                      value={interestText}
                      onChange={(e) => setInterestText(e.target.value)}
                      className="h-9 w-24 rounded-md border-gray-300 text-sm"
                    />
                    <span className="text-sm text-gray-600">% a.m.</span>
                    <span className="ml-auto text-xs text-gray-400">máx. 5%</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                <h3 className="mb-1 text-sm font-semibold text-gray-900">Desconto por antecipação</h3>
                <p className="mb-3 text-xs text-gray-500">Incentivo para pagamento antes do vencimento</p>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-600">Tipo</label>
                    <input type="hidden" name="paymentDiscountType" value={discountType} />
                    <Tabs value={discountType} onValueChange={(value) => setDiscountType(value as PaymentRuleType)}>
                      <TabsList className="h-10 rounded-xl bg-slate-100/80 p-1">
                        <TabsTrigger value="PERCENTAGE" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">%</TabsTrigger>
                        <TabsTrigger value="FIXED" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">R$</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-600">Valor</label>
                    <Input
                      name="paymentDiscountValue"
                      type="number"
                      min={0}
                      max={discountType === 'PERCENTAGE' ? 100 : 99999}
                      step={0.1}
                      placeholder={discountType === 'PERCENTAGE' ? '5.0' : '10.00'}
                      value={discountText}
                      onChange={(e) => setDiscountText(e.target.value)}
                      className="h-9 w-24 rounded-md border-gray-300 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-600">Prazo (dias antes)</label>
                    <Input
                      name="paymentDiscountDueDateLimitDays"
                      type="number"
                      min={0}
                      max={30}
                      value={discountDaysText}
                      onChange={(e) => setDiscountDaysText(e.target.value)}
                      placeholder="0"
                      className="h-9 w-20 rounded-md border-gray-300 text-sm"
                    />
                  </div>
                  <span className="pb-2 text-xs text-gray-400">0 = válido até o vencimento</span>
                </div>
              </div>
              <p className="mt-4 text-xs text-gray-500">Deixe os campos vazios para não aplicar estas configurações.</p>
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
