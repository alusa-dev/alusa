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
} from '@alusa/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { updateFinancialEntry, type FinancialEntryDTO } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, FILTER_INPUT_CLASS, getRoundedNowISOString, nullableString } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { FINANCIAL_STATUS_OPTIONS, isFinancialRealized, toCurrencyInputText } from './financial-entry-ui';

export function FinancialEntryEditDialog({
  entry,
  eventId,
  open,
  onOpenChange,
}: {
  entry: FinancialEntryDTO;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const statusOptions = FINANCIAL_STATUS_OPTIONS[entry.type];
  const [selectedStatus, setSelectedStatus] = useState<EventFinancialEntryStatus>(entry.status);
  const [expectedAmountText, setExpectedAmountText] = useState(toCurrencyInputText(entry.expectedAmount));
  const [actualAmountText, setActualAmountText] = useState(toCurrencyInputText(entry.actualAmount ?? entry.expectedAmount));
  const isRealized = isFinancialRealized(selectedStatus);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateFinancialEntry(entry.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Lançamento atualizado', description: 'As alterações foram salvas com sucesso.' });
      onOpenChange(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao editar lançamento', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const status = nullableString(formData, 'status') as EventFinancialEntryStatus;
    const realized = isFinancialRealized(status);

    mutation.mutate({
      category: nullableString(formData, 'category'),
      description: nullableString(formData, 'description'),
      supplier: entry.type === 'COST' ? nullableString(formData, 'supplier') : undefined,
      expectedAmount: parseCurrencyInput(nullableString(formData, 'expectedAmount') ?? expectedAmountText),
      actualAmount: realized ? parseCurrencyInput(nullableString(formData, 'actualAmount') ?? actualAmountText) : undefined,
      dueDate: realized ? undefined : datetimeValue(formData, 'dueDate'),
      realizedAt: realized ? datetimeValue(formData, 'realizedAt') : undefined,
      status,
      paymentMethod: realized ? nullableString(formData, 'paymentMethod') : undefined,
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar lançamento</DialogTitle>
          <DialogDescription>Atualize apenas lançamentos manuais. Lançamentos automáticos devem ser ajustados pela origem.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Categoria">
              <NativeSelect
                name="category"
                defaultValue={entry.category}
                required
                options={(entry.type === 'COST' ? EVENT_COST_CATEGORIES : EVENT_REVENUE_CATEGORIES).map((category) => ({ value: category, label: category }))}
              />
            </Field>
            <Field label="Status">
              <NativeSelect
                name="status"
                defaultValue={selectedStatus}
                required
                onValueChange={(val) => setSelectedStatus(val as EventFinancialEntryStatus)}
                options={statusOptions.map((status) => ({ value: status, label: EVENT_FINANCIAL_STATUS_LABELS[status] }))}
              />
            </Field>
            <Field label="Descrição">
              <Input name="description" defaultValue={entry.description} required className={FILTER_INPUT_CLASS} />
            </Field>
            {entry.type === 'COST' ? (
              <Field label="Fornecedor">
                <Input name="supplier" defaultValue={entry.supplier ?? ''} className={FILTER_INPUT_CLASS} />
              </Field>
            ) : null}
            <Field label="Valor previsto">
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-3 text-xs font-semibold text-slate-400">R$</span>
                <Input
                  name="expectedAmount"
                  type="text"
                  value={expectedAmountText}
                  onChange={(event) => setExpectedAmountText(formatCurrencyInput(event.target.value))}
                  className={cn(FILTER_INPUT_CLASS, 'pl-10 text-right')}
                  required
                />
              </div>
            </Field>
            {isRealized ? (
              <>
                <Field label={entry.type === 'COST' ? 'Valor pago' : 'Valor recebido'}>
                  <div className="relative flex items-center">
                    <span className="pointer-events-none absolute left-3 text-xs font-semibold text-slate-400">R$</span>
                    <Input
                      name="actualAmount"
                      type="text"
                      value={actualAmountText}
                      onChange={(event) => setActualAmountText(formatCurrencyInput(event.target.value))}
                      className={cn(FILTER_INPUT_CLASS, 'pl-10 text-right')}
                      required
                    />
                  </div>
                </Field>
                <Field label={entry.type === 'COST' ? 'Data de pagamento' : 'Data de recebimento'}>
                  <DateTimeField name="realizedAt" defaultValue={entry.realizedAt ?? getRoundedNowISOString()} />
                </Field>
                <Field label="Forma de pagamento">
                  <NativeSelect
                    name="paymentMethod"
                    defaultValue={entry.paymentMethod}
                    placeholder="Opcional"
                    options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                  />
                </Field>
              </>
            ) : (
              <Field label="Data prevista">
                <DateTimeField name="dueDate" defaultValue={entry.dueDate} />
              </Field>
            )}
          </div>
          <Field label="Observações">
            <Textarea name="notes" defaultValue={entry.notes ?? ''} className="rounded-xl border-slate-200" />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>Salvar alterações</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
