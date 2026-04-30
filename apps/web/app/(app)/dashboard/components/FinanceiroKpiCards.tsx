"use client";

import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

interface KpiCardProps {
  titulo: string;
  valor: number;
  descricao?: string;
  loading?: boolean;
  formato?: 'numero' | 'moeda';
}

function formatCount(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function KpiCard({
  titulo,
  valor,
  descricao,
  loading,
  formato = 'numero',
}: KpiCardProps) {
  if (loading) {
    return (
      <div className="flex flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full animate-pulse">
        <div>
          <Skeleton className="h-4 w-24 bg-[#e9dffc] mb-2" />
          <Skeleton className="h-10 w-32 bg-[#e9dffc]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full">
      <div>
        <p className="text-[13px] font-normal tracking-wide text-[#2b2634] mb-2">
          {titulo}
        </p>
        <span className="text-4xl leading-none font-medium text-[#2b2634] mb-1 block">
          {formato === 'moeda' ? formatCurrency(valor) : formatCount(valor)}
        </span>
        {descricao ? <span className="text-xs text-[#2b2634]/70">{descricao}</span> : null}
      </div>
    </div>
  );
}

type FinanceiroKpiCardProps = {
  data: DashboardMetricsDataDTO | null;
  loading: boolean;
};

export function ConfirmadasCard({ data, loading }: FinanceiroKpiCardProps) {
  const valor = data?.turmasAtivas ?? 0;
  return (
    <KpiCard
      titulo="Turmas ativas"
      valor={valor}
      descricao="Com status ativo"
      loading={loading}
    />
  );
}

export function VencidasCard({ data, loading }: FinanceiroKpiCardProps) {
  const valor = data?.taxaMatriculaRecebidaAno ?? 0;
  return (
    <KpiCard
      titulo="Taxas de matrícula recebidas no ano"
      valor={valor}
      descricao="Arrecadado até hoje"
      formato="moeda"
      loading={loading}
    />
  );
}

export function AguardandoPagamentoCard({ data, loading }: FinanceiroKpiCardProps) {
  const valor = data?.aguardandoPagamentoProximos30Dias ?? 0;
  return (
    <KpiCard
      titulo="Aguardando pagamento"
      valor={valor}
      descricao="Vencimento nos próximos 30 dias"
      formato="moeda"
      loading={loading}
    />
  );
}
