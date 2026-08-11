"use client";

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardFinanceKpisDataDTO, DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

import { DASHBOARD_KPI_TILE_CLASSNAME } from './utils';

interface KpiCardProps {
  titulo: string;
  valor: number;
  descricao?: string;
  loading?: boolean;
  formato?: 'numero' | 'moeda';
  action?: { label: string; href: string };
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
  action,
}: KpiCardProps) {
  if (loading) {
    return (
      <div
        className={`${DASHBOARD_KPI_TILE_CLASSNAME} flex h-[219px] flex-col justify-between rounded-2xl bg-[#f2e9fc] px-5 pb-[22px] pt-4 animate-pulse alusa-dark:bg-[color:var(--color-bg-card-soft)]`}
      >
        <div>
          <Skeleton className="mb-2 h-4 w-24 bg-[#e9dffc] alusa-dark:bg-[color:var(--color-border-strong)]/40" />
          <Skeleton className="h-10 w-32 bg-[#e9dffc] alusa-dark:bg-[color:var(--color-border-strong)]/40" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${DASHBOARD_KPI_TILE_CLASSNAME} flex h-[219px] flex-col justify-between rounded-2xl bg-[#f2e9fc] px-5 pb-[22px] pt-4 alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)]`}
    >
      <div>
        <p className="text-xs font-normal text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-secondary)]">
          {titulo}
        </p>
        <span className="mt-5 block text-[37px] font-normal leading-none text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-primary)]">
          {formato === 'moeda' ? formatCurrency(valor) : formatCount(valor)}
        </span>
        {descricao ? <span className="sr-only">{descricao}</span> : null}
      </div>
      {action ? (
        <Link href={action.href} className="inline-flex h-6 w-fit items-center rounded-full bg-[#3d3a3f] px-3 text-xs font-normal text-[#f2e9fc] transition hover:bg-[#26222d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3d3a3f]/30">
          {action.label}
        </Link>
      ) : null}
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
      action={{ label: 'Ver turmas', href: '/turmas' }}
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
      action={{ label: 'Ver taxas', href: '/financeiro/relatorios' }}
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
      action={{ label: 'Ver cobranças', href: '/cobrancas' }}
      loading={loading}
    />
  );
}
