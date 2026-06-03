'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, ExternalLink, Loader2, Ticket } from 'lucide-react';

import { Button } from '@/components/ui/button';

type PublicOrderStatus = {
  orderId: string;
  buyerName: string;
  totalAmount: number;
  status: string;
  paymentStatus: string | null;
  invoiceUrl: string | null;
  expiresAt: string | null;
  ticketsUrl: string | null;
  event: {
    name: string;
    startsAt: string;
    locationName: string | null;
  };
  items: Array<{
    ticketCode: string | null;
    seatLabel: string;
    sectionName: string;
    unitPrice: number;
  }>;
};

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
}: {
  initialOrder: PublicOrderStatus;
  token: string;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (order.status !== 'PAYMENT_PENDING') return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const next = await parseApiResponse<PublicOrderStatus>(
          await fetch(`/api/public/event-map-orders/${order.orderId}/status?token=${encodeURIComponent(token)}`),
        );
        if (cancelled) return;
        setOrder(next);
        setError(null);
        if (next.status === 'PAYMENT_PENDING') timeoutId = setTimeout(poll, 7000);
      } catch (pollError) {
        if (!cancelled) {
          setError((pollError as Error).message);
          timeoutId = setTimeout(poll, 12000);
        }
      }
    }

    timeoutId = setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [order.orderId, order.status, token]);

  const confirmed = order.status === 'CONFIRMED';
  const expiredOrCancelled = order.status === 'EXPIRED' || order.status === 'CANCELLED';

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
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confirmed ? 'bg-emerald-50 text-emerald-700' : expiredOrCancelled ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
            {confirmed ? 'Confirmado' : expiredOrCancelled ? 'Encerrado' : 'Aguardando pagamento'}
          </span>
        </div>

        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            {confirmed ? <CheckCircle2 className="h-5 w-5 text-emerald-700" /> : <Loader2 className="h-5 w-5 animate-spin text-amber-700" />}
            <div>
              <p className="text-sm font-semibold">{confirmed ? 'Ingressos emitidos' : expiredOrCancelled ? 'Pedido encerrado' : 'Pagamento em processamento'}</p>
              <p className="text-xs text-slate-500">
                {confirmed
                  ? 'O pagamento foi confirmado e o PDF está disponível.'
                  : expiredOrCancelled
                    ? 'Este pedido não está mais disponível para pagamento.'
                    : 'Esta página atualiza automaticamente após a confirmação do Asaas.'}
              </p>
            </div>
          </div>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 space-y-2">
          {order.items.map((item) => (
            <div key={`${item.sectionName}-${item.seatLabel}`} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
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

        {confirmed && order.ticketsUrl ? (
          <Button asChild className="mt-5 w-full bg-emerald-700 text-white hover:bg-emerald-800">
            <a href={order.ticketsUrl} target="_blank" rel="noreferrer">
              <Ticket className="h-4 w-4" />
              Baixar ingressos
            </a>
          </Button>
        ) : order.invoiceUrl && !expiredOrCancelled ? (
          <Button asChild className="mt-5 w-full bg-brand-accent text-white hover:bg-brand-accent/90">
            <a href={order.invoiceUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Ir para o pagamento
            </a>
          </Button>
        ) : null}
      </section>
    </main>
  );
}
