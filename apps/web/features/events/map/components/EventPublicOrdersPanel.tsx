'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Mail, RefreshCw, Search, Ticket } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

import type { SchoolEventDTO } from '../../events-service';
import { publicOrderStatusLabel } from '../public/public-order-utils';

type PublicOrderListItem = {
  id: string;
  buyerName: string;
  buyerEmail: string;
  totalAmount: number;
  status: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
  asaasPaymentId: string | null;
  createdAt: string;
  expiresAt: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  seatCount: number;
  ticketCount: number;
  ticketsUsed: number;
};

type TicketInfo = {
  ticketCode: string;
  status: string;
  usedAt: string | null;
  order: { id: string; buyerName: string; status: string };
  seat: { sectionName: string; seatLabel: string; technicalCode: string };
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

function statusVariant(status: string) {
  if (status === 'CONFIRMED') return 'success' as const;
  if (status === 'PAYMENT_PENDING') return 'warning' as const;
  return 'neutral' as const;
}

export function EventPublicOrdersPanel({ event }: { event: SchoolEventDTO }) {
  const queryClient = useQueryClient();
  const [ticketCode, setTicketCode] = useState('');
  const [verifyResult, setVerifyResult] = useState<TicketInfo | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['events', event.id, 'public-orders'],
    queryFn: async () =>
      parseResponse<PublicOrderListItem[]>(await fetch(`/api/events/${event.id}/public-orders`)),
  });

  const reconcileMutation = useMutation({
    mutationFn: async (orderId: string) =>
      parseResponse(
        await fetch(`/api/events/${event.id}/public-orders/${orderId}/reconcile-payment`, { method: 'POST' }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events', event.id, 'public-orders'] });
      toast.success({ title: 'Reconciliação iniciada', description: 'O pedido foi verificado no Asaas.' });
    },
    onError: (error) => toast.error({ title: 'Falha na reconciliação', description: (error as Error).message }),
  });

  const resendMutation = useMutation({
    mutationFn: async (orderId: string) =>
      parseResponse(
        await fetch(`/api/events/${event.id}/public-orders/${orderId}/resend-ticket-email`, { method: 'POST' }),
      ),
    onSuccess: () => toast.success({ title: 'E-mail reenviado', description: 'Os ingressos foram enviados ao comprador.' }),
    onError: (error) => toast.error({ title: 'Falha no reenvio', description: (error as Error).message }),
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
          description: `${ticket.seat.seatLabel} — ${ticket.seat.sectionName}`,
        });
      }
    },
    onError: (error) => toast.error({ title: 'Ingresso inválido', description: (error as Error).message }),
  });

  const orders = ordersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Check-in por código</h3>
        <p className="mt-1 text-sm text-slate-500">Valide ingressos do mapa público na entrada do evento.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="ticket-code-check-in">Código do ingresso</Label>
            <Input
              id="ticket-code-check-in"
              value={ticketCode}
              onChange={(eventInput) => setTicketCode(eventInput.target.value.toUpperCase())}
              placeholder="TICKET_..."
              className="font-mono uppercase"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!ticketCode.trim() || verifyMutation.isPending}
            onClick={() => verifyMutation.mutate(false)}
          >
            <Search className="h-4 w-4" />
            Verificar
          </Button>
          <Button
            type="button"
            className="bg-emerald-700 text-white hover:bg-emerald-800"
            disabled={!ticketCode.trim() || verifyMutation.isPending}
            onClick={() => verifyMutation.mutate(true)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Confirmar entrada
          </Button>
        </div>

        {verifyResult ? (
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
            <p className="font-semibold">{verifyResult.seat.seatLabel} — {verifyResult.seat.sectionName}</p>
            <p className="mt-1 font-mono text-xs text-slate-600">{verifyResult.ticketCode}</p>
            <p className="mt-2 text-slate-600">Comprador: {verifyResult.order.buyerName}</p>
            <p className="text-slate-600">
              Status: {verifyResult.status === 'VALID' ? 'Válido' : verifyResult.status === 'USED' ? 'Utilizado' : verifyResult.status}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Pedidos do mapa público</h3>
            <p className="mt-1 text-sm text-slate-500">Vendas online com assentos numerados.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => ordersQuery.refetch()}
            disabled={ordersQuery.isFetching}
          >
            {ordersQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>

        {ordersQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Carregando pedidos...</p>
        ) : orders.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Nenhum pedido público registrado.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="py-2 pr-3">Comprador</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Ingressos</th>
                  <th className="py-2 pr-3">Criado</th>
                  <th className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-slate-50">
                    <td className="py-3 pr-3">
                      <strong className="block text-slate-900">{order.buyerName}</strong>
                      <span className="text-xs text-slate-500">{order.buyerEmail}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant={statusVariant(order.status)}>{publicOrderStatusLabel(order.status)}</Badge>
                    </td>
                    <td className="py-3 pr-3">{formatCurrency(order.totalAmount)}</td>
                    <td className="py-3 pr-3 text-slate-600">
                      {order.ticketCount}/{order.seatCount}
                      {order.ticketsUsed > 0 ? ` · ${order.ticketsUsed} usados` : ''}
                    </td>
                    <td className="py-3 pr-3 text-slate-600">{formatDate(order.createdAt)}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        {order.status === 'PAYMENT_PENDING' && order.asaasPaymentId ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={reconcileMutation.isPending}
                            onClick={() => reconcileMutation.mutate(order.id)}
                          >
                            Reconciliar
                          </Button>
                        ) : null}
                        {order.status === 'CONFIRMED' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={resendMutation.isPending}
                            onClick={() => resendMutation.mutate(order.id)}
                          >
                            <Mail className="h-3.5 w-3.5" />
                            Reenviar
                          </Button>
                        ) : null}
                        {order.status === 'CONFIRMED' ? (
                          <Button asChild size="sm" variant="outline">
                            <a href={`/api/events/public-orders/${order.id}/tickets`} target="_blank" rel="noreferrer">
                              <Ticket className="h-3.5 w-3.5" />
                              PDF
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
