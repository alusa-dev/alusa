'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { DashboardSecondarySkeleton } from './dashboard-secondary-skeletons';

const AulaExperimentalCard = dynamic(
  () =>
    import('./components/AulaExperimentalCard').then((m) => ({
      default: m.AulaExperimentalCard,
    })),
  {
    loading: () => (
      <div className="h-[260px]">
        <Skeleton className="h-full w-full rounded-2xl" />
      </div>
    ),
    ssr: false,
  },
);

const AniversariantesMesCard = dynamic(
  () =>
    import('./components/AniversariantesMesCard').then((m) => ({
      default: m.AniversariantesMesCard,
    })),
  {
    loading: () => (
      <div className="h-[260px]">
        <Skeleton className="h-full w-full rounded-2xl" />
      </div>
    ),
    ssr: false,
  },
);

type DashboardSecondarySectionProps = {
  metrics: DashboardMetricsDataDTO | null;
  isMetricsLoading: boolean;
};

export default function DashboardSecondarySection({
  metrics,
  isMetricsLoading,
}: DashboardSecondarySectionProps) {
  const router = useRouter();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  function cobrancaStatusVariant(raw: string): BadgeVariant {
    const s = raw.toUpperCase();
    if (s === 'PAGO') return 'success';
    if (s === 'PENDENTE') return 'warning';
    return 'destructive';
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="h-[260px]">
          <AulaExperimentalCard aulasExperimentais={metrics?.aulasExperimentais ?? []} />
        </div>

        <div className="h-[260px]">
          <AniversariantesMesCard aniversariantes={metrics?.aniversariantesDoMes ?? []} />
        </div>

        <div className="h-[260px]">
          <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
            <h2 className="mb-0.5 text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
              Atalhos Administrativos
            </h2>
            <p className="mb-4 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
              Acesse os módulos mais usados na operação
            </p>

            <div className="flex flex-1 flex-col justify-center space-y-2">
              <button
                type="button"
                className="group flex w-full items-center justify-between rounded-xl p-2.5 text-sm text-gray-600 transition-colors hover:bg-[#f4ecfd]/50 hover:text-[#383242] alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
                onClick={() => router.push('/alunos')}
              >
                <span>Alunos</span>
                <span className="text-lg text-gray-400 transition-colors group-hover:text-[#383242] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:group-hover:text-[color:var(--color-brand-300)]">
                  →
                </span>
              </button>
              <button
                type="button"
                className="group flex w-full items-center justify-between rounded-xl p-2.5 text-sm text-gray-600 transition-colors hover:bg-[#f4ecfd]/50 hover:text-[#383242] alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
                onClick={() => router.push('/matriculas')}
              >
                <span>Matrículas</span>
                <span className="text-lg text-gray-400 transition-colors group-hover:text-[#383242] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:group-hover:text-[color:var(--color-brand-300)]">
                  →
                </span>
              </button>
              <button
                type="button"
                className="group flex w-full items-center justify-between rounded-xl p-2.5 text-sm text-gray-600 transition-colors hover:bg-[#f4ecfd]/50 hover:text-[#383242] alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
                onClick={() => router.push('/financeiro/relatorios')}
              >
                <span>Relatórios financeiros</span>
                <span className="text-lg text-gray-400 transition-colors group-hover:text-[#383242] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:group-hover:text-[color:var(--color-brand-300)]">
                  →
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="h-[260px]">
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
            <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-4 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
              <h2 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                Acesso Rápido
              </h2>
            </div>
            <div className="flex flex-1 flex-col justify-center space-y-1 p-3">
              <button
                type="button"
                onClick={() => router.push('/cobrancas?new=1')}
                className="group flex w-full items-center justify-between rounded-xl p-2.5 transition-colors hover:bg-[#f4ecfd]/40 alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4ecfd] alusa-dark:bg-[color:var(--color-brand-950)]">
                    <svg className="h-4 w-4 text-[#383242] alusa-dark:text-[color:var(--color-brand-300)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                    Cobranças
                  </span>
                </div>
                <svg
                  className="h-4 w-4 text-gray-400 transition-colors group-hover:text-[#383242] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:group-hover:text-[color:var(--color-brand-300)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => router.push('/matriculas?new=1')}
                className="group flex w-full items-center justify-between rounded-xl p-2.5 transition-colors hover:bg-[#f4ecfd]/40 alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4ecfd] alusa-dark:bg-[color:var(--color-brand-950)]">
                    <svg className="h-4 w-4 text-[#383242] alusa-dark:text-[color:var(--color-brand-300)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                    Criar matrícula
                  </span>
                </div>
                <svg
                  className="h-4 w-4 text-gray-400 transition-colors group-hover:text-[#383242] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:group-hover:text-[color:var(--color-brand-300)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => router.push('/rematriculas')}
                className="group flex w-full items-center justify-between rounded-xl p-2.5 transition-colors hover:bg-[#f4ecfd]/40 alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4ecfd] alusa-dark:bg-[color:var(--color-brand-950)]">
                    <svg className="h-4 w-4 text-[#383242] alusa-dark:text-[color:var(--color-brand-300)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 7h12M4 12h8m-8 5h12m4-8-3 3m0 0 3 3m-3-3h-8"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                    Rematrículas
                  </span>
                </div>
                <svg
                  className="h-4 w-4 text-gray-400 transition-colors group-hover:text-[#383242] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:group-hover:text-[color:var(--color-brand-300)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {isMetricsLoading ? (
        <DashboardSecondarySkeleton />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="md:col-span-2 lg:col-span-3">
              <div className="h-fit overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 alusa-dark:border-[color:var(--color-border-subtle)]">
                  <h2 className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                    Últimas Cobranças
                  </h2>
                  <button
                    type="button"
                    onClick={() => router.push('/financeiro/cobrancas')}
                    className="rounded-lg bg-[#f4ecfd] px-4 py-1.5 text-sm font-medium text-[#383242] transition-colors hover:bg-[#e9dffc] alusa-dark:bg-[color:var(--color-button-secondary-bg)] alusa-dark:text-[color:var(--color-button-secondary-text)] alusa-dark:hover:bg-[color:var(--color-button-secondary-hover)]"
                  >
                    Ver Todas
                  </button>
                </div>

                <div className="max-h-[400px] overflow-x-auto overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-gray-50/50 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                          Aluno
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                          Vencimento
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                          Status
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                          Valor
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 alusa-dark:divide-[color:var(--color-border-subtle)]">
                      {(metrics?.ultimasCobrancas || []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-6 py-12 text-center text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]"
                          >
                            Nenhuma cobrança encontrada
                          </td>
                        </tr>
                      ) : (
                        (metrics?.ultimasCobrancas || []).map((cobranca) => (
                          <tr
                            key={cobranca.id}
                            className="transition-colors hover:bg-gray-50/50 alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)]"
                          >
                            <td className="whitespace-nowrap px-6 py-4">
                              <p className="text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                                {cobranca.aluno}
                              </p>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <p className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                                {formatDate(cobranca.vencimento)}
                              </p>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <Badge
                                variant={cobrancaStatusVariant(cobranca.status)}
                                size="sm"
                                className="tracking-widest uppercase"
                              >
                                {cobranca.status}
                              </Badge>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right">
                              <p className="text-sm font-bold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                                {formatCurrency(cobranca.valor)}
                              </p>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 lg:col-span-1">
              <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                <div className="border-b border-gray-100 px-5 py-4 alusa-dark:border-[color:var(--color-border-subtle)]">
                  <h2 className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                    Alunos Recentes
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                    Últimos cadastros realizados
                  </p>
                </div>

                <div className="flex flex-1 space-y-1 p-3">
                  {(metrics?.alunosRecentes || []).length === 0 ? (
                    <p className="py-10 text-center text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                      Nenhum aluno recente
                    </p>
                  ) : (
                    (metrics?.alunosRecentes || []).map((aluno) => (
                      <button
                        key={aluno.id}
                        type="button"
                        onClick={() => router.push(`/alunos/${aluno.id}`)}
                        className="group flex w-full items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[#f4ecfd]/30 alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)]"
                      >
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#383242]/10 text-sm font-bold text-[#383242] alusa-dark:bg-[color:var(--color-brand-950)] alusa-dark:text-[color:var(--color-brand-300)]">
                          {aluno.foto ? (
                            <img
                              src={aluno.foto}
                              alt={aluno.nome}
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            getInitials(aluno.nome)
                          )}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                            {aluno.nome}
                          </p>
                          <p className="truncate text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                            {aluno.tipo}
                          </p>
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-gray-50 opacity-0 transition-all group-hover:border-gray-200 group-hover:bg-white group-hover:opacity-100 alusa-dark:border-transparent alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:group-hover:border-[color:var(--color-border-default)]">
                          <span className="text-lg">→</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="border-t border-gray-100 bg-gray-50/30 p-4 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                  <button
                    type="button"
                    onClick={() => router.push('/alunos')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-[#383242] shadow-sm transition-all hover:border-[#383242]/20 hover:shadow-md alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-button-secondary-bg)] alusa-dark:text-[color:var(--color-button-secondary-text)] alusa-dark:hover:bg-[color:var(--color-button-secondary-hover)]"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Gerenciar Alunos
                  </button>
                </div>
              </div>
            </div>
        </div>
      )}
    </>
  );
}
