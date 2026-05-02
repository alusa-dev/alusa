'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/use-current-user';
// Optamos por usar next/dynamic para carregar as métricas do Dashboard sob demanda
// Isso fragmenta o EvaluateScript inicial e quebra as Long Tasks no render.
import dynamic from 'next/dynamic';
const TotalAlunosCardDynamic = dynamic(() => import('./components/TotalAlunosCard').then((mod) => mod.TotalAlunosCard));
const AniversariantesMesCardDynamic = dynamic(() => import('./components/AniversariantesMesCard').then((mod) => mod.AniversariantesMesCard));
const KycDashboardCardDynamic = dynamic(() => import('@/features/kyc/components/KycDashboardCard').then((mod) => mod.KycDashboardCard));
const AguardandoPagamentoCardDynamic = dynamic(() => import('./components/FinanceiroKpiCards').then((mod) => mod.AguardandoPagamentoCard));
const RecebidasKpiCardDynamic = dynamic(() => import('./components/RecebidasKpiCard').then((mod) => mod.RecebidasKpiCard));
const TaxaMatriculaCardDynamic = dynamic(() => import('./components/TaxaMatriculaCard').then((mod) => mod.TaxaMatriculaCard));
import type { PeriodoTaxaMatricula } from './components/TaxaMatriculaCard';
import type { DashboardMetricsDataDTO } from '@/features/dashboard/dtos';
import { mapDashboardMetricsResultToDTO } from '@/features/dashboard/mappers';
import { useKycEnforcement } from '@/features/kyc/KycEnforcementProvider';

export default function DashboardClient() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const shouldReduceMotion = useReducedMotion();
  const [metrics, setMetrics] = useState<DashboardMetricsDataDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [kycCardDismissed, setKycCardDismissed] = useState(false);
  const [periodoTaxaMatricula, setPeriodoTaxaMatricula] = useState<PeriodoTaxaMatricula>('1a');
  const { verification, loading: verificationLoading, isApproved } = useKycEnforcement();
  const handleGoToCadastro = useCallback(() => {
    router.push('/alunos');
  }, [router]);

  useEffect(() => {
    if (!user?.contaId) {
      setMetrics(null);
      return;
    }

    let cancelled = false;

    const fetchMetrics = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/dashboard/metrics', {
          cache: 'no-store',
        });
        const raw = (await response.json()) as Record<string, unknown>;
        const data = mapDashboardMetricsResultToDTO(raw);

        if (!cancelled && data.success) {
          setMetrics(data.data);
        } else if (!cancelled) {
          console.error('[DashboardClient] Erro na resposta:', data);
        }
      } catch (error) {
        if (!cancelled) console.error('[DashboardClient] Erro ao buscar métricas:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchMetrics();

    return () => {
      cancelled = true;
    };
  }, [user?.contaId]);

  useEffect(() => {
    if (verificationLoading) return;
    if (!verification || isApproved) {
      setKycCardDismissed(false);
    }
  }, [verification, verificationLoading, isApproved]);

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

  const kpiGroupVariants = shouldReduceMotion
    ? undefined
    : {
        hidden: {},
        visible: {
          transition: {
            staggerChildren: 0.08,
            delayChildren: 0.05,
          },
        },
      };

  const kpiItemVariants = shouldReduceMotion
    ? undefined
    : {
        hidden: {
          opacity: 0,
          y: 24,
        },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: 0.42,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        },
      };

  const showKycCard = !verificationLoading && Boolean(verification) && !isApproved && !kycCardDismissed;

  return (
    <section aria-label="Conteúdo do Dashboard" className="flex flex-col gap-6 pb-8">
      {/* Título */}
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">
          Olá, {user?.name || 'Usuário'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Veja o resumo das suas métricas e acompanhe o desempenho do seu negócio.
        </p>
      </header>

      {/* Grid de 4 KPIs principais */}
      <motion.div
        className="grid auto-rows-fr grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4"
        initial={shouldReduceMotion ? false : 'hidden'}
        animate={shouldReduceMotion ? undefined : 'visible'}
        variants={kpiGroupVariants}
      >
        {showKycCard ? (
          <motion.div variants={kpiItemVariants} className="md:col-span-2 xl:col-span-2">
            <KycDashboardCardDynamic onDismiss={() => setKycCardDismissed(true)} />
          </motion.div>
        ) : null}

        <motion.div variants={kpiItemVariants}>
          <TotalAlunosCardDynamic
            total={metrics?.alunosAtivos ?? 0}
            ativos={metrics?.alunosAtivos ?? 0}
            recentStudents={(metrics?.alunosRecentes || []).map((aluno) => ({
              id: aluno.id,
              name: aluno.nome,
              avatarUrl: aluno.foto,
              initials: getInitials(aluno.nome),
            }))}
            onAddAluno={handleGoToCadastro}
            disableAddAluno={!verificationLoading && Boolean(verification) && !isApproved}
            loading={loading}
          />
        </motion.div>

        <motion.div variants={kpiItemVariants}>
          <RecebidasKpiCardDynamic data={metrics} loading={loading} />
        </motion.div>

        <motion.div
          variants={kpiItemVariants}
          className={showKycCard ? 'xl:col-span-2' : undefined}
        >
          <AguardandoPagamentoCardDynamic data={metrics} loading={loading} />
        </motion.div>

        <motion.div
          variants={kpiItemVariants}
          className={showKycCard ? 'xl:col-span-2' : undefined}
        >
          <TaxaMatriculaCardDynamic
            periodo={periodoTaxaMatricula}
            onPeriodoChange={(periodo) => {
              if (periodo) setPeriodoTaxaMatricula(periodo);
            }}
          />
        </motion.div>
      </motion.div>

      {/* Grid de Atalhos e Acesso Rápido */}
      <motion.div
        className="grid grid-cols-1 gap-6 lg:grid-cols-4"
        initial={shouldReduceMotion ? false : 'hidden'}
        animate={shouldReduceMotion ? undefined : 'visible'}
        variants={kpiGroupVariants}
      >
        <motion.div variants={kpiItemVariants} className="h-[260px]">
          <AniversariantesMesCardDynamic aniversariantes={metrics?.aniversariantesDoMes ?? []} />
        </motion.div>

        {/* Atalhos Administrativos */}
        <motion.div variants={kpiItemVariants} className="h-[260px]">
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm flex h-full flex-col">
            <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Atalhos Administrativos</h3>
            <p className="text-xs text-gray-500 mb-4">Acesse os módulos mais usados na operação</p>

            <div className="flex flex-1 flex-col justify-center space-y-2">
              <button
                className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-[#383242] transition-colors p-2.5 rounded-xl hover:bg-[#f4ecfd]/50 group"
                onClick={() => router.push('/alunos')}
              >
                <span>Alunos</span>
                <span className="text-gray-400 group-hover:text-[#383242] transition-colors text-lg">→</span>
              </button>
              <button
                className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-[#383242] transition-colors p-2.5 rounded-xl hover:bg-[#f4ecfd]/50 group"
                onClick={() => router.push('/matriculas')}
              >
                <span>Matrículas</span>
                <span className="text-gray-400 group-hover:text-[#383242] transition-colors text-lg">→</span>
              </button>
              <button
                className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-[#383242] transition-colors p-2.5 rounded-xl hover:bg-[#f4ecfd]/50 group"
                onClick={() => router.push('/financeiro/relatorios')}
              >
                <span>Relatórios financeiros</span>
                <span className="text-gray-400 group-hover:text-[#383242] transition-colors text-lg">→</span>
              </button>
            </div>
          </div>
        </motion.div>

        {/* Acesso Rápido */}
        <motion.div variants={kpiItemVariants} className="h-[260px] lg:col-span-2">
          <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm flex h-full flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
              <h2 className="text-sm font-semibold text-gray-900">Acesso Rápido</h2>
            </div>
            <div className="p-3 space-y-1 flex-1 flex flex-col justify-center">
              <button
                onClick={() => router.push('/cobrancas?new=1')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f4ecfd]/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#f4ecfd] flex items-center justify-center">
                    <svg className="h-4 w-4 text-[#383242]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Cobranças</span>
                </div>
                <svg className="h-4 w-4 text-gray-400 group-hover:text-[#383242] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <button
                onClick={() => router.push('/matriculas?new=1')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f4ecfd]/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#f4ecfd] flex items-center justify-center">
                    <svg className="h-4 w-4 text-[#383242]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Criar matrícula</span>
                </div>
                <svg className="h-4 w-4 text-gray-400 group-hover:text-[#383242] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <button
                onClick={() => router.push('/rematriculas')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f4ecfd]/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#f4ecfd] flex items-center justify-center">
                    <svg className="h-4 w-4 text-[#383242]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h12M4 12h8m-8 5h12m4-8-3 3m0 0 3 3m-3-3h-8" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Rematrículas</span>
                </div>
                <svg className="h-4 w-4 text-gray-400 group-hover:text-[#383242] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Seção Inferior: Tabelas e Listas */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6"
        initial={shouldReduceMotion ? false : 'hidden'}
        animate={shouldReduceMotion ? undefined : 'visible'}
        variants={kpiGroupVariants}
      >
        {/* Últimas Cobranças */}
        <motion.div variants={kpiItemVariants} className="md:col-span-2 lg:col-span-3">
          <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm h-fit">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Últimas Cobranças</h2>
              <button
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
        </motion.div>

        {/* Alunos Recentes */}
        <motion.div variants={kpiItemVariants} className="md:col-span-2 lg:col-span-1">
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
        </motion.div>
      </motion.div>
    </section>
  );
}
