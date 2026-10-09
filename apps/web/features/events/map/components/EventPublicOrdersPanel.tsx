'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useState } from 'react';

import { CheckCircle, ExternalLink, InfoCircle, Loader2, MoreVertical, Refresh as RefreshCw, Search, Ticket } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import Pagination from '@/components/layout/Pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';

import type { SchoolEventDTO } from '../../events-service';
import { EventSoftBadge } from '../../shared/EventSoftBadge';
import { EventTablePanel } from '../../shared/EventTablePanel';
import { canRequestEventRefund } from '../../shared/event-refund-permission';
import { isSafePaymentUrl, publicOrderAdminActions, publicOrderAdminStatusDescription, publicOrderAdminStatusLabel, publicOrderAdminStatusVariant } from './public-order-admin-utils';

type PublicOrderListItem = {
  id: string;
  buyerName: string;
  buyerEmail: string;
  totalAmount: number;
  status: string;
  ticketFulfillmentStatus: 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
  paymentMethod: string | null;
  paymentStatus: string | null;
  asaasPaymentId: string | null;
  invoiceUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  cancelledAt: string | null;
  map: { id: string; name: string; publicSlug: string | null };
  lotNames: string[];
  seatCount: number;
  ticketCount: number;
  ticketsUsed: number;
};

type TicketInfo = {
  ticketCode: string;
  status: string;
  usedAt: string | null;
  order: { id: string; buyerName: string; status: string } | null;
  sale: { id: string; buyerName: string; status: string } | null;
  seat: { sectionName: string; seatLabel: string; technicalCode: string } | null;
};

type TicketVerifyApiResponse =
  | { ticket: TicketInfo }
  | { ok: true; alreadyUsed: boolean; ticket: TicketInfo };

function extractTicketInfo(data: TicketVerifyApiResponse): TicketInfo {
  return data.ticket;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message ?? 'Não foi possível concluir.';
    throw new Error(message);
  }
  return (json as { data: T }).data;
}

type OrdersResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: PublicOrderListItem[];
  summary: {
    ordersTotal: number;
    waitingPayment: number;
    expired: number;
    issuing: number;
    issuanceFailed: number;
    completed: number;
    refunding: number;
    ticketsIssued: number;
    checkedIn: number;
  };
};

export function EventPublicOrdersPanel({ event }: { event: SchoolEventDTO }) {
  const { data: session } = useSession();
  const mayRequestRefund = canRequestEventRefund(session?.user?.role);
  const queryClient = useQueryClient();
  const [ticketCode, setTicketCode] = useState('');
  const [verifyResult, setVerifyResult] = useState<TicketInfo | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [refundTarget, setRefundTarget] = useState<PublicOrderListItem | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PublicOrderListItem | null>(null);
  const [refundedDetailsTarget, setRefundedDetailsTarget] = useState<PublicOrderListItem | null>(null);
  const [cancelledDetailsTarget, setCancelledDetailsTarget] = useState<PublicOrderListItem | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['events', event.id, 'public-orders', page, search, statusFilter],
    queryFn: async () => {
      const query = new URLSearchParams({ page: String(page), pageSize: '6' });
      if (search.trim()) query.set('search', search.trim());
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      return parseResponse<OrdersResponse>(await fetch(`/api/events/${event.id}/public-orders?${query}`));
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const verifyMutation = useMutation({
    mutationFn: async (confirm: boolean) =>
      parseResponse<TicketVerifyApiResponse>(
        await fetch(`/api/events/${event.id}/public-orders/verify-ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketCode, confirm }),
        }),
      ),
    onSuccess: async (data, confirm) => {
      const ticket = extractTicketInfo(data);
      setVerifyResult(ticket);
      if (confirm) {
        await queryClient.invalidateQueries({ queryKey: ['events', event.id, 'public-orders'] });
        const alreadyUsed = 'alreadyUsed' in data && data.alreadyUsed;
        toast.success({
          title: alreadyUsed ? 'Ingresso já utilizado' : 'Check-in registrado',
          description: ticket.seat ? `${ticket.seat.seatLabel} — ${ticket.seat.sectionName}` : ticket.ticketCode,
        });
      }
    },
    onError: (error) => {
      setVerifyResult(null);
      toast.error({ title: 'Ingresso inválido', description: (error as Error).message });
    },
  });

  const refundMutation = useMutation({
    mutationFn: async (order: PublicOrderListItem) => {
      const response = await fetch(`/api/events/public-orders/${order.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? json?.message ?? 'Não foi possível solicitar o estorno.');
      return json;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events', event.id, 'public-orders'] });
      toast.success({ title: 'Estorno solicitado', description: 'O status será atualizado assim que a solicitação for confirmada.' });
      setRefundTarget(null);
    },
    onError: () => toast.error({
      title: 'Não foi possível solicitar o estorno',
      description: 'Tente novamente. Se o problema continuar, entre em contato com o suporte.',
    }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (order: PublicOrderListItem) => {
      const response = await fetch(`/api/events/public-orders/${order.id}/cancel`, { method: 'POST' });
      const json = await response.json().catch(() => null);
      if (response.status === 202) return { processing: true as const };
      if (!response.ok) throw new Error(json?.error?.message ?? 'Não foi possível cancelar o pedido.');
      return { processing: false as const, result: json };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['events', event.id, 'public-orders'] });
      if (result.processing) {
        toast.info({ title: 'Cancelamento em processamento', description: 'Atualize o pedido em instantes para confirmar o status.' });
      } else {
        toast.success({ title: 'Pedido cancelado', description: 'A cobrança foi cancelada e os assentos foram liberados.' });
      }
      setCancelTarget(null);
    },
    onError: () => toast.error({ title: 'Não foi possível cancelar o pedido', description: 'Tente novamente. Se o problema continuar, entre em contato com o suporte.' }),
  });

  const orders = ordersQuery.data?.items ?? [];
  const verifiedCurrentTicket = verifyResult?.ticketCode === ticketCode.trim().toUpperCase() ? verifyResult : null;
  const orderColumns: DataTableColumn<PublicOrderListItem>[] = [
    {
      id: 'buyer',
      header: 'Comprador',
      width: 'w-[24%]',
      align: 'left',
      render: (order) => (
        <div className="min-w-0">
          <strong className="block truncate font-medium text-slate-950">{order.buyerName}</strong>
          <span className="block truncate text-xs text-slate-500">{order.buyerEmail}</span>
        </div>
      ),
    },
    {
      id: 'map',
      header: 'Mapa/Lote',
      width: 'w-[18%]',
      align: 'left',
      render: (order) => (
        <div className="min-w-0">
          <strong className="block truncate font-medium text-slate-950" title={order.map.name}>
            {order.map.name}
          </strong>
          <span className="block truncate text-xs text-slate-500" title={order.lotNames?.join(' · ')}>
            {order.lotNames?.length ? order.lotNames.join(' · ') : 'Sem lote'}
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-[12%]',
      align: 'left',
      render: (order) => (
        <span title={publicOrderAdminStatusDescription(order)}>
          <EventSoftBadge tone={publicOrderAdminStatusVariant(order)}>
            {publicOrderAdminStatusLabel(order)}
          </EventSoftBadge>
        </span>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      width: 'w-[11%]',
      align: 'right',
      render: (order) => formatCurrency(order.totalAmount),
    },
    {
      id: 'tickets',
      header: 'Ingressos',
      width: 'w-[10%]',
      align: 'center',
      render: (order) => (
        <span className="tabular-nums text-slate-600">
          {order.ticketCount}/{order.seatCount}
          {order.ticketsUsed > 0 ? ` · ${order.ticketsUsed} usados` : ''}
        </span>
      ),
    },
    {
      id: 'created',
      header: 'Criado',
      width: 'w-[17%]',
      align: 'left',
      render: (order) => <span className="text-slate-600">{formatDate(order.createdAt)}</span>,
    },
    {
      id: 'actions',
      header: 'Ações',
      width: 'w-[8%]',
      align: 'center',
      render: (order) => {
        const { canViewRefundDetails, canViewCancellationDetails, invoiceUrl, canDownloadTickets, canRefund, canCancel } = publicOrderAdminActions(order, mayRequestRefund);

        if (!canViewRefundDetails && !canViewCancellationDetails && !invoiceUrl && !canDownloadTickets && !canRefund && !canCancel) return <span className="text-slate-400">—</span>;

        return (
          <div className="flex justify-center" onClick={(clickEvent) => clickEvent.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                  aria-label={`Ações do pedido de ${order.buyerName}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {canViewRefundDetails ? (
                  <DropdownMenuItem className="whitespace-nowrap" onSelect={() => setRefundedDetailsTarget(order)}>
                    Ver detalhes do estorno
                  </DropdownMenuItem>
                ) : null}
                {canViewCancellationDetails ? (
                  <DropdownMenuItem className="whitespace-nowrap" onSelect={() => setCancelledDetailsTarget(order)}>
                    Ver detalhes do cancelamento
                  </DropdownMenuItem>
                ) : null}
                {invoiceUrl ? (
                  <DropdownMenuItem asChild className="whitespace-nowrap">
                    <a href={invoiceUrl} target="_blank" rel="noreferrer">Ver cobrança</a>
                  </DropdownMenuItem>
                ) : null}
                {canDownloadTickets ? (
                  <DropdownMenuItem asChild className="whitespace-nowrap">
                    <a href={`/api/events/public-orders/${order.id}/tickets`} target="_blank" rel="noreferrer">
                      <Ticket className="mr-2 h-4 w-4" />
                      Baixar ingressos (PDF)
                    </a>
                  </DropdownMenuItem>
                ) : null}
                {canRefund ? (
                  <DropdownMenuItem
                    className="whitespace-nowrap text-rose-700 focus:text-rose-700"
                    onSelect={() => setRefundTarget(order)}
                  >
                    Solicitar estorno
                  </DropdownMenuItem>
                ) : null}
                {canCancel ? (
                  <DropdownMenuItem className="whitespace-nowrap text-rose-700 focus:text-rose-700" onSelect={() => setCancelTarget(order)}>
                    Cancelar pedido
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Check-in por código</h3>
        <p className="mt-1 text-sm text-slate-500">Valide ingressos do mapa público na entrada do evento.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="ticket-code-check-in">Código do ingresso</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <Input
                id="ticket-code-check-in"
                value={ticketCode}
                onChange={(eventInput) => {
                  setTicketCode(eventInput.target.value.toUpperCase());
                  setVerifyResult(null);
                }}
                placeholder="TICKET_..."
                className="h-10 rounded-lg border-slate-200 bg-white pl-10 font-mono text-sm uppercase shadow-none placeholder:text-slate-400 focus-visible:border-[#A94DFF] focus-visible:ring-2 focus-visible:ring-[#A94DFF]/30"
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 whitespace-nowrap shadow-none"
            disabled={!ticketCode.trim() || verifyMutation.isPending}
            onClick={() => verifyMutation.mutate(false)}
          >
            <Search className="h-4 w-4" />
            Verificar
          </Button>
          <Button
            type="button"
            className="h-10 whitespace-nowrap bg-emerald-700 text-white shadow-none hover:bg-emerald-800"
            disabled={!verifiedCurrentTicket || verifiedCurrentTicket.status !== 'VALID' || verifyMutation.isPending}
            onClick={() => verifyMutation.mutate(true)}
          >
            <CheckCircle className="h-4 w-4" />
            Confirmar entrada
          </Button>
        </div>

        {verifiedCurrentTicket ? (
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
            <p className="font-semibold">{verifiedCurrentTicket.seat ? `${verifiedCurrentTicket.seat.seatLabel} — ${verifiedCurrentTicket.seat.sectionName}` : 'Ingresso sem assento'}</p>
            <p className="mt-1 font-mono text-xs text-slate-600">{verifiedCurrentTicket.ticketCode}</p>
            <p className="mt-2 text-slate-600">Comprador: {verifiedCurrentTicket.order?.buyerName ?? verifiedCurrentTicket.sale?.buyerName ?? 'Não identificado'}</p>
            <p className="text-slate-600">
              Status: {verifiedCurrentTicket.status === 'VALID' ? 'Válido' : verifiedCurrentTicket.status === 'USED' ? 'Utilizado' : verifiedCurrentTicket.status}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Pedidos online</h3>
            <p className="mt-1 text-sm text-slate-500">Pedidos, pagamentos e ingressos vendidos online.</p>
          </div>
        </div>

        <div className="mt-4 grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="relative min-w-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <Input
              aria-label="Buscar pedido"
              value={search}
              onChange={(input) => { setSearch(input.target.value); setPage(1); }}
              placeholder="Buscar comprador, e-mail ou cobrança"
              className="h-10 rounded-lg border-slate-200 bg-white pl-10 text-sm shadow-none placeholder:text-slate-400 focus-visible:border-[#A94DFF] focus-visible:ring-2 focus-visible:ring-[#A94DFF]/30"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
            <SelectTrigger aria-label="Filtrar pedidos por status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              <SelectItem value="PAYMENT_PENDING">Aguardando</SelectItem>
              <SelectItem value="CONFIRMED">Pagamento confirmado</SelectItem>
              <SelectItem value="EXPIRED">Expirados</SelectItem>
              <SelectItem value="CANCELLED">Cancelados</SelectItem>
              <SelectItem value="PARTIALLY_REFUNDED">Estorno parcial</SelectItem>
              <SelectItem value="REFUNDED">Estornados</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 whitespace-nowrap shadow-none"
            onClick={() => ordersQuery.refetch()}
            disabled={ordersQuery.isFetching}
          >
            {ordersQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>

        <div className="mt-4">
          <EventTablePanel>
            <DataTable
              ariaLabel="Pedidos da bilheteria online"
              columns={orderColumns}
              data={orders}
              rowKey={(order) => order.id}
              loading={ordersQuery.isLoading}
              skeletonRows={6}
              tableClassName="min-w-[1100px]"
              emptyMessage={ordersQuery.isError ? (
                <div role="alert" className="px-6 py-12 text-center text-sm text-red-700">
                  Não foi possível carregar os pedidos. Tente atualizar.
                </div>
              ) : (
                <div className="px-6 py-12 text-center text-sm text-gray-500">
                  Nenhum pedido encontrado para estes filtros.
                </div>
              )}
            />
            {ordersQuery.data && ordersQuery.data.total > 0 ? (
              <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
                <Pagination
                  total={ordersQuery.data.total}
                  page={page}
                  pageSize={ordersQuery.data.pageSize}
                  onChange={setPage}
                  hideIfSinglePage={false}
                />
              </div>
            ) : null}
          </EventTablePanel>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(refundTarget)}
        onOpenChange={(open) => { if (!open && !refundMutation.isPending) setRefundTarget(null); }}
        title="Solicitar estorno do pedido?"
        description={refundTarget
          ? `Será solicitado o estorno integral de ${formatCurrency(refundTarget.totalAmount)} para ${refundTarget.buyerName}. O pedido não pode ter ingressos utilizados; o status será atualizado após a confirmação do estorno.`
          : 'O estorno integral será solicitado.'}
        confirmText="Solicitar estorno"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => { if (refundTarget) refundMutation.mutate(refundTarget); }}
        loading={refundMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => { if (!open && !cancelMutation.isPending) setCancelTarget(null); }}
        title="Cancelar pedido?"
        description={cancelTarget
          ? `A cobrança de ${formatCurrency(cancelTarget.totalAmount)} para ${cancelTarget.buyerName} será cancelada. Os assentos só serão liberados após a confirmação do cancelamento.`
          : 'A cobrança será cancelada e os assentos serão liberados após a confirmação.'}
        confirmText="Cancelar pedido"
        cancelText="Voltar"
        variant="destructive"
        onConfirm={() => { if (cancelTarget) cancelMutation.mutate(cancelTarget); }}
        loading={cancelMutation.isPending}
      />

      <Dialog
        open={Boolean(refundedDetailsTarget)}
        onOpenChange={(open) => { if (!open) setRefundedDetailsTarget(null); }}
      >
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="border-b border-slate-200 px-6 pb-4 pt-6 pr-12">
            <DialogTitle className="mt-1 text-base font-semibold tracking-tight text-slate-900">
              Detalhes do estorno
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-600">
              Resumo da operação e do pedido.
            </DialogDescription>
          </DialogHeader>
          {refundedDetailsTarget ? (
            <div className="px-6 py-2">
              <dl className="divide-y divide-dashed divide-slate-200 text-sm">
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Valor estornado</dt>
                  <dd className="text-right font-semibold tabular-nums text-rose-700">
                    {formatCurrency(refundedDetailsTarget.totalAmount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Status</dt>
                  <dd><EventSoftBadge tone="neutral">Estornado</EventSoftBadge></dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Comprador</dt>
                  <dd className="text-right font-medium text-slate-900">{refundedDetailsTarget.buyerName}</dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Email</dt>
                  <dd className="min-w-0 break-all text-right text-slate-700">{refundedDetailsTarget.buyerEmail}</dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Data do estorno</dt>
                  <dd className="text-right font-medium tabular-nums text-slate-900">
                    {refundedDetailsTarget.refundedAt ? formatDate(refundedDetailsTarget.refundedAt) : 'Não informada'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Ingressos cancelados</dt>
                  <dd className="text-right font-medium tabular-nums text-slate-900">
                    {refundedDetailsTarget.seatCount}
                  </dd>
                </div>
              </dl>
              <p className="flex gap-2 border-t border-slate-100 py-3.5 text-xs leading-5 text-slate-500">
                <InfoCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                Os ingressos foram cancelados e não podem ser baixados nem usados para check-in.
              </p>
            </div>
          ) : null}
          <DialogFooter className="flex-row justify-between border-t border-slate-200 px-6 py-4">
            {refundedDetailsTarget ? (
              isSafePaymentUrl(refundedDetailsTarget.invoiceUrl) ? (
                <Button asChild type="button" className="mr-auto bg-brand-accent text-white shadow-none hover:bg-brand-accent/90">
                  <a href={refundedDetailsTarget.invoiceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Abrir cobrança
                  </a>
                </Button>
              ) : (
                <Button asChild type="button" className="mr-auto bg-brand-accent text-white shadow-none hover:bg-brand-accent/90">
                  <Link href={`/charges/event-map-order:${refundedDetailsTarget.id}`}>
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Abrir cobrança
                  </Link>
                </Button>
              )
            ) : null}
            <Button type="button" variant="outline" className="shadow-none" onClick={() => setRefundedDetailsTarget(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(cancelledDetailsTarget)}
        onOpenChange={(open) => { if (!open) setCancelledDetailsTarget(null); }}
      >
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="border-b border-slate-200 px-6 pb-4 pt-6 pr-12">
            <DialogTitle className="mt-1 text-base font-semibold tracking-tight text-slate-900">
              Detalhes do cancelamento
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-600">
              Resumo do pedido cancelado.
            </DialogDescription>
          </DialogHeader>
          {cancelledDetailsTarget ? (
            <div className="px-6 py-2">
              <dl className="divide-y divide-dashed divide-slate-200 text-sm">
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Valor do pedido</dt>
                  <dd className="text-right font-semibold tabular-nums text-slate-900">
                    {formatCurrency(cancelledDetailsTarget.totalAmount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Status</dt>
                  <dd><EventSoftBadge tone="neutral">Cancelado</EventSoftBadge></dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Comprador</dt>
                  <dd className="text-right font-medium text-slate-900">{cancelledDetailsTarget.buyerName}</dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Email</dt>
                  <dd className="min-w-0 break-all text-right text-slate-700">{cancelledDetailsTarget.buyerEmail}</dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Data do cancelamento</dt>
                  <dd className="text-right font-medium tabular-nums text-slate-900">
                    {cancelledDetailsTarget.cancelledAt ? formatDate(cancelledDetailsTarget.cancelledAt) : 'Não informada'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-5 py-3.5">
                  <dt className="shrink-0 text-slate-600">Ingressos / assentos</dt>
                  <dd className="text-right font-medium tabular-nums text-slate-900">
                    {cancelledDetailsTarget.ticketCount} / {cancelledDetailsTarget.seatCount}
                  </dd>
                </div>
              </dl>
              <p className="flex gap-2 border-t border-slate-100 py-3.5 text-xs leading-5 text-slate-500">
                <InfoCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                Este pedido não possui ingressos utilizáveis.
              </p>
            </div>
          ) : null}
          <DialogFooter className="border-t border-slate-200 px-6 py-4">
            <Button type="button" variant="outline" className="shadow-none" onClick={() => setCancelledDetailsTarget(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
