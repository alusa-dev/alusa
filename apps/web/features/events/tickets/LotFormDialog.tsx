'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_TICKET_LOT_STATUS_LABELS,
  EVENT_TICKET_TYPE_LABELS,
  EVENT_TICKET_TYPES,
  type EventTicketMode,
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
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { wizardFieldInputClass, wizardTextareaFieldClass } from '@/components/shared/wizard/field-styles';

import { createTicketLot, updateTicketLot, type TicketLotDTO } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, getRoundedNowISOString, handleFormDataSubmit, nullableString, numberValue } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';

export function LotFormDialog({
  eventId,
  ticketMode = 'SIMPLE',
  trigger,
  lot,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  eventId: string;
  ticketMode?: EventTicketMode;
  trigger?: React.ReactNode;
  lot?: TicketLotDTO;
  open?: boolean;
  onOpenChange?: (_open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : localOpen;
  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return;
    (controlledOnOpenChange ?? setLocalOpen)(nextOpen);
  };
  const [priceText, setPriceText] = useState('');
  const isNumberedSeats = ticketMode === 'NUMBERED_SEATS';

  useEffect(() => {
    if (open) {
      const price = lot?.unitPrice ?? 0;
      setPriceText(price > 0 ? price.toFixed(2).replace('.', ',') : '0,00');
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
        description: lot ? 'As alterações do lote foram salvas com sucesso.' : 'O novo lote de ingressos foi criado com sucesso.',
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
      ...(isNumberedSeats ? {} : { quantityTotal: numberValue(formData, 'quantityTotal') }),
      saleStartsAt: datetimeValue(formData, 'saleStartsAt'),
      saleEndsAt: datetimeValue(formData, 'saleEndsAt'),
      status: nullableString(formData, 'status') ?? 'DRAFT',
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        fullScreenMobile
        closeDisabled={mutation.isPending}
        className="flex min-h-0 max-h-[calc(100dvh-3rem)] max-w-[720px] flex-col gap-0 overflow-hidden rounded-[20px] p-0 sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0"
      >
        <DialogHeader className="shrink-0 border-b border-slate-100 px-6 pb-5 pt-6 text-left max-md:px-5 max-md:pb-4 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
          <DialogTitle className="text-xl font-normal tracking-tight text-slate-950">{lot ? 'Editar lote' : 'Novo lote'}</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-slate-600">
            {isNumberedSeats
              ? 'Configure valor e período de vendas. A capacidade virá dos assentos vinculados no mapa.'
              : 'Configure estoque, valor e período de vendas.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => handleFormDataSubmit(event, submit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 max-md:px-5">
            <section aria-labelledby="ticket-lot-fields-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <h3 id="ticket-lot-fields-title" className="text-sm font-semibold text-slate-800">Dados do lote</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome do lote"><Input name="name" defaultValue={lot?.name ?? ''} required className={wizardFieldInputClass} /></Field>
                <Field label="Tipo"><NativeSelect name="ticketType" defaultValue={lot?.ticketType ?? 'FULL'} options={EVENT_TICKET_TYPES.map((type) => ({ value: type, label: EVENT_TICKET_TYPE_LABELS[type] }))} required triggerClassName={wizardFieldInputClass} /></Field>
                <Field label="Valor unitário">
                  <div className="relative flex items-center">
                    <span className="pointer-events-none absolute left-3 text-[13px] text-slate-500">R$</span>
                    <Input
                      name="unitPrice"
                      type="text"
                      value={priceText}
                      onChange={(e) => setPriceText(formatCurrencyInput(e.target.value))}
                      className={cn(wizardFieldInputClass, 'pl-9 text-left tabular-nums')}
                      required
                    />
                  </div>
                </Field>
                {isNumberedSeats ? (
                  <Field label="Capacidade">
                    <div className={cn(wizardFieldInputClass, 'flex items-center bg-slate-50 text-sm text-slate-600')}>
                      {lot?.quantityTotal ? `${lot.quantityTotal} assentos no mapa` : 'Definida pelos assentos do mapa'}
                    </div>
                  </Field>
                ) : (
                  <Field label="Quantidade">
                    <Input name="quantityTotal" type="number" min={1} defaultValue={lot?.quantityTotal ?? 1} required className={wizardFieldInputClass} />
                  </Field>
                )}
                <Field label="Início das vendas"><DateTimeField name="saleStartsAt" defaultValue={lot?.saleStartsAt ?? getRoundedNowISOString()} inputClassName={wizardFieldInputClass} timeSelectClassName={wizardFieldInputClass} /></Field>
                <Field label="Fim das vendas (opcional)"><DateTimeField name="saleEndsAt" defaultValue={lot?.saleEndsAt} inputClassName={wizardFieldInputClass} timeSelectClassName={wizardFieldInputClass} /></Field>
                <Field label="Status"><NativeSelect name="status" defaultValue={lot?.status ?? 'DRAFT'} options={Object.entries(EVENT_TICKET_LOT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} triggerClassName={wizardFieldInputClass} /></Field>
              </div>
              <Field label="Observações"><Textarea name="notes" defaultValue={lot?.notes ?? ''} className={wizardTextareaFieldClass} /></Field>
            </section>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-slate-100 bg-white px-6 py-4 max-md:px-5 max-md:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <Button type="button" variant="wizardSecondary" onClick={() => setOpen(false)} disabled={mutation.isPending} className="h-10 min-h-10 w-[120px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full">
              Cancelar
            </Button>
            <Button type="submit" variant="wizardPrimary" disabled={mutation.isPending} className="h-10 min-h-10 w-[180px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full">
              {mutation.isPending ? <><span>Salvando</span><LoadingDots label="Salvando lote" size="sm" className="text-white" /></> : 'Salvar lote'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
