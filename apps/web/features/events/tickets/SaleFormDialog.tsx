'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_PAYMENT_METHOD_LABELS,
  EVENT_PAYMENT_METHODS,
  EVENT_TICKET_SALE_STATUS_LABELS,
  type EventTicketSaleStatus,
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

import { createTicketSale, formatCurrency, type EventResources, type TicketLotDTO } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, FILTER_INPUT_CLASS, getRoundedNowISOString, nullableString, numberValue } from '../shared/event-form-utils';

export function SaleFormDialog({ eventId, lots, resources, trigger }: { eventId: string; lots: TicketLotDTO[]; resources?: EventResources; trigger: React.ReactNode }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: createTicketSale,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Venda registrada', description: 'A venda de ingressos foi registrada com sucesso.' });
    },
    onError: (error) => toast.error({ title: 'Erro na venda', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    mutation.mutate({
      eventId,
      lotId: nullableString(formData, 'lotId'),
      buyerName: nullableString(formData, 'buyerName'),
      alunoId: nullableString(formData, 'alunoId'),
      responsavelId: nullableString(formData, 'responsavelId'),
      quantity: numberValue(formData, 'quantity') ?? 1,
      paymentMethod: nullableString(formData, 'paymentMethod'),
      status: nullableString(formData, 'status'),
      soldAt: datetimeValue(formData, 'soldAt'),
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar venda manual</DialogTitle>
          <DialogDescription>A venda valida estoque no backend e salva o preço como snapshot.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Lote"><NativeSelect name="lotId" required placeholder="Selecione" options={lots.filter((lot) => lot.status === 'ACTIVE').map((lot) => ({ value: lot.id, label: `${lot.name} · ${formatCurrency(lot.unitPrice)} · ${lot.quantityAvailable} disp.` }))} /></Field>
            <Field label="Comprador"><Input name="buyerName" required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Aluno vinculado"><NativeSelect name="alunoId" placeholder="Opcional" options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Responsável vinculado"><NativeSelect name="responsavelId" placeholder="Opcional" options={(resources?.responsaveis ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Quantidade"><Input name="quantity" type="number" min={1} defaultValue={1} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Forma de pagamento"><NativeSelect name="paymentMethod" defaultValue="MANUAL_PIX" options={EVENT_PAYMENT_METHODS.map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))} /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue="PENDING" options={(['PENDING', 'PAID', 'COMPLIMENTARY'] as EventTicketSaleStatus[]).map((status) => ({ value: status, label: EVENT_TICKET_SALE_STATUS_LABELS[status] }))} /></Field>
            <Field label="Data da venda"><DateTimeField name="soldAt" defaultValue={getRoundedNowISOString()} /></Field>
          </div>
          <Field label="Observações"><Textarea name="notes" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Registrar venda</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
