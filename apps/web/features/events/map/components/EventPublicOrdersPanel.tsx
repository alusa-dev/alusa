'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { CheckCircle, ExternalLink, Loader2, MoreVertical, QrCode, Refresh as RefreshCw, Search } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import Pagination from '@/components/layout/Pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MAP_FLOATING_SHADOW_CLASS } from './map-toolbar-styles';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { shouldContinueQueryPolling, shouldRefetchQueryOnWindowFocus } from '@/lib/query/query-error-policy';
import { formatPhoneBR, onlyDigits } from '@/lib/formatters';

import type { SchoolEventDTO } from '../../events-service';
import { EventSoftBadge } from '../../shared/EventSoftBadge';
import { EventWhatsAppStatusIndicator } from '../../shared/EventWhatsAppStatusIndicator';
import { EventTablePanel } from '../../shared/EventTablePanel';
import { EventTicketScannerAccesses } from './EventTicketScannerAccesses';
import { canRequestEventRefund } from '../../shared/event-refund-permission';
import { isSafePaymentUrl, publicOrderAdminActions, publicOrderAdminStatusDescription, publicOrderAdminStatusLabel, publicOrderAdminStatusVariant } from './public-order-admin-utils';

type PublicOrderListItem = {
  id: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
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
  whatsappAvailable: boolean;
  whatsappStatus?: string | null;
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

function publicOrderStatusDetails(order: PublicOrderListItem) {
  if (order.status === 'REFUNDED') {
    return 'Os ingressos foram cancelados e não podem ser baixados nem usados para check-in.';
  }
  if (order.status === 'CANCELLED') {
    return 'Este pedido não possui ingressos utilizáveis.';
  }
  if (order.status === 'PARTIALLY_REFUNDED') {
    return 'O pedido registra um estorno parcial.';
  }
  return publicOrderAdminStatusDescription(order);
}

function paymentStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    PENDING: 'Aguardando pagamento',
    PAID: 'Pago',
    RECEIVED: 'Pago',
    CONFIRMED: 'Confirmado',
    RECEIVED_IN_CASH: 'Pago em dinheiro',
    OVERDUE: 'Vencido',
    DELETED: 'Cobrança removida',
    CANCELED: 'Cancelado',
    CANCELLED: 'Cancelado',
    PAYMENT_CREATION_IN_PROGRESS: 'Criação da cobrança em andamento',
    PAYMENT_CREATION_UNKNOWN: 'Resultado da cobrança em verificação',
    REFUND_REQUESTED: 'Estorno solicitado',
    REFUND_IN_PROGRESS: 'Estorno em processamento',
    PAYMENT_REFUND_IN_PROGRESS: 'Estorno em processamento',
    REFUND_DENIED: 'Estorno recusado',
    REFUNDED: 'Estornado',
    PAYMENT_REFUNDED: 'Estornado',
    CHARGEBACK_REQUESTED: 'Contestação solicitada',
    CHARGEBACK_DISPUTE: 'Em disputa',
    IN_DISPUTE: 'Em disputa',
    AWAITING_CHARGEBACK_REVERSAL: 'Aguardando reversão da contestação',
    DISPUTE_LOST: 'Contestação perdida',
    CHARGEBACK: 'Contestação',
    CHARGEBACK_UNKNOWN: 'Contestação em verificação',
    REVERSED: 'Contestação revertida',
    DONE: 'Contestação encerrada',
    REQUESTED: 'Solicitado',
  };
  return status ? labels[status.trim().toUpperCase()] ?? 'Não informado' : 'Não informado';
}

function formatWhatsAppContactPhone(value: string) {
  const digits = onlyDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return `+55 ${formatPhoneBR(digits.slice(2))}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return formatPhoneBR(digits);
  }
  return value;
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
  const router = useRouter();
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
  const [orderDetailsTarget, setOrderDetailsTarget] = useState<PublicOrderListItem | null>(null);
  const orderDetailsScrollRef = useRef<HTMLDivElement>(null);
  const orderDetailsContentRef = useRef<HTMLDivElement>(null);
  const orderDetailsScrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarDragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);
  const [orderDetailsScrollbar, setOrderDetailsScrollbar] = useState({
    thumbHeight: 0,
    thumbOffset: 0,
    scrollTop: 0,
    maxScroll: 0,
  });
  const updateOrderDetailsScrollbar = useCallback(() => {
    const viewport = orderDetailsScrollRef.current;
    if (!viewport) return;

    const { clientHeight, scrollHeight, scrollTop } = viewport;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const thumbHeight = scrollHeight > clientHeight
      ? Math.min(clientHeight, Math.max(28, Math.round((clientHeight * clientHeight / scrollHeight) * 0.68)))
      : clientHeight;
    const thumbRange = Math.max(0, clientHeight - thumbHeight);
    setOrderDetailsScrollbar({
      thumbHeight,
      thumbOffset: maxScroll > 0 ? (scrollTop / maxScroll) * thumbRange : 0,
      scrollTop,
      maxScroll,
    });
  }, []);

  const jumpOrderDetailsScroll = useCallback((clientY: number) => {
    const viewport = orderDetailsScrollRef.current;
    const track = orderDetailsScrollbarRef.current;
    if (!viewport || !track) return;

    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    const trackRange = track.clientHeight - orderDetailsScrollbar.thumbHeight;
    if (maxScroll <= 0 || trackRange <= 0) return;

    const trackTop = track.getBoundingClientRect().top;
    const thumbOffset = Math.min(
      trackRange,
      Math.max(0, clientY - trackTop - orderDetailsScrollbar.thumbHeight / 2),
    );
    viewport.scrollTop = (thumbOffset / trackRange) * maxScroll;
  }, [orderDetailsScrollbar.thumbHeight]);

  const handleOrderDetailsScrollbarPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = orderDetailsScrollRef.current;
    if (!viewport || viewport.scrollHeight <= viewport.clientHeight) return;

    if (event.target === event.currentTarget) {
      jumpOrderDetailsScroll(event.clientY);
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrollbarDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: viewport.scrollTop,
    };
  }, [jumpOrderDetailsScroll]);

  const handleOrderDetailsScrollbarPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = scrollbarDragRef.current;
    const viewport = orderDetailsScrollRef.current;
    const track = orderDetailsScrollbarRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !viewport || !track) return;

    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    const thumbRange = track.clientHeight - orderDetailsScrollbar.thumbHeight;
    if (maxScroll <= 0 || thumbRange <= 0) return;

    const scrollDelta = ((event.clientY - drag.startY) / thumbRange) * maxScroll;
    viewport.scrollTop = Math.min(maxScroll, Math.max(0, drag.startScrollTop + scrollDelta));
  }, [orderDetailsScrollbar.thumbHeight]);

  const handleOrderDetailsScrollbarPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrollbarDragRef.current?.pointerId !== event.pointerId) return;
    scrollbarDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleOrderDetailsScrollbarKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const viewport = orderDetailsScrollRef.current;
    if (!viewport || viewport.scrollHeight <= viewport.clientHeight) return;

    const pageSize = viewport.clientHeight;
    const lineSize = 40;
    switch (event.key) {
      case 'ArrowUp':
        viewport.scrollTop -= lineSize;
        break;
      case 'ArrowDown':
        viewport.scrollTop += lineSize;
        break;
      case 'PageUp':
        viewport.scrollTop -= pageSize;
        break;
      case 'PageDown':
        viewport.scrollTop += pageSize;
        break;
      case 'Home':
        viewport.scrollTop = 0;
        break;
      case 'End':
        viewport.scrollTop = viewport.scrollHeight;
        break;
      default:
        return;
    }
    event.preventDefault();
  }, []);

  useLayoutEffect(() => {
    if (!orderDetailsTarget) return;
    const viewport = orderDetailsScrollRef.current;
    const content = orderDetailsContentRef.current;
    if (!viewport || !content) return;

    updateOrderDetailsScrollbar();
    const observer = new ResizeObserver(updateOrderDetailsScrollbar);
    observer.observe(viewport);
    observer.observe(content);
    window.addEventListener('resize', updateOrderDetailsScrollbar);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateOrderDetailsScrollbar);
    };
  }, [orderDetailsTarget, updateOrderDetailsScrollbar]);

  const ordersQuery = useQuery({
    queryKey: ['events', event.id, 'public-orders', page, search, statusFilter],
    queryFn: async () => {
      const query = new URLSearchParams({ page: String(page), pageSize: '6' });
      if (search.trim()) query.set('search', search.trim());
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      return parseResponse<OrdersResponse>(await fetch(`/api/events/${event.id}/public-orders?${query}`));
    },
    refetchInterval: (query) => shouldContinueQueryPolling(query.state.error) ? 15_000 : false,
    refetchOnWindowFocus: (query) => shouldRefetchQueryOnWindowFocus(query.state.error),
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ code, confirm }: { code: string; confirm: boolean }) =>
      parseResponse<TicketVerifyApiResponse>(
        await fetch(`/api/events/${event.id}/public-orders/verify-ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketCode: code, confirm }),
        }),
      ),
    onSuccess: async (data, variables) => {
      const ticket = extractTicketInfo(data);
      setVerifyResult(ticket);
      if (variables.confirm) {
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

  const resendWhatsAppMutation = useMutation({
    mutationFn: async (order: PublicOrderListItem) => parseResponse<{ queued: boolean; active?: boolean }>(await fetch(
      `/api/events/${event.id}/public-orders/${order.id}/resend-ticket-whatsapp`,
      { method: 'POST' },
    )),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['events', event.id, 'public-orders'] });
      toast.success({
        title: result.active ? 'Envio em andamento' : 'Envio solicitado',
        description: result.active
          ? 'O envio deste ingresso já foi solicitado.'
          : 'Você pode acompanhar o envio na coluna WhatsApp.',
      });
    },
    onError: (error) => toast.error({ title: 'Não foi possível reenviar pelo WhatsApp', description: (error as Error).message }),
  });

  const orders = ordersQuery.data?.items ?? [];
  const verifiedCurrentTicket = verifyResult?.ticketCode === ticketCode.trim().toUpperCase() ? verifyResult : null;
  const orderDetailsTimeline = orderDetailsTarget
    ? [
      { key: 'created', label: 'Pedido criado', at: orderDetailsTarget.createdAt, type: 'event' as const },
      ...(orderDetailsTarget.expiresAt
        ? [{ key: 'expires', label: 'Prazo de pagamento', at: orderDetailsTarget.expiresAt, type: 'deadline' as const }]
        : []),
      ...(orderDetailsTarget.confirmedAt
        ? [{ key: 'confirmed', label: 'Pagamento confirmado', at: orderDetailsTarget.confirmedAt, type: 'event' as const }]
        : []),
      ...(orderDetailsTarget.paidAt
        ? [{ key: 'paid', label: 'Pagamento realizado', at: orderDetailsTarget.paidAt, type: 'event' as const }]
        : []),
      ...(orderDetailsTarget.refundedAt
        ? [{ key: 'refunded', label: 'Estorno registrado', at: orderDetailsTarget.refundedAt, type: 'event' as const }]
        : []),
      ...(orderDetailsTarget.cancelledAt
        ? [{ key: 'cancelled', label: 'Pedido cancelado', at: orderDetailsTarget.cancelledAt, type: 'event' as const }]
        : []),
    ].sort((first, second) => new Date(first.at).getTime() - new Date(second.at).getTime())
    : [];
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
      id: 'total',
      header: 'Total',
      width: 'w-[11%]',
      align: 'right',
      render: (order) => formatCurrency(order.totalAmount),
    },
    {
      id: 'tickets',
      header: 'Qtd.',
      width: 'w-[10%]',
      align: 'right',
      render: (order) => <span className="tabular-nums text-slate-600">{order.seatCount}</span>,
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
      id: 'whatsapp',
      header: 'WhatsApp',
      width: 'w-[12%]',
      align: 'center',
      render: (order) => (
        <EventWhatsAppStatusIndicator status={order.whatsappStatus} />
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
        const { invoiceUrl, canDownloadTickets, canRefund, canCancel } = publicOrderAdminActions(order, mayRequestRefund);
        const canResendWhatsApp = order.status === 'CONFIRMED' && order.ticketFulfillmentStatus === 'ISSUED' && order.ticketCount > 0 && order.whatsappAvailable;

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
              <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
                <DropdownMenuItem className="whitespace-nowrap" onSelect={() => setOrderDetailsTarget(order)}>
                  Ver detalhes do pedido
                </DropdownMenuItem>
                {order.asaasPaymentId ? (
                  <DropdownMenuItem asChild className="whitespace-nowrap">
                    <Link href={`/charges/event-map-order:${order.id}`}>Ver cobrança</Link>
                  </DropdownMenuItem>
                ) : null}
                {invoiceUrl ? (
                  <DropdownMenuItem asChild className="whitespace-nowrap">
                    <a href={invoiceUrl} target="_blank" rel="noreferrer">Abrir cobrança</a>
                  </DropdownMenuItem>
                ) : null}
                {canDownloadTickets ? (
                  <DropdownMenuItem asChild className="whitespace-nowrap">
                    <a href={`/api/events/public-orders/${order.id}/tickets`} target="_blank" rel="noreferrer">
                      Ver ticket
                    </a>
                  </DropdownMenuItem>
                ) : null}
                {canResendWhatsApp ? (
                  <DropdownMenuItem className="whitespace-nowrap" disabled={resendWhatsAppMutation.isPending} onSelect={() => resendWhatsAppMutation.mutate(order)}>
                    Reenviar ingresso pelo WhatsApp
                  </DropdownMenuItem>
                ) : null}
                {canRefund || canCancel ? <DropdownMenuSeparator /> : null}
                {canRefund ? (
                  <DropdownMenuItem
                    className="whitespace-nowrap text-rose-700 focus:bg-rose-50 focus:text-rose-700"
                    onSelect={() => setRefundTarget(order)}
                  >
                    Estornar pagamento
                  </DropdownMenuItem>
                ) : null}
                {canCancel ? (
                  <DropdownMenuItem className="whitespace-nowrap text-rose-700 focus:bg-rose-50 focus:text-rose-700" onSelect={() => setCancelTarget(order)}>
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
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-none">
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
            disabled={verifyMutation.isPending}
            onClick={() => router.push(`/events/${event.id}/check-in/scan`)}
          >
            <QrCode className="h-4 w-4" />
            Ler QR Code
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 whitespace-nowrap shadow-none"
            disabled={!ticketCode.trim() || verifyMutation.isPending}
            onClick={() => verifyMutation.mutate({ code: ticketCode, confirm: false })}
          >
            <Search className="h-4 w-4" />
            Verificar
          </Button>
          <Button
            type="button"
            className="h-10 whitespace-nowrap bg-emerald-700 text-white shadow-none hover:bg-emerald-800"
            disabled={!verifiedCurrentTicket || verifiedCurrentTicket.status !== 'VALID' || verifyMutation.isPending}
            onClick={() => verifyMutation.mutate({ code: ticketCode, confirm: true })}
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

      <EventTicketScannerAccesses event={event} />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-none">
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
        title={cancelTarget?.paymentStatus === 'DELETED' ? 'Finalizar cancelamento?' : 'Cancelar pedido?'}
        description={cancelTarget
          ? cancelTarget.paymentStatus === 'DELETED'
            ? `A cobrança de ${formatCurrency(cancelTarget.totalAmount)} para ${cancelTarget.buyerName} já foi removida. Esta ação finalizará o cancelamento local do pedido e liberará os assentos.`
            : `A cobrança de ${formatCurrency(cancelTarget.totalAmount)} para ${cancelTarget.buyerName} será cancelada. Os assentos só serão liberados após a confirmação do cancelamento.`
          : 'A cobrança será cancelada e os assentos serão liberados após a confirmação.'}
        confirmText={cancelTarget?.paymentStatus === 'DELETED' ? 'Finalizar cancelamento' : 'Cancelar pedido'}
        cancelText="Voltar"
        variant="destructive"
        onConfirm={() => { if (cancelTarget) cancelMutation.mutate(cancelTarget); }}
        loading={cancelMutation.isPending}
      />

      <Dialog
        open={Boolean(orderDetailsTarget)}
        onOpenChange={(open) => { if (!open) setOrderDetailsTarget(null); }}
      >
        <DialogContent className={`grid max-h-[90vh] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 ${MAP_FLOATING_SHADOW_CLASS}`}>
          <DialogHeader className="shrink-0 border-b border-slate-200 px-6 pb-4 pt-6 pr-12">
            <DialogTitle className="mt-1 text-base font-semibold tracking-tight text-slate-900">
              Detalhes do pedido
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-600">
              Informações disponíveis sobre o pedido, pagamento e ingressos.
            </DialogDescription>
          </DialogHeader>
          {orderDetailsTarget ? (
            <div className="relative min-h-0 overflow-hidden">
              <div
                ref={orderDetailsScrollRef}
                id="event-public-order-details-scroll"
                onScroll={updateOrderDetailsScrollbar}
                className="h-full max-h-full min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div ref={orderDetailsContentRef} className="px-6 py-2 pr-10">
                  <dl className="divide-y divide-dashed divide-slate-200 text-sm">
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Comprador</dt>
                      <dd className="text-right font-medium text-slate-900">{orderDetailsTarget.buyerName}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">E-mail</dt>
                      <dd className="min-w-0 break-all text-right text-slate-700">{orderDetailsTarget.buyerEmail}</dd>
                    </div>
                    {orderDetailsTarget.buyerPhone ? (
                      <div className="flex items-center justify-between gap-5 py-3">
                        <dt className="shrink-0 text-slate-600">Contato do WhatsApp</dt>
                        <dd className="text-right font-medium tabular-nums text-slate-900">
                          {formatWhatsAppContactPhone(orderDetailsTarget.buyerPhone)}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Mapa / lote</dt>
                      <dd className="text-right text-slate-900">
                        <span className="block font-medium">{orderDetailsTarget.map.name}</span>
                        <span className="block text-xs text-slate-600">
                          {orderDetailsTarget.lotNames.length ? orderDetailsTarget.lotNames.join(' · ') : 'Sem lote'}
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Total do pedido</dt>
                      <dd className="text-right font-semibold tabular-nums text-slate-900">
                        {formatCurrency(orderDetailsTarget.totalAmount)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Status</dt>
                      <dd>
                        <EventSoftBadge tone={publicOrderAdminStatusVariant(orderDetailsTarget)}>
                          {publicOrderAdminStatusLabel(orderDetailsTarget)}
                        </EventSoftBadge>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Forma de pagamento</dt>
                      <dd className="text-right text-slate-900">
                        {orderDetailsTarget.paymentMethod === 'PIX'
                          ? 'Pix'
                          : orderDetailsTarget.paymentMethod === 'BOLETO'
                            ? 'Boleto'
                            : orderDetailsTarget.paymentMethod === 'CREDIT_CARD'
                              ? 'Cartão'
                              : '—'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Status do pagamento</dt>
                      <dd className="text-right text-slate-900">{paymentStatusLabel(orderDetailsTarget.paymentStatus)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Ingressos / assentos</dt>
                      <dd className="text-right tabular-nums text-slate-900">
                        {orderDetailsTarget.ticketCount} / {orderDetailsTarget.seatCount}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Ingressos utilizados</dt>
                      <dd className="text-right tabular-nums text-slate-900">{orderDetailsTarget.ticketsUsed}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Envio pelo WhatsApp</dt>
                      <dd>
                        <EventWhatsAppStatusIndicator status={orderDetailsTarget.whatsappStatus} />
                      </dd>
                    </div>
                  </dl>
                  <section className="border-t border-slate-100 py-4" aria-label="Linha do tempo do pedido">
                    <h3 className="text-sm font-semibold text-slate-800">Linha do tempo</h3>
                    <ol className="relative ml-1 mt-3 space-y-0 before:absolute before:bottom-2 before:left-[4.5px] before:top-2 before:w-px before:bg-slate-200">
                      {orderDetailsTimeline.map((entry) => {
                        const isFutureDeadline = entry.type === 'deadline' && new Date(entry.at).getTime() > Date.now();
                        return (
                          <li key={entry.key} className="relative flex gap-3 pb-3 last:pb-0">
                            <span
                              aria-hidden="true"
                              className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                                entry.type === 'deadline'
                                  ? 'border border-amber-500 bg-white'
                                  : 'bg-slate-400'
                              }`}
                            />
                            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                              <span className={`text-sm ${entry.type === 'deadline' ? 'text-amber-800' : 'text-slate-700'}`}>
                                {entry.label}
                                {isFutureDeadline ? (
                                  <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                    Prazo futuro
                                  </span>
                                ) : null}
                              </span>
                              <time dateTime={entry.at} className="shrink-0 text-xs tabular-nums text-slate-500">
                                {formatDate(entry.at)}
                              </time>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                  <p className="flex gap-2 border-t border-slate-100 py-3.5 text-xs leading-5 text-slate-600">
                    <span className="font-semibold text-slate-700">{publicOrderAdminStatusLabel(orderDetailsTarget)}:</span>
                    <span>{publicOrderStatusDetails(orderDetailsTarget)}</span>
                  </p>
                </div>
              </div>
              <div
                ref={orderDetailsScrollbarRef}
                role="scrollbar"
                tabIndex={0}
                aria-label="Rolar detalhes do pedido"
                aria-controls="event-public-order-details-scroll"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={Math.round(orderDetailsScrollbar.maxScroll)}
                aria-valuenow={Math.round(orderDetailsScrollbar.scrollTop)}
                onKeyDown={handleOrderDetailsScrollbarKeyDown}
                onPointerDown={handleOrderDetailsScrollbarPointerDown}
                onPointerMove={handleOrderDetailsScrollbarPointerMove}
                onPointerUp={handleOrderDetailsScrollbarPointerEnd}
                onPointerCancel={handleOrderDetailsScrollbarPointerEnd}
                onLostPointerCapture={handleOrderDetailsScrollbarPointerEnd}
                className="absolute inset-y-0 right-1 w-4 touch-none cursor-default select-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[5px] w-[6px] rounded-full bg-transparent" />
                <div
                  aria-hidden="true"
                  className="absolute right-[5px] w-[6px] rounded-full bg-[#d1d5db] transition-[height,transform] duration-75"
                  style={{
                    height: `${orderDetailsScrollbar.thumbHeight}px`,
                    transform: `translateY(${orderDetailsScrollbar.thumbOffset}px)`,
                  }}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="shrink-0 border-t border-slate-200 px-6 py-4">
            {orderDetailsTarget?.status === 'REFUNDED' ? (
              isSafePaymentUrl(orderDetailsTarget.invoiceUrl) ? (
                <Button asChild type="button" className="mr-auto bg-brand-accent text-white shadow-none hover:bg-brand-accent/90">
                  <a href={orderDetailsTarget.invoiceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Abrir cobrança
                  </a>
                </Button>
              ) : (
                <Button asChild type="button" className="mr-auto bg-brand-accent text-white shadow-none hover:bg-brand-accent/90">
                  <Link href={`/charges/event-map-order:${orderDetailsTarget.id}`}>
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Abrir cobrança
                  </Link>
                </Button>
              )
            ) : null}
            <Button type="button" variant="outline" className="shadow-none" onClick={() => setOrderDetailsTarget(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
