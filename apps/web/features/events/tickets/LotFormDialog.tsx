'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_TICKET_LOT_STATUS_LABELS,
  EVENT_TICKET_TYPE_LABELS,
  EVENT_TICKET_TYPES,
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

import { createTicketLot, updateTicketLot, type TicketLotDTO } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, FILTER_INPUT_CLASS, getRoundedNowISOString, nullableString, numberValue } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';

export function LotFormDialog({
  eventId,
  trigger,
  lot,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  eventId: string;
  trigger?: React.ReactNode;
  lot?: TicketLotDTO;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : localOpen;
  const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setLocalOpen;
  const [priceText, setPriceText] = useState("");

  useEffect(() => {
    if (open) {
      const price = lot?.unitPrice ?? 0;
      setPriceText(price > 0 ? price.toFixed(2).replace('.', ',') : "0,00");
    }
  }, [open, lot]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => (lot ? updateTicketLot(lot.id, payload) : createTicketLot(payload)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({
        title: lot ? 'Lote atualizado' : 'Lote criado',
        description: lot ? 'As alterações do lote foram salvas com sucesso.' : 'O novo lote de ingressos foi criado com sucesso.'
      });
      setOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro no lote', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const unitPriceRaw = nullableString(formData, 'unitPrice') ?? '';
    const unitPrice = parseCurrencyInput(unitPriceRaw);

    mutation.mutate({
      eventId,
      name: nullableString(formData, 'name'),
      ticketType: nullableString(formData, 'ticketType'),
      unitPrice,
      quantityTotal: numberValue(formData, 'quantityTotal'),
      saleStartsAt: datetimeValue(formData, 'saleStartsAt'),
      saleEndsAt: datetimeValue(formData, 'saleEndsAt'),
      status: nullableString(formData, 'status') ?? 'DRAFT',
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lot ? 'Editar lote' : 'Novo lote'}</DialogTitle>
          <DialogDescription>Configure estoque, valor e período de vendas.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do lote"><Input name="name" defaultValue={lot?.name ?? ''} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Tipo"><NativeSelect name="ticketType" defaultValue={lot?.ticketType ?? 'FULL'} options={EVENT_TICKET_TYPES.map((type) => ({ value: type, label: EVENT_TICKET_TYPE_LABELS[type] }))} required /></Field>
            <Field label="Valor unitário">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="unitPrice"
                  type="text"
                  value={priceText}
                  onChange={(e) => setPriceText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                  required
                />
              </div>
            </Field>
            <Field label="Quantidade"><Input name="quantityTotal" type="number" min={1} defaultValue={lot?.quantityTotal ?? 1} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Início das vendas"><DateTimeField name="saleStartsAt" defaultValue={lot?.saleStartsAt ?? getRoundedNowISOString()} /></Field>
            <Field label="Fim das Vendas (opcional)"><DateTimeField name="saleEndsAt" defaultValue={lot?.saleEndsAt} /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue={lot?.status ?? 'DRAFT'} options={Object.entries(EVENT_TICKET_LOT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
          </div>
          <Field label="Observações"><Textarea name="notes" defaultValue={lot?.notes ?? ''} className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Salvar lote</Button></DialogFooter>
        </form>
      </DialogContent>

    </Dialog>
  );
}
