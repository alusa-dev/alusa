'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle } from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import type { PortalDashboardResultDTO } from '@/features/portal/dtos';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';
import { AlunoSelector } from './components/AlunoSelector';
import {
  DASHBOARD_KPI_TILE_CLASSNAME,
  DASHBOARD_SECTION_CARD_CLASSNAME,
} from '@/app/(app)/dashboard/components/utils';

export function PortalDashboardFeature() {
  const { data: session } = useSession();
  const [data, setData] = useState<PortalDashboardResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlunoId, setSelectedAlunoId] = useState<string | null>(null);

  const user = session?.user as { role?: string } | undefined;
  const isResponsavel = user?.role === 'RESPONSAVEL';

  const { isInitialLoading } = useFinanceListLoad(
    async ({ signal }) => {
      if (!session?.user) return;
      let url = '/api/portal/dashboard';
      if (selectedAlunoId) {
        url += `?alunoId=${selectedAlunoId}`;
      }
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error('Erro ao carregar dados');
      }
      const result = await response.json();
      setData(result);
      setError(null);
    },
    {
      deps: [session?.user, selectedAlunoId],
      liveRefreshEnabled: Boolean(session?.user),
      liveRefresh: { dashboard: false, financeiro: false },
      intervalMs: 60_000,
      minIntervalMs: 10_000,
    },
  );

  const userName = session?.user?.name || 'Aluno';
  const greeting = getGreeting();

  if (isInitialLoading) {
    return (
      <section
        aria-label="Carregando dashboard"
        aria-busy="true"
        className="alusa-dashboard-page flex flex-col gap-7 pb-8"
      >
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-[190px] rounded-2xl" />
          <Skeleton className="h-[190px] rounded-2xl" />
          <Skeleton className="h-[190px] rounded-2xl" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 alusa-dark:border-red-900/60 alusa-dark:bg-red-950/20 alusa-dark:text-red-200"
      >
        <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <section
      aria-label="Dashboard do portal"
      className="alusa-dashboard-page flex flex-col gap-7 pb-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
          {greeting}, {userName}!
        </h1>
        <p className="mt-1 text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
          Acompanhe matrículas, cobranças e eventos dos seus alunos.
        </p>
      </div>

      {/* Seletor de Aluno (apenas para responsáveis) */}
      {isResponsavel && <AlunoSelector onAlunoSelect={setSelectedAlunoId} />}

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {/* Matrículas */}
        <Card
          title="Matrículas"
          value={data?.matriculas.ativas.toString() || '0'}
          subtitle={`${data?.matriculas.total || 0} no total`}
          action={{ label: 'Ver matrículas', href: '/portal/matriculas' }}
        />

        {/* Financeiro */}
        <Card
          title="Cobranças pendentes"
          value={data?.financeiro.pendentes.toString() || '0'}
          subtitle={
            data?.financeiro.totalPendente
              ? formatCurrency(Number(data.financeiro.totalPendente))
              : 'Nenhuma pendência'
          }
          action={{ label: 'Ver cobranças', href: '/portal/financeiro' }}
        />

        {/* Eventos */}
        <Card
          title="Próximos eventos"
          value={data?.eventos.proximos.toString() || '0'}
          subtitle="eventos confirmados"
          action={{ label: 'Ver eventos', href: '/portal/eventos' }}
        />
      </div>

      {/* Próximo vencimento */}
      {data?.financeiro.proxVencimento && (
        <div className="flex items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 alusa-dark:border-amber-900/60 alusa-dark:bg-amber-950/20">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 alusa-dark:bg-amber-900/40 alusa-dark:text-amber-300">
            <AlertCircle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-medium text-amber-950 alusa-dark:text-amber-200">
              Próximo vencimento
            </h2>
            <p className="mt-1 text-sm text-amber-900/90 alusa-dark:text-amber-100/80">
              Você tem uma cobrança de{' '}
              <span className="font-semibold">
                {formatCurrency(Number(data.financeiro.proxVencimento.valor))}
              </span>{' '}
              com vencimento em{' '}
              <span className="font-semibold">
                {new Date(data.financeiro.proxVencimento.data).toLocaleDateString('pt-BR')}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Ações rápidas */}
      <section
        className={`${DASHBOARD_SECTION_CARD_CLASSNAME} rounded-2xl bg-white p-5 md:p-6 alusa-dark:bg-[color:var(--color-bg-card)]`}
      >
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
            Acesso rápido
          </h2>
          <p className="mt-1 text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
            Atalhos para as principais áreas do portal.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <QuickAction
            title="Ver Matrículas"
            description="Consulte o status das suas matrículas"
            href="/portal/matriculas"
          />
          <QuickAction
            title="Financeiro"
            description="Veja e pague suas cobranças"
            href="/portal/financeiro"
          />
          <QuickAction
            title="Meus Eventos"
            description="Eventos inscritos e ingressos"
            href="/portal/eventos"
          />
          <QuickAction
            title="Meu Perfil"
            description="Atualize seus dados pessoais"
            href="/portal/perfil"
          />
        </div>
      </section>
    </section>
  );
}

function Card({
  title,
  value,
  subtitle,
  action,
}: {
  title: string;
  value: string;
  subtitle: string;
  action: { label: string; href: string };
}) {
  return (
    <article
      className={`${DASHBOARD_KPI_TILE_CLASSNAME} flex min-h-[190px] flex-col justify-between rounded-2xl bg-[#f2e9fc] px-5 py-5 text-[#3d3a3f] alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)] alusa-dark:text-[color:var(--color-text-primary)]`}
    >
      <div>
        <p className="text-xs font-medium text-[#3d3a3f]/80 alusa-dark:text-[color:var(--color-text-secondary)]">
          {title}
        </p>
        <p className="mt-5 text-[40px] font-normal leading-none tabular-nums">{value}</p>
        <p className="mt-2 text-sm text-[#3d3a3f]/70 alusa-dark:text-[color:var(--color-text-muted)]">
          {subtitle}
        </p>
      </div>
      <Link
        href={action.href}
        className="inline-flex h-7 w-fit items-center rounded-full bg-[#3d3a3f] px-3 text-xs font-medium text-[#f2e9fc] transition-colors hover:bg-[#26222d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3d3a3f]/30 alusa-dark:bg-white/10 alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-white/15"
      >
        {action.label}
      </Link>
    </article>
  );
}

function QuickAction({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} group flex items-start gap-4 rounded-xl bg-white p-4 transition-colors hover:bg-gray-50/70 focus-visible:ring-2 focus-visible:ring-brand-accent/35 alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:hover:bg-white/[0.04]`}
    >
      <div className="flex-1">
        <h3 className="font-medium text-gray-900 transition-colors group-hover:text-violet-700 alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:group-hover:text-violet-300">
          {title}
        </h3>
        <p className="mt-1 text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-muted)]">
          {description}
        </p>
      </div>
      <svg
        className="h-5 w-5 shrink-0 text-gray-400 transition-colors group-hover:text-violet-600 alusa-dark:text-[color:var(--color-text-muted)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value);
}
