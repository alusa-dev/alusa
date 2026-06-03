'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react';

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
  refundPublicEventMapOrder,
  refundTicketSale,
  type EventResources,
  type TicketLotDTO,
  type TicketSaleDTO,
} from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { EditSaleFormDialog } from './EditSaleFormDialog';

export function TicketActions({ sale, eventId, lots, resources }: { sale: TicketSaleDTO; eventId: string; lots: TicketLotDTO[]; resources?: EventResources }) {
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

  const refundPublic = useMutation({
    mutationFn: () => refundPublicEventMapOrder(sale.eventMapOrderId ?? sale.id),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Estorno solicitado', description: 'O status será atualizado automaticamente via webhook do Asaas.' });
      setRefundOpen(false);
    },
    onError: (err) => toast.error({ title: 'Erro ao estornar pagamento', description: err.message }),
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

  if (sale.source === 'PUBLIC_ORDER') {
    const hasActions = Boolean(sale.invoiceUrl || sale.ticketsUrl || (sale.status === 'PAID' && sale.eventMapOrderId));
    if (!hasActions) return <span className="text-slate-400">-</span>;

    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {sale.status === 'RESERVED' && sale.invoiceUrl ? (
              <DropdownMenuItem asChild>
                <Link href={sale.invoiceUrl} target="_blank">Cobrança</Link>
              </DropdownMenuItem>
            ) : null}
            {sale.ticketsUrl ? (
              <DropdownMenuItem asChild>
                <Link href={sale.ticketsUrl} target="_blank">Ver ticket</Link>
              </DropdownMenuItem>
            ) : null}
            {sale.status === 'PAID' && sale.eventMapOrderId ? (
              <>
                {(sale.ticketsUrl || sale.invoiceUrl) ? <DropdownMenuSeparator /> : null}
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
          description="O estorno será solicitado no Asaas e o status final será confirmado via webhook."
          confirmText="Solicitar estorno"
          cancelText="Cancelar"
          variant="destructive"
          onConfirm={() => refundPublic.mutate()}
          loading={refundPublic.isPending}
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
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>

          {sale.status === 'PENDING' && (
            <DropdownMenuItem onClick={() => paid.mutate()}>
              Marcar como Pago
            </DropdownMenuItem>
          )}

          {(sale.status === 'PENDING' || sale.status === 'COMPLIMENTARY') && (
            <DropdownMenuItem onClick={() => cancel.mutate()}>
              Cancelar Venda
            </DropdownMenuItem>
          )}

          {sale.status === 'PAID' && (
            <DropdownMenuItem onClick={() => refund.mutate()}>
              Estornar
            </DropdownMenuItem>
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
        resources={resources}
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
