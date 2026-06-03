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

import { createFinancialEntry } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, FILTER_INPUT_CLASS, getRoundedNowISOString, nullableString } from '../shared/event-form-utils';
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

  const categories = type === 'COST' ? EVENT_COST_CATEGORIES : EVENT_REVENUE_CATEGORIES;
  const isRealized = selectedStatus === 'PAID' || selectedStatus === 'RECEIVED';

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) {
        setAmountText("");
        setSelectedStatus(statuses[0]);
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{type === 'COST' ? 'Novo custo' : 'Nova receita'}</DialogTitle>
          <DialogDescription>Informe os dados do lançamento para controle financeiro do evento.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Categoria">
              <NativeSelect name="category" required options={categories.map((category) => ({ value: category, label: category }))} />
            </Field>
            <Field label="Status">
              <NativeSelect
                key={selectedStatus}
                name="status"
                defaultValue={selectedStatus}
                onValueChange={(val) => setSelectedStatus(val as EventFinancialEntryStatus)}
                options={statuses.map((status) => ({ value: status, label: EVENT_FINANCIAL_STATUS_LABELS[status] }))}
              />
            </Field>
            <Field label="Descrição">
              <Input name="description" required className={FILTER_INPUT_CLASS} />
            </Field>
            {type === 'COST' ? (
              <Field label="Fornecedor">
                <Input name="supplier" className={FILTER_INPUT_CLASS} />
              </Field>
            ) : null}

            {isRealized ? (
              <>
                <Field label={type === 'COST' ? 'Valor pago' : 'Valor recebido'}>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                      R$
                    </span>
                    <Input
                      name="actualAmount"
                      type="text"
                      value={amountText}
                      onChange={(e) => setAmountText(formatCurrencyInput(e.target.value))}
                      className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                      required
                    />
                  </div>
                </Field>
                <Field label={type === 'COST' ? 'Data de pagamento' : 'Data de recebimento'}>
                  <DateTimeField name="realizedAt" defaultValue={getRoundedNowISOString()} />
                </Field>
                <Field label="Forma de pagamento">
                  <NativeSelect
                    name="paymentMethod"
                    placeholder="Opcional"
                    options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Valor previsto">
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                      R$
                    </span>
                    <Input
                      name="expectedAmount"
                      type="text"
                      value={amountText}
                      onChange={(e) => setAmountText(formatCurrencyInput(e.target.value))}
                      className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                      required
                    />
                  </div>
                </Field>
                <Field label="Data prevista">
                  <DateTimeField name="dueDate" />
                </Field>
              </>
            )}
          </div>
          <Field label="Observações">
            <Textarea name="notes" className="rounded-xl border-slate-200" />
          </Field>
          <DialogFooter>
            <Button type="submit">Salvar lançamento</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
