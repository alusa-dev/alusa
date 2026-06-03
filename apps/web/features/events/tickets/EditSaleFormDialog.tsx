'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_PAYMENT_METHOD_LABELS,
  EVENT_PAYMENT_METHODS,
  EVENT_TICKET_SALE_STATUS_LABELS,
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

import { formatCurrency, updateTicketSale, type EventResources, type TicketLotDTO, type TicketSaleDTO } from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, FILTER_INPUT_CLASS, nullableString, numberValue } from '../shared/event-form-utils';

export function EditSaleFormDialog({
  open,
  onOpenChange,
  eventId,
  sale,
  lots,
  resources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  sale: TicketSaleDTO;
  lots: TicketLotDTO[];
  resources?: EventResources;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateTicketSale(sale.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Venda atualizada', description: 'A venda de ingressos foi atualizada com sucesso.' });
      onOpenChange(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao atualizar venda', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    mutation.mutate({
      lotId: nullableString(formData, 'lotId'),
      buyerName: nullableString(formData, 'buyerName'),
      alunoId: nullableString(formData, 'alunoId') || null,
      responsavelId: nullableString(formData, 'responsavelId') || null,
      quantity: numberValue(formData, 'quantity') ?? 1,
      paymentMethod: nullableString(formData, 'paymentMethod'),
      status: nullableString(formData, 'status'),
      soldAt: datetimeValue(formData, 'soldAt'),
      notes: nullableString(formData, 'notes') || null,
    });
  }

  const lotOptions = lots
    .filter((lot) => lot.status === 'ACTIVE' || lot.id === sale.lotId)
    .map((lot) => ({
      value: lot.id,
      label: `${lot.name} · ${formatCurrency(lot.unitPrice)} · ${lot.quantityAvailable + (lot.id === sale.lotId ? sale.quantity : 0)} disp.`,
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar venda de ingresso</DialogTitle>
          <DialogDescription>Altere as informações da venda. O estoque e o lançamento financeiro associados serão atualizados.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Lote">
              <NativeSelect
                name="lotId"
                required
                defaultValue={sale.lotId}
                options={lotOptions}
              />
            </Field>
            <Field label="Comprador">
              <Input
                name="buyerName"
                required
                defaultValue={sale.buyerName}
                className={FILTER_INPUT_CLASS}
              />
            </Field>
            <Field label="Aluno vinculado">
              <NativeSelect
                name="alunoId"
                placeholder="Opcional"
                defaultValue={sale.aluno?.id ?? ''}
                options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Responsável vinculado">
              <NativeSelect
                name="responsavelId"
                placeholder="Opcional"
                defaultValue={sale.responsavel?.id ?? ''}
                options={(resources?.responsaveis ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Quantidade">
              <Input
                name="quantity"
                type="number"
                min={1}
                defaultValue={sale.quantity}
                required
                className={FILTER_INPUT_CLASS}
              />
            </Field>
            <Field label="Forma de pagamento">
              <NativeSelect
                name="paymentMethod"
                defaultValue={sale.paymentMethod}
                options={EVENT_PAYMENT_METHODS.map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
              />
            </Field>
            <Field label="Status">
              <NativeSelect
                name="status"
                defaultValue={sale.status}
                options={Object.entries(EVENT_TICKET_SALE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Data da venda">
              <DateTimeField name="soldAt" defaultValue={sale.soldAt} />
            </Field>
          </div>
          <Field label="Observações">
            <Textarea
              name="notes"
              defaultValue={sale.notes ?? ''}
              className="rounded-xl border-slate-200"
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
