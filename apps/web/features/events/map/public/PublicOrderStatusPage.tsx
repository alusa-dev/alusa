'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Ticket,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import { PublicOrderReservationCountdown } from './PublicOrderReservationCountdown';
import { isTerminalPublicOrderStatus, publicOrderStatusLabel } from './public-order-utils';

type PublicOrderStatus = {
  orderId: string;
  buyerName: string;
  totalAmount: number;
  status: string;
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
  const [isResending, setIsResending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const confirmed = order.status === 'CONFIRMED';
  const terminal = isTerminalPublicOrderStatus(order.status);
  const expiredOrCancelled =
    order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED';

  const statusPageUrl = useMemo(() => {
    if (typeof window === 'undefined') return order.statusUrl ?? null;
    return order.statusUrl ? new URL(order.statusUrl, window.location.origin).toString() : window.location.href;
  }, [order.statusUrl]);

  useEffect(() => {
    if (order.status !== 'PAYMENT_PENDING') return;

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
        if (next.status === 'PAYMENT_PENDING') {
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
  }, [order.orderId, order.status, token]);

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

  async function handleResendEmail() {
    setIsResending(true);
    setError(null);
    try {
      await parseApiResponse(
        await fetch(
          `/api/public/event-map-orders/${order.orderId}/resend-ticket-email?token=${encodeURIComponent(token)}`,
          { method: 'POST' },
        ),
      );
      setActionMessage('E-mail com ingressos reenviado ao comprador.');
    } catch (resendError) {
      setError((resendError as Error).message);
    } finally {
      setIsResending(false);
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
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
      <section className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-accent">Pedido público</p>
            <h1 className="mt-1 text-2xl font-semibold">{order.event.name}</h1>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-600">
              <CalendarDays className="h-4 w-4" />
              {formatDate(order.event.startsAt)}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              confirmed
                ? 'bg-emerald-50 text-emerald-700'
                : expiredOrCancelled
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-amber-50 text-amber-700'
            }`}
          >
            {publicOrderStatusLabel(order.status)}
          </span>
        </div>

        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            {confirmed ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
            ) : expiredOrCancelled ? (
              <CheckCircle2 className="h-5 w-5 text-rose-600" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-amber-700" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {confirmed
                  ? 'Ingressos emitidos'
                  : expiredOrCancelled
                    ? 'Pedido encerrado'
                    : 'Pagamento em processamento'}
              </p>
              <p className="text-xs text-slate-500">
                {confirmed
                  ? 'O pagamento foi confirmado e o PDF está disponível.'
                  : expiredOrCancelled
                    ? 'Este pedido não está mais disponível para pagamento.'
                    : 'Esta página atualiza automaticamente após a confirmação do Asaas.'}
              </p>
              {!confirmed && !expiredOrCancelled && order.expiresAt ? (
                <PublicOrderReservationCountdown
                  expiresAt={order.expiresAt}
                  className="mt-2 text-xs"
                />
              ) : null}
            </div>
          </div>
        </div>

        {!confirmed && !expiredOrCancelled && statusPageUrl ? (
          <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
            <strong>Guarde este link.</strong> Use-o para retornar ao pedido após o pagamento.
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-8"
              onClick={copyStatusLink}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Link copiado' : 'Copiar link do pedido'}
            </Button>
          </div>
        ) : null}

        {pollTimedOut && !terminal ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            A confirmação está demorando. Se você já pagou, use &quot;Já paguei — verificar agora&quot; abaixo.
          </p>
        ) : null}

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {actionMessage ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{actionMessage}</p>
        ) : null}

        <div className="mt-4 space-y-2">
          {order.items.map((item) => (
            <div
              key={`${item.sectionName}-${item.seatLabel}`}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
            >
              <span>
                <strong>{item.seatLabel}</strong>
                <span className="ml-2 text-slate-500">{item.sectionName}</span>
              </span>
              <span className="text-slate-600">{formatCurrency(item.unitPrice)}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-500">Total</span>
          <strong>{formatCurrency(order.totalAmount)}</strong>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {confirmed && order.ticketsUrl ? (
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
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isResending}
                onClick={handleResendEmail}
              >
                {isResending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Reenviar ingressos por e-mail
              </Button>
            </>
          ) : order.invoiceUrl && !expiredOrCancelled ? (
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
