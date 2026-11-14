'use client';

import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { ExternalLink } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatPhoneBR, onlyDigits } from '@/lib/formatters';
import { EventSoftBadge } from '../../shared/EventSoftBadge';
import { EventWhatsAppStatusIndicator } from '../../shared/EventWhatsAppStatusIndicator';
import { MAP_FLOATING_SHADOW_CLASS } from './map-toolbar-styles';
import { isSafePaymentUrl, publicOrderAdminStatusDescription, publicOrderAdminStatusLabel, publicOrderAdminStatusVariant } from './public-order-admin-utils';
import type { EventPublicMapOrderDTO, TicketSaleDTO } from '../../events-service';
import { EXTENDED_TICKET_SALE_STATUS_LABELS, getTicketPaymentMethodLabel, getTicketSaleFinancialSummary, getTicketSaleTone } from '../../tickets/ticket-sale-ui';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function publicOrderStatusDetails(order: EventPublicMapOrderDTO) {
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



export function EventPublicOrderDetailsDialog({
  order,
  sale,
  open,
  loading = false,
  error = null,
  onOpenChange,
}: {
  order: EventPublicMapOrderDTO | null;
  sale?: TicketSaleDTO | null;
  open: boolean;
  loading?: boolean;
  error?: string | null;
  onOpenChange: (_open: boolean) => void;
}) {
  const orderDetailsTarget = order;
  const scrollContentId = useId();
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
    if (!open || (!orderDetailsTarget && !sale)) return;
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
  }, [open, orderDetailsTarget, sale, updateOrderDetailsScrollbar]);

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

  const saleSummary = sale ? getTicketSaleFinancialSummary(sale) : null;
  const display = order ? {
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    buyerPhone: order.buyerPhone,
    mapName: order.map.name,
    lotNames: order.lotNames,
    totalAmount: order.totalAmount,
    statusLabel: publicOrderAdminStatusLabel(order),
    statusTone: publicOrderAdminStatusVariant(order),
    statusDescription: publicOrderStatusDetails(order),
    paymentMethod: order.paymentMethod === 'PIX' ? 'Pix' : order.paymentMethod === 'BOLETO' ? 'Boleto' : order.paymentMethod === 'CREDIT_CARD' ? 'Cartão' : '—',
    paymentStatus: paymentStatusLabel(order.paymentStatus),
    ticketCount: order.ticketCount,
    ticketQuantity: undefined,
    seatCount: order.seatCount,
    seats: order.seats?.map((seat) => `${seat.sectionName} · ${seat.seatLabel}`) ?? [],
    ticketsUsed: order.ticketsUsed,
    whatsappStatus: order.whatsappStatus,
    timeline: orderDetailsTimeline,
  } : sale ? {
    buyerName: sale.buyerName,
    buyerEmail: null,
    buyerPhone: null,
    mapName: sale.sessionName ?? '—',
    lotNames: [sale.lot.name],
    totalAmount: sale.totalAmount,
    statusLabel: saleSummary?.label ?? EXTENDED_TICKET_SALE_STATUS_LABELS[sale.status],
    statusTone: saleSummary?.tone ?? getTicketSaleTone(sale.status),
    statusDescription: saleSummary?.label ?? EXTENDED_TICKET_SALE_STATUS_LABELS[sale.status],
    paymentMethod: getTicketPaymentMethodLabel(sale),
    paymentStatus: sale.paymentStatus ? paymentStatusLabel(sale.paymentStatus) : '—',
    ticketQuantity: sale.quantity,
    seatCount: sale.seats?.length,
    seats: sale.seats?.map((seat) => `${seat.sectionName} · ${seat.seatLabel}`) ?? [],
    ticketsUsed: undefined,
    whatsappStatus: sale.whatsappStatus,
    timeline: [
      { key: 'created', label: 'Venda registrada', at: sale.createdAt ?? sale.soldAt, type: 'event' as const },
      ...(sale.reservationExpiresAt ? [{ key: 'expires', label: 'Prazo da reserva', at: sale.reservationExpiresAt, type: 'deadline' as const }] : []),
      ...(sale.paidAt ? [{ key: 'paid', label: 'Pagamento realizado', at: sale.paidAt, type: 'event' as const }] : []),
      ...(sale.refundedAt ? [{ key: 'refunded', label: 'Estorno registrado', at: sale.refundedAt, type: 'event' as const }] : []),
      ...(sale.cancelledAt ? [{ key: 'cancelled', label: 'Venda cancelada', at: sale.cancelledAt, type: 'event' as const }] : []),
    ],
  } : null;

  return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
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
          {display ? (
            <div className="relative min-h-0 overflow-hidden">
              <div
                ref={orderDetailsScrollRef}
                id={scrollContentId}
                onScroll={updateOrderDetailsScrollbar}
                className="h-full max-h-full min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div ref={orderDetailsContentRef} className="px-6 py-2 pr-10">
                  <dl className="divide-y divide-dashed divide-slate-200 text-sm">
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Comprador</dt>
                      <dd className="break-words text-right font-medium text-slate-900">{display.buyerName}</dd>
                    </div>
                    {display.buyerEmail ? <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">E-mail</dt>
                      <dd className="min-w-0 break-all text-right text-slate-700">{display.buyerEmail}</dd>
                    </div> : null}
                    {display.buyerPhone ? (
                      <div className="flex items-center justify-between gap-5 py-3">
                        <dt className="shrink-0 text-slate-600">Contato do WhatsApp</dt>
                        <dd className="text-right font-medium tabular-nums text-slate-900">
                          {formatWhatsAppContactPhone(display.buyerPhone)}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Mapa / lote</dt>
                      <dd className="text-right text-slate-900">
                        <span className="block font-medium">{display.mapName}</span>
                        <span className="block text-xs text-slate-600">
                          {display.lotNames.length ? display.lotNames.join(' · ') : 'Sem lote'}
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Total do pedido</dt>
                      <dd className="text-right font-semibold tabular-nums text-slate-900">
                        {formatCurrency(display.totalAmount)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Status</dt>
                      <dd>
                        <EventSoftBadge tone={display.statusTone}>
                          {display.statusLabel}
                        </EventSoftBadge>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Forma de pagamento</dt>
                      <dd className="text-right text-slate-900">
                        {display.paymentMethod}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Status do pagamento</dt>
                      <dd className="text-right text-slate-900">{display.paymentStatus}</dd>
                    </div>
                    {order ? (
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Ingressos / assentos</dt>
                      <dd className="text-right tabular-nums text-slate-900">
                        {display.ticketCount} / {display.seatCount}
                      </dd>
                    </div>
                    ) : <div className="flex items-center justify-between gap-5 py-3"><dt className="shrink-0 text-slate-600">Quantidade</dt><dd className="text-right tabular-nums text-slate-900">{display.ticketQuantity}</dd></div>}
                    {display.seats.length ? (
                      <div className="flex items-start justify-between gap-5 py-3">
                        <dt className="shrink-0 text-slate-600">Assentos</dt>
                        <dd className="break-words text-right text-slate-900">
                          {display.seats.join(', ')}
                        </dd>
                      </div>
                    ) : null}
                    {display.ticketsUsed !== undefined ? (
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Ingressos utilizados</dt>
                      <dd className="text-right tabular-nums text-slate-900">{display.ticketsUsed}</dd>
                    </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-5 py-3">
                      <dt className="shrink-0 text-slate-600">Envio pelo WhatsApp</dt>
                      <dd>
                        <EventWhatsAppStatusIndicator status={display.whatsappStatus} />
                      </dd>
                    </div>
                  </dl>
                  <section className="border-t border-slate-100 py-4" aria-label="Linha do tempo do pedido">
                    <h3 className="text-sm font-semibold text-slate-800">Linha do tempo</h3>
                    <ol className="relative ml-1 mt-3 space-y-0 before:absolute before:bottom-2 before:left-[4.5px] before:top-2 before:w-px before:bg-slate-200">
                      {display.timeline.map((entry) => {
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
                    <span className="font-semibold text-slate-700">{display.statusLabel}:</span>
                    <span>{display.statusDescription}</span>
                  </p>
                </div>
              </div>
              <div
                ref={orderDetailsScrollbarRef}
                role="scrollbar"
                tabIndex={0}
                aria-label="Rolar detalhes do pedido"
                aria-controls={scrollContentId}
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
          ) : loading || error ? (
            <div className="flex min-h-0 items-center justify-center px-6 py-10 text-center text-sm text-slate-600">
              {loading ? 'Carregando detalhes do pedido…' : error}
            </div>
          ) : null}
          <DialogFooter className="shrink-0 border-t border-slate-200 px-6 py-4">
            {order?.status === 'REFUNDED' ? (
              isSafePaymentUrl(order.invoiceUrl) ? (
                <Button asChild type="button" className="mr-auto bg-brand-accent text-white shadow-none hover:bg-brand-accent/90">
                  <a href={order.invoiceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Abrir cobrança
                  </a>
                </Button>
              ) : (
                <Button asChild type="button" className="mr-auto bg-brand-accent text-white shadow-none hover:bg-brand-accent/90">
                  <Link href={`/charges/event-map-order:${order.id}`}>
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Abrir cobrança
                  </Link>
                </Button>
              )
            ) : sale?.status === 'REFUNDED' && sale.chargeDetailUrl ? (
              <Button asChild type="button" className="mr-auto bg-brand-accent text-white shadow-none hover:bg-brand-accent/90">
                <Link href={sale.chargeDetailUrl}><ExternalLink aria-hidden="true" className="h-4 w-4" /> Abrir cobrança</Link>
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="shadow-none" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
