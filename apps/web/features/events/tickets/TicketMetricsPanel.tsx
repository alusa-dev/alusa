'use client';

import { CircleDollarSign, Ticket, WalletCards } from 'lucide-react';

import { formatCurrency } from '../events-service';
import { EventMetricCard as MetricCard } from '../shared/EventMetricCard';

export function TicketMetricsPanel({ revenue, pending, sold, complimentary }: { revenue: number; pending: number; sold: number; complimentary: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Receita recebida" value={formatCurrency(revenue)} icon={CircleDollarSign} tone="success" />
      <MetricCard label="Receita pendente" value={formatCurrency(pending)} icon={WalletCards} tone="warning" />
      <MetricCard label="Ingressos vendidos" value={sold} icon={Ticket} />
      <MetricCard label="Cortesias" value={complimentary} icon={Ticket} tone="info" />
    </div>
  );
}
