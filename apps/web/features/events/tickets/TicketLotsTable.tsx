'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react';
import { EVENT_TICKET_LOT_STATUS_LABELS, EVENT_TICKET_TYPE_LABELS } from '@alusa/shared';

import DataTable from '@/components/layout/DataTable';
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

import { deleteTicketLot, formatCurrency, type TicketLotDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventSoftBadge as SoftBadge, type EventSoftBadgeTone } from '../shared/EventSoftBadge';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { eventQueryKeys } from '../shared/event-query-keys';
import { LotFormDialog } from './LotFormDialog';

const LOT_STATUS_TONES: Record<TicketLotDTO['status'], EventSoftBadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  SOLD_OUT: 'warning',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
  ARCHIVED: 'neutral',
};

function LotActions({ lot, eventId }: { lot: TicketLotDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
    ]);
  };

  const remove = useMutation({
    mutationFn: () => deleteTicketLot(lot.id),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Lote excluído', description: 'O lote de ingressos foi removido com sucesso.' });
      setDeleteOpen(false);
    },
    onError: (err) => toast.error({ title: 'Erro ao excluir lote', description: err.message }),
  });

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

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            disabled={lot.quantitySold > 0}
            onClick={() => setDeleteOpen(true)}
            title={lot.quantitySold > 0 ? 'Não é possível excluir um lote com ingressos já vendidos.' : undefined}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LotFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        lot={lot}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir lote de ingressos"
        description={`Tem certeza que deseja excluir permanentemente o lote "${lot.name}"?\n\nEsta ação removerá o lote do evento e não poderá ser desfeita.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
      />
    </>
  );
}

export function TicketLotsTable({ lots, eventId, loading }: { lots: TicketLotDTO[]; eventId: string; loading: boolean }) {
  return (
    <TablePanel>
      <DataTable
        paginate={true}
        pageSize={5}
        columns={[
          { id: 'name', header: 'Lote', width: 'w-[24%]', align: 'left', render: (lot: TicketLotDTO) => <span className="font-medium text-slate-950">{lot.name}</span> },
          { id: 'type', header: 'Tipo', width: 'w-[16%]', align: 'left', render: (lot: TicketLotDTO) => EVENT_TICKET_TYPE_LABELS[lot.ticketType] },
          { id: 'price', header: 'Valor', width: 'w-[15%]', align: 'right', render: (lot: TicketLotDTO) => formatCurrency(lot.unitPrice) },
          { id: 'stock', header: 'Vendido/Total', width: 'w-[18%]', align: 'right', render: (lot: TicketLotDTO) => lot.quantitySold + '/' + lot.quantityTotal },
          { id: 'status', header: 'Status', width: 'w-[15%]', align: 'center', render: (lot: TicketLotDTO) => <SoftBadge tone={LOT_STATUS_TONES[lot.status]}>{EVENT_TICKET_LOT_STATUS_LABELS[lot.status]}</SoftBadge> },
          { id: 'actions', header: 'Ações', width: 'w-[12%]', align: 'right', render: (lot: TicketLotDTO) => <LotActions lot={lot} eventId={eventId} /> },
        ]}
        data={lots}
        rowKey={(lot) => lot.id}
        loading={loading}
        emptyMessage={<EmptyState title="Nenhum lote criado." description="Crie um lote para começar a registrar vendas de ingressos deste evento." />}
      />
    </TablePanel>
  );
}
