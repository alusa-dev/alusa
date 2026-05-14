"use client";

import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardFinanceKpisDataDTO, DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

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
      <div className="flex flex-col justify-between rounded-2xl border border-transparent bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full animate-pulse alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
        <div>
          <Skeleton className="mb-2 h-4 w-24 bg-[#e9dffc] alusa-dark:bg-[color:var(--color-border-strong)]/40" />
          <Skeleton className="h-10 w-32 bg-[#e9dffc] alusa-dark:bg-[color:var(--color-border-strong)]/40" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-transparent bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)]">
      <div>
        <p className="mb-2 text-[13px] font-normal tracking-wide text-[#2b2634] alusa-dark:text-[color:var(--color-text-secondary)]">
          {titulo}
        </p>
        <span className="mb-1 block text-4xl font-medium leading-none text-[#2b2634] alusa-dark:text-[color:var(--color-text-primary)]">
          {formato === 'moeda' ? formatCurrency(valor) : formatCount(valor)}
        </span>
        {descricao ? (
          <span className="text-xs text-[#2b2634]/70 alusa-dark:text-[color:var(--color-text-muted)]">
            {descricao}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type FinanceiroKpiCardProps = {
  data: DashboardMetricsDataDTO | null;
  loading: boolean;
};

type DashboardFinanceKpiCardProps = {
  data: DashboardFinanceKpisDataDTO | null;
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

export function AguardandoPagamentoCard({ data, loading }: DashboardFinanceKpiCardProps) {
  const valor = data?.aguardandoPagamentoProximos30Dias.valorBruto ?? 0;
  return (
    <KpiCard
      titulo="Aguardando pagamento"
      valor={valor}
      descricao="Mesmo total de Todas as Cobranças em aberto"
      formato="moeda"
      loading={loading}
    />
  );
}
