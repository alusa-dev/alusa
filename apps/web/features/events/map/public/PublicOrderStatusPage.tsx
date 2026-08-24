'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Ticket,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';

import { PublicOrderReservationCountdown } from './PublicOrderReservationCountdown';
import { isTerminalPublicOrderStatus } from './public-order-utils';

type PublicOrderStatus = {
  orderId: string;
  buyerName: string;
  totalAmount: number;
  status: string;
  ticketFulfillmentStatus: 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
  ticketFulfillmentLastError?: string | null;
  paymentStatus: string | null;
  invoiceUrl: string | null;
  expiresAt: string | null;
  ticketsUrl: string | null;
  ticketsHtmlUrl?: string | null;
  statusUrl?: string | null;
  event: {
    name: string;
    startsAt: string;
    locationName: string | null;
  };
  map?: { publicSlug: string | null };
  items: Array<{
    ticketCode: string | null;
    seatLabel: string;
    sectionName: string;
    unitPrice: number;
  }>;
};

const POLL_INTERVAL_MS = 7000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message ?? 'Não foi possível carregar o pedido.';
    throw new Error(message);
  }
  return (json as { data?: T })?.data ?? (json as T);
}

export function PublicOrderStatusPage({
  initialOrder,
  token,
  publicSlug,
}: {
  initialOrder: PublicOrderStatus;
  token: string;
  publicSlug?: string;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const confirmed = order.status === 'CONFIRMED';
  const ticketsIssued = confirmed && order.ticketFulfillmentStatus === 'ISSUED' && Boolean(order.ticketsUrl);
  const ticketFulfillmentNeedsReconciliation =
    confirmed && order.ticketFulfillmentStatus === 'REQUIRES_RECONCILIATION';
  const ticketFulfillmentPending = confirmed && !ticketsIssued && !ticketFulfillmentNeedsReconciliation;
  const terminal = isTerminalPublicOrderStatus(order.status);
  const expiredOrCancelled =
    order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED';

  const statusPageUrl = useMemo(() => {
    if (typeof window === 'undefined') return order.statusUrl ?? null;
    return order.statusUrl ? new URL(order.statusUrl, window.location.origin).toString() : window.location.href;
  }, [order.statusUrl]);

  useEffect(() => {
    if (order.status !== 'PAYMENT_PENDING' && !ticketFulfillmentPending) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function poll() {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (!cancelled) setPollTimedOut(true);
        return;
      }

      try {
        const next = await parseApiResponse<PublicOrderStatus>(
          await fetch(`/api/public/event-map-orders/${order.orderId}/status?token=${encodeURIComponent(token)}`),
        );
        if (cancelled) return;
        setOrder(next);
        setError(null);
        if (next.status === 'PAYMENT_PENDING' || (next.status === 'CONFIRMED' && next.ticketFulfillmentStatus !== 'ISSUED')) {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError((pollError as Error).message);
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS + 5000);
        }
      }
    }

    timeoutId = setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [order.orderId, order.status, order.ticketFulfillmentStatus, ticketFulfillmentPending, token]);

  async function handleSyncPayment() {
    setIsSyncing(true);
    setActionMessage(null);
    setError(null);
    try {
      const result = await parseApiResponse<{
        synced: boolean;
        paymentStatus?: string;
        order: PublicOrderStatus;
      }>(
        await fetch(
          `/api/public/event-map-orders/${order.orderId}/sync-payment?token=${encodeURIComponent(token)}`,
          { method: 'POST' },
        ),
      );
      setOrder(result.order);
      setActionMessage(
        result.synced
          ? 'Pagamento confirmado. Seus ingressos estão disponíveis.'
          : 'Pagamento ainda não consta como confirmado no Asaas.',
      );
    } catch (syncError) {
      setError((syncError as Error).message);
    } finally {
      setIsSyncing(false);
    }
  }

  function copyStatusLink() {
    if (!statusPageUrl) return;
    navigator.clipboard.writeText(statusPageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const mapSlug = publicSlug ?? order.map?.publicSlug ?? null;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-950 sm:py-12">
      <section className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="border-b border-slate-100 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-accent">Pedido público</p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-[1.7rem]">{order.event.name}</h1>
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600">
              <CalendarDays className="h-4 w-4" />
              {formatDate(order.event.startsAt)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <InfoCallout
            variant={confirmed ? 'brand' : expiredOrCancelled ? 'warning' : 'info'}
            size="sm"
            title={
              ticketsIssued
                ? 'Ingressos emitidos'
                : ticketFulfillmentNeedsReconciliation
                  ? 'Pagamento confirmado; emissão em análise'
                : ticketFulfillmentPending
                  ? 'Pagamento confirmado; preparando ingressos'
                  : expiredOrCancelled
                    ? 'Pedido encerrado'
                    : 'Pagamento em processamento'
            }
            showIcon
          >
            <p>
              {ticketsIssued
                ? 'O pagamento foi confirmado e o PDF está disponível.'
                : ticketFulfillmentNeedsReconciliation
                  ? 'O pagamento foi confirmado, mas a emissão precisa de uma reconciliação automática. Não é necessário realizar uma nova compra.'
                : ticketFulfillmentPending
                  ? 'A emissão dos ingressos está sendo processada automaticamente. Esta página será atualizada quando estiver concluída.'
                : expiredOrCancelled
                  ? 'Este pedido não está mais disponível para pagamento.'
                  : 'Esta página atualiza automaticamente após a confirmação do Asaas.'}
            </p>
            {!confirmed && !expiredOrCancelled && order.expiresAt ? (
              <PublicOrderReservationCountdown expiresAt={order.expiresAt} className="mt-2 text-xs" />
            ) : null}
          </InfoCallout>
        </div>

        {!confirmed && !expiredOrCancelled && statusPageUrl ? (
          <InfoCallout variant="warning" size="sm" className="mt-3" title="Guarde este link">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Use-o para retornar ao pedido após o pagamento.</span>
              <Button type="button" variant="outline" size="sm" className="shrink-0 self-start" onClick={copyStatusLink}>
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Link copiado' : 'Copiar link do pedido'}
              </Button>
            </div>
          </InfoCallout>
        ) : null}

        {pollTimedOut && !terminal ? (
          <InfoCallout variant="info" size="sm" className="mt-3">
            A confirmação está demorando. Se você já pagou, use &quot;Já paguei — verificar agora&quot; abaixo.
          </InfoCallout>
        ) : null}

        {error ? (
          <InfoCallout variant="warning" size="sm" className="mt-3">
            <InfoCalloutItem label="Não foi possível concluir" labelTone="danger">
              {error}
            </InfoCalloutItem>
          </InfoCallout>
        ) : null}
        {actionMessage ? (
          <InfoCallout variant="brand" size="sm" className="mt-3">
            {actionMessage}
          </InfoCallout>
        ) : null}

        <div className="mt-6 space-y-2">
          {order.items.map((item) => (
            <div
              key={`${item.sectionName}-${item.seatLabel}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm"
            >
              <span>
                <strong>{item.seatLabel}</strong>
                <span className="ml-2 text-slate-500">{item.sectionName}</span>
              </span>
              <span className="text-slate-600">{formatCurrency(item.unitPrice)}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-500">Total</span>
          <strong>{formatCurrency(order.totalAmount)}</strong>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          {ticketsIssued && order.ticketsUrl ? (
            <>
              <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800">
                <a href={order.ticketsUrl} target="_blank" rel="noreferrer">
                  <Ticket className="h-4 w-4" />
                  Baixar ingressos (PDF)
                </a>
              </Button>
              {order.ticketsHtmlUrl ? (
                <Button asChild variant="outline" className="w-full">
                  <a href={order.ticketsHtmlUrl} target="_blank" rel="noreferrer">
                    Ver ingressos online
                  </a>
                </Button>
              ) : null}
            </>
          ) : order.status === 'PAYMENT_PENDING' && order.invoiceUrl && !expiredOrCancelled ? (
            <>
              <Button asChild className="w-full bg-brand-accent text-white hover:bg-brand-accent/90">
                <a href={order.invoiceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Ir para o pagamento
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isSyncing}
                onClick={handleSyncPayment}
              >
                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Já paguei — verificar agora
              </Button>
            </>
          ) : null}

          {mapSlug ? (
            <Button asChild variant="outline" className="w-full">
              <a href={`/m/${mapSlug}`}>Voltar ao mapa</a>
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
