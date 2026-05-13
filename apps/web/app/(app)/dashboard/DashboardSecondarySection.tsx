'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

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
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm flex h-full flex-col">
            <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Atalhos Administrativos</h2>
            <p className="text-xs text-gray-500 mb-4">Acesse os módulos mais usados na operação</p>

            <div className="flex flex-1 flex-col justify-center space-y-2">
              <button
                type="button"
                className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-[#383242] transition-colors p-2.5 rounded-xl hover:bg-[#f4ecfd]/50 group"
                onClick={() => router.push('/alunos')}
              >
                <span>Alunos</span>
                <span className="text-gray-400 group-hover:text-[#383242] transition-colors text-lg">→</span>
              </button>
              <button
                type="button"
                className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-[#383242] transition-colors p-2.5 rounded-xl hover:bg-[#f4ecfd]/50 group"
                onClick={() => router.push('/matriculas')}
              >
                <span>Matrículas</span>
                <span className="text-gray-400 group-hover:text-[#383242] transition-colors text-lg">→</span>
              </button>
              <button
                type="button"
                className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-[#383242] transition-colors p-2.5 rounded-xl hover:bg-[#f4ecfd]/50 group"
                onClick={() => router.push('/financeiro/relatorios')}
              >
                <span>Relatórios financeiros</span>
                <span className="text-gray-400 group-hover:text-[#383242] transition-colors text-lg">→</span>
              </button>
            </div>
          </div>
        </div>

        <div className="h-[260px]">
          <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm flex h-full flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
              <h2 className="text-sm font-semibold text-gray-900">Acesso Rápido</h2>
            </div>
            <div className="p-3 space-y-1 flex-1 flex flex-col justify-center">
              <button
                type="button"
                onClick={() => router.push('/cobrancas?new=1')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f4ecfd]/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#f4ecfd] flex items-center justify-center">
                    <svg className="h-4 w-4 text-[#383242]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Cobranças</span>
                </div>
                <svg
                  className="h-4 w-4 text-gray-400 group-hover:text-[#383242] transition-colors"
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
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f4ecfd]/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#f4ecfd] flex items-center justify-center">
                    <svg className="h-4 w-4 text-[#383242]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Criar matrícula</span>
                </div>
                <svg
                  className="h-4 w-4 text-gray-400 group-hover:text-[#383242] transition-colors"
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
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f4ecfd]/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#f4ecfd] flex items-center justify-center">
                    <svg className="h-4 w-4 text-[#383242]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 7h12M4 12h8m-8 5h12m4-8-3 3m0 0 3 3m-3-3h-8"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Rematrículas</span>
                </div>
                <svg
                  className="h-4 w-4 text-gray-400 group-hover:text-[#383242] transition-colors"
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
            <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm h-fit">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Últimas Cobranças</h2>
                <button
                  type="button"
                  onClick={() => router.push('/financeiro/cobrancas')}
                  className="px-4 py-1.5 bg-[#f4ecfd] text-[#383242] rounded-lg text-sm font-medium hover:bg-[#e9dffc] transition-colors"
                >
                  Ver Todas
                </button>
              </div>

              <div className="overflow-x-auto overflow-y-auto max-h-[400px]">
                <table className="w-full">
                  <thead className="bg-gray-50/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Aluno
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Vencimento
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Valor
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(metrics?.ultimasCobrancas || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500">
                          Nenhuma cobrança encontrada
                        </td>
                      </tr>
                    ) : (
                      (metrics?.ultimasCobrancas || []).map((cobranca) => (
                        <tr key={cobranca.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <p className="text-sm font-medium text-gray-900">{cobranca.aluno}</p>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <p className="text-sm text-gray-600">{formatDate(cobranca.vencimento)}</p>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase"
                              style={{
                                backgroundColor:
                                  cobranca.status === 'PAGO'
                                    ? '#CFF2DA'
                                    : cobranca.status === 'PENDENTE'
                                      ? '#F3F9B3'
                                      : '#FFD9B3',
                                color:
                                  cobranca.status === 'PAGO'
                                    ? '#144E22'
                                    : cobranca.status === 'PENDENTE'
                                      ? '#5A630F'
                                      : '#5C2A00',
                              }}
                            >
                              {cobranca.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right whitespace-nowrap">
                            <p className="text-sm font-bold text-gray-900">
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
            <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm h-full flex flex-col">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Alunos Recentes</h2>
                <p className="text-xs text-gray-500 mt-0.5">Últimos cadastros realizados</p>
              </div>

              <div className="p-3 space-y-1 flex-1">
                {(metrics?.alunosRecentes || []).length === 0 ? (
                  <p className="text-center text-sm text-gray-500 py-10">Nenhum aluno recente</p>
                ) : (
                  (metrics?.alunosRecentes || []).map((aluno) => (
                    <button
                      key={aluno.id}
                      type="button"
                      onClick={() => router.push(`/alunos/${aluno.id}`)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#f4ecfd]/30 transition-colors group"
                    >
                      <div className="h-10 w-10 rounded-full bg-[#383242]/10 flex items-center justify-center text-[#383242] font-bold text-sm flex-shrink-0">
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
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{aluno.nome}</p>
                        <p className="text-xs text-gray-500 truncate">{aluno.tipo}</p>
                      </div>
                      <div className="h-8 w-8 rounded-full flex items-center justify-center bg-gray-50 group-hover:bg-white border border-transparent group-hover:border-gray-200 transition-all opacity-0 group-hover:opacity-100">
                        <span className="text-lg">→</span>
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="p-4 border-t border-gray-100 bg-gray-50/30">
                <button
                  type="button"
                  onClick={() => router.push('/alunos')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 text-[#383242] rounded-xl text-sm font-bold shadow-sm hover:shadow-md hover:border-[#383242]/20 transition-all"
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
