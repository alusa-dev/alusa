'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_COST_CATEGORIES,
  EVENT_FINANCIAL_STATUS_LABELS,
  EVENT_PAYMENT_METHOD_LABELS,
  EVENT_PAYMENT_METHODS,
  EVENT_REVENUE_CATEGORIES,
  type EventFinancialEntryStatus,
  type EventFinancialEntryType,
} from '@alusa/shared';

import { Button } from '@/components/ui/button';
import { wizardFieldInputClass, wizardTextareaFieldClass } from '@/components/shared/wizard/field-styles';
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
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { createFinancialEntry } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, getRoundedNowISOString, handleFormDataSubmit, nullableString } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';

export function FinancialFormDialog({ eventId, type, trigger }: { eventId: string; type: EventFinancialEntryType; trigger: React.ReactNode }) {
  const queryClient = useQueryClient();
  const statuses: EventFinancialEntryStatus[] = type === 'COST' ? ['EXPECTED', 'PENDING', 'PAID'] : ['EXPECTED', 'PENDING', 'RECEIVED'];
  const [open, setOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<EventFinancialEntryStatus>(statuses[0]);
  const [amountText, setAmountText] = useState("");

  const mutation = useMutation({
    mutationFn: createFinancialEntry,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({
        title: type === 'COST' ? 'Custo lançado' : 'Receita lançada',
        description: type === 'COST' ? 'O lançamento de custo foi registrado com sucesso.' : 'O lançamento de receita foi registrado com sucesso.'
      });
      setOpen(false);
      setAmountText("");
      setSelectedStatus(statuses[0]);
    },
    onError: (error) => toast.error({ title: 'Erro no lançamento', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const status = nullableString(formData, 'status') as EventFinancialEntryStatus;
    const isRealized = status === 'PAID' || status === 'RECEIVED';

    const category = nullableString(formData, 'category');
    const description = nullableString(formData, 'description');
    const supplier = nullableString(formData, 'supplier');
    const notes = nullableString(formData, 'notes');
    
    let expectedAmount = 0;
    let actualAmount: number | undefined = undefined;
    let dueDate: string | undefined = undefined;
    let realizedAt: string | undefined = undefined;
    let paymentMethod: string | undefined = undefined;

    if (isRealized) {
      const actualAmountRaw = nullableString(formData, 'actualAmount') ?? '';
      actualAmount = parseCurrencyInput(actualAmountRaw);
      expectedAmount = actualAmount;
      realizedAt = datetimeValue(formData, 'realizedAt');
      paymentMethod = nullableString(formData, 'paymentMethod');
      dueDate = realizedAt;
    } else {
      const expectedAmountRaw = nullableString(formData, 'expectedAmount') ?? '';
      expectedAmount = parseCurrencyInput(expectedAmountRaw);
      dueDate = datetimeValue(formData, 'dueDate');
    }

    mutation.mutate({
      eventId,
      type,
      category,
      description,
      supplier,
      expectedAmount,
      actualAmount,
      dueDate,
      realizedAt,
      status,
      paymentMethod,
      notes,
    });
  }

  const categories = type === 'COST' ? EVENT_COST_CATEGORIES : EVENT_REVENUE_CATEGORIES.filter((category) => category !== 'Venda de ingresso');
  const isRealized = selectedStatus === 'PAID' || selectedStatus === 'RECEIVED';

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (!val && mutation.isPending) return;
      setOpen(val);
      if (!val) {
        setAmountText("");
        setSelectedStatus(statuses[0]);
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        fullScreenMobile
        closeDisabled={mutation.isPending}
        className="flex max-w-[720px] flex-col gap-0 overflow-hidden rounded-[20px] p-0 sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0"
      >
        <DialogHeader className="shrink-0 border-b border-slate-100 px-6 pb-5 pt-6 text-left max-md:px-5 max-md:pb-4 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
          <DialogTitle className="text-xl font-normal tracking-tight text-slate-950">{type === 'COST' ? 'Novo custo' : 'Nova receita'}</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-slate-600">
            Informe os dados do lançamento para controle financeiro do evento.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => handleFormDataSubmit(event, submit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 max-md:px-5">
            <section aria-labelledby="new-financial-entry-fields-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <h3 id="new-financial-entry-fields-title" className="text-sm font-semibold text-slate-800">Dados do lançamento</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Categoria">
                  <NativeSelect name="category" required triggerClassName={wizardFieldInputClass} options={categories.map((category) => ({ value: category, label: category }))} />
                </Field>
                <Field label="Status">
                  <NativeSelect
                    key={selectedStatus}
                    name="status"
                    defaultValue={selectedStatus}
                    onValueChange={(val) => setSelectedStatus(val as EventFinancialEntryStatus)}
                    triggerClassName={wizardFieldInputClass}
                    options={statuses.map((status) => ({ value: status, label: EVENT_FINANCIAL_STATUS_LABELS[status] }))}
                  />
                </Field>
                <Field label="Descrição">
                  <Input name="description" required className={wizardFieldInputClass} />
                </Field>
                {type === 'COST' ? (
                  <Field label="Fornecedor">
                    <Input name="supplier" className={wizardFieldInputClass} />
                  </Field>
                ) : null}

                {isRealized ? (
                  <>
                    <Field label={type === 'COST' ? 'Valor pago' : 'Valor recebido'}>
                      <div className="relative flex items-center">
                        <span className="pointer-events-none absolute left-3 text-[13px] text-slate-500">R$</span>
                        <Input
                          name="actualAmount"
                          type="text"
                          value={amountText}
                          onChange={(event) => setAmountText(formatCurrencyInput(event.target.value))}
                          className={cn(wizardFieldInputClass, 'pl-9 text-left tabular-nums')}
                          required
                        />
                      </div>
                    </Field>
                    <Field label={type === 'COST' ? 'Data de pagamento' : 'Data de recebimento'}>
                      <DateTimeField name="realizedAt" defaultValue={getRoundedNowISOString()} inputClassName={wizardFieldInputClass} timeSelectClassName={wizardFieldInputClass} />
                    </Field>
                    <Field label="Forma de pagamento">
                      <NativeSelect
                        name="paymentMethod"
                        placeholder="Opcional"
                        triggerClassName={wizardFieldInputClass}
                        options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Valor previsto">
                      <div className="relative flex items-center">
                        <span className="pointer-events-none absolute left-3 text-[13px] text-slate-500">R$</span>
                        <Input
                          name="expectedAmount"
                          type="text"
                          value={amountText}
                          onChange={(event) => setAmountText(formatCurrencyInput(event.target.value))}
                          className={cn(wizardFieldInputClass, 'pl-9 text-left tabular-nums')}
                          required
                        />
                      </div>
                    </Field>
                    <Field label="Data prevista">
                      <DateTimeField name="dueDate" inputClassName={wizardFieldInputClass} timeSelectClassName={wizardFieldInputClass} />
                    </Field>
                  </>
                )}
              </div>
              <Field label="Observações">
                <Textarea name="notes" className={wizardTextareaFieldClass} />
              </Field>
            </section>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-slate-100 bg-white px-6 py-4 max-md:px-5">
            <Button type="button" variant="wizardSecondary" onClick={() => setOpen(false)} disabled={mutation.isPending} className="h-10 min-h-10 w-[120px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full">
              Cancelar
            </Button>
            <Button type="submit" variant="wizardPrimary" disabled={mutation.isPending} className="h-10 min-h-10 w-[180px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full">
              {mutation.isPending ? <><span>Salvando</span><LoadingDots label="Salvando lançamento" size="sm" className="text-white" /></> : 'Salvar lançamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
