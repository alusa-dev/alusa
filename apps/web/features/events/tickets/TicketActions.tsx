'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical } from '@/components/icons/icons';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';

import {
  cancelTicketSale,
  deleteTicketSale,
  markTicketSalePaid,
  refundEventCharge,
  refundTicketSale,
  resendTicketSaleWhatsApp,
  type EventScopedResources,
  type TicketLotDTO,
  type TicketSaleDTO,
} from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { EditSaleFormDialog } from './EditSaleFormDialog';

export function TicketActions({ sale, eventId, lots, scopedResources }: { sale: TicketSaleDTO; eventId: string; lots: TicketLotDTO[]; scopedResources?: EventScopedResources }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
    ]);
  };

  const refundAsaas = useMutation({
    mutationFn: () => refundEventCharge(
      sale.eventMapOrderId
        ? `event-map-order:${sale.eventMapOrderId}`
        : `event-ticket-sale:${sale.id}`,
    ),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Estorno solicitado', description: 'O status será atualizado assim que a solicitação for confirmada.' });
      setRefundOpen(false);
    },
    onError: () => toast.error({
      title: 'Não foi possível solicitar o estorno',
      description: 'Tente novamente. Se o problema continuar, entre em contato com o suporte.',
    }),
  });

  const paid = useMutation({ mutationFn: () => markTicketSalePaid(sale.id), onSuccess: invalidate, onError: (err) => toast.error({ title: 'Erro ao marcar como pago', description: err.message }) });
  const cancel = useMutation({ mutationFn: () => cancelTicketSale(sale.id), onSuccess: invalidate, onError: (err) => toast.error({ title: 'Erro ao cancelar', description: err.message }) });
  const refund = useMutation({ mutationFn: () => refundTicketSale(sale.id), onSuccess: invalidate, onError: (err) => toast.error({ title: 'Erro ao estornar', description: err.message }) });
  const remove = useMutation({
    mutationFn: () => deleteTicketSale(sale.id),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Venda excluída', description: 'A venda de ingresso foi excluída com sucesso.' });
      setDeleteOpen(false);
    },
    onError: (err) => toast.error({ title: 'Erro ao excluir', description: err.message }),
  });
  const resendWhatsApp = useMutation({
    mutationFn: () => resendTicketSaleWhatsApp(sale.id),
    onSuccess: (result) => toast.success({
      title: result.active ? 'Envio em andamento' : 'Envio solicitado',
      description: result.active ? 'O envio desta venda já está em andamento.' : 'A solicitação de envio foi registrada.',
    }),
    onError: (error) => toast.error({ title: 'Não foi possível reenviar pelo WhatsApp', description: error.message }),
  });

  const isAsaasSale = Boolean(sale.asaasPaymentId || sale.paymentProvider === 'ASAAS');

  if (sale.source === 'PUBLIC_ORDER' || isAsaasSale) {
    const isRefundProcessing = sale.paymentStatus === 'REFUND_IN_PROGRESS' || sale.paymentStatus === 'REFUND_REQUESTED';
    const canRefundAsaas = sale.status === 'PAID' && Boolean(sale.asaasPaymentId) && !isRefundProcessing;
    const canResendWhatsApp = sale.status === 'PAID' && Boolean(sale.whatsappAvailable);
    const hasActions = Boolean(sale.chargeDetailUrl || sale.invoiceUrl || sale.ticketsUrl || canRefundAsaas || canResendWhatsApp);
    if (!hasActions) return <span className="text-slate-400">-</span>;

    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
            {sale.chargeDetailUrl ? (
              <DropdownMenuItem asChild>
                <Link href={sale.chargeDetailUrl}>Ver cobrança</Link>
              </DropdownMenuItem>
            ) : null}
            {sale.invoiceUrl ? (
              <DropdownMenuItem asChild>
                <Link href={sale.invoiceUrl} target="_blank">Abrir cobrança</Link>
              </DropdownMenuItem>
            ) : null}
            {sale.ticketsUrl ? (
              <DropdownMenuItem asChild>
                <Link href={sale.ticketsUrl} target="_blank">Ver ticket</Link>
              </DropdownMenuItem>
            ) : null}
            {canResendWhatsApp ? (
              <DropdownMenuItem className="whitespace-nowrap" onSelect={() => resendWhatsApp.mutate()} disabled={resendWhatsApp.isPending}>
                Reenviar ingresso pelo WhatsApp
              </DropdownMenuItem>
            ) : null}
            {canRefundAsaas ? (
              <>
                {(sale.ticketsUrl || sale.invoiceUrl || sale.chargeDetailUrl || canResendWhatsApp) ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
                  onClick={() => setRefundOpen(true)}
                >
                  Estornar pagamento
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <ConfirmDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          title="Estornar pagamento?"
          description="O estorno será solicitado e o status será atualizado após a confirmação."
          confirmText="Solicitar estorno"
          cancelText="Cancelar"
          variant="destructive"
          onConfirm={() => refundAsaas.mutate()}
          loading={refundAsaas.isPending}
        />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
          {sale.chargeDetailUrl ? (
            <DropdownMenuItem asChild>
              <Link href={sale.chargeDetailUrl}>Ver cobrança</Link>
            </DropdownMenuItem>
          ) : null}
          {sale.ticketsUrl && sale.hasSeatedTickets ? (
            <DropdownMenuItem asChild>
              <Link href={sale.ticketsUrl} target="_blank">Ver ticket</Link>
            </DropdownMenuItem>
          ) : null}
          {!sale.hasSeatedTickets ? (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              Editar
            </DropdownMenuItem>
          ) : null}

          {sale.status === 'PENDING' && (
            <DropdownMenuItem onClick={() => paid.mutate()}>
              Marcar como pago
            </DropdownMenuItem>
          )}

          {(sale.status === 'PENDING' || sale.status === 'COMPLIMENTARY') &&
            (sale.chargeDetailUrl || (sale.ticketsUrl && sale.hasSeatedTickets) || !sale.hasSeatedTickets || sale.status === 'PENDING' || sale.whatsappAvailable)
              ? <DropdownMenuSeparator />
              : null}
          {(sale.status === 'PENDING' || sale.status === 'COMPLIMENTARY') && (
            <DropdownMenuItem className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50" onClick={() => cancel.mutate()}>
              Cancelar venda
            </DropdownMenuItem>
          )}

          {sale.status === 'PAID' && sale.whatsappAvailable ? (
            <DropdownMenuItem className="whitespace-nowrap" onSelect={() => resendWhatsApp.mutate()} disabled={resendWhatsApp.isPending}>
              Reenviar ingresso pelo WhatsApp
            </DropdownMenuItem>
          ) : null}
          {sale.status === 'PAID' && (
            <>
              {(sale.chargeDetailUrl || (sale.ticketsUrl && sale.hasSeatedTickets) || !sale.hasSeatedTickets || sale.whatsappAvailable)
                ? <DropdownMenuSeparator />
                : null}
              <DropdownMenuItem className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50" onClick={() => refund.mutate()}>
                Estornar pagamento
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            disabled={sale.status === 'PAID'}
            onClick={() => setDeleteOpen(true)}
            title={sale.status === 'PAID' ? 'Não é possível excluir uma venda paga.' : undefined}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditSaleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        sale={sale}
        lots={lots}
        scopedResources={scopedResources}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir venda de ingresso"
        description={`Tem certeza que deseja excluir permanentemente a venda de ${sale.buyerName} (${sale.quantity}x ${sale.lot.name})?\n\nEsta ação removerá o registro de venda do sistema e atualizará o estoque do lote.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
      />
    </>
  );
}
