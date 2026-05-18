'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/use-current-user';
import { TotalAlunosCard } from './components/TotalAlunosCard';
import {
  AguardandoPagamentoCard,
} from './components/FinanceiroKpiCards';
import { RecebidasKpiCard } from './components/RecebidasKpiCard';
import type { PeriodoTaxaMatricula } from './components/TaxaMatriculaCard';
import type { DashboardFinanceKpisDataDTO, DashboardMetricsDataDTO } from '@/features/dashboard/dtos';
import { mapDashboardFinanceKpisResultToDTO, mapDashboardMetricsResultToDTO } from '@/features/dashboard/mappers';
import { useKycEnforcement } from '@/features/kyc/KycEnforcementProvider';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { DashboardSecondaryChunkSkeleton } from './dashboard-secondary-skeletons';
import WelcomeWizardDialog from './WelcomeWizardDialog';

const FORCE_PERSISTENT_WELCOME_WIZARD = true;

const DASHBOARD_BLOCKS_ENABLED = process.env.NEXT_PUBLIC_DASHBOARD_BLOCKS_ENABLED === 'true';
const DASHBOARD_BLOCK_ENDPOINTS = [
  '/api/dashboard/summary-cards',
  '/api/dashboard/lesson-summary',
  '/api/dashboard/recent-activity',
  '/api/dashboard/birthdays',
  '/api/dashboard/experimental-classes',
] as const;

type DashboardBlockResult = {
  success: true;
  data: Partial<DashboardMetricsDataDTO>;
};

function emptyDashboardMetrics(): DashboardMetricsDataDTO {
  return {
    totalAlunos: 0,
    alunosAtivos: 0,
    turmasAtivas: 0,
    aulasHoje: 0,
    pendencias: 0,
    aniversariantesDoMesAtivos: 0,
    totalMatriculas: 0,
    matriculasAtivas: 0,
    cobrancasPendentes: 0,
    cobrancasVencidas: 0,
    receitaMes: 0,
    taxaMatriculaRecebidaAno: 0,
    receitaTotal: 0,
    proximosVencimentos: 0,
    taxaInadimplencia: 0,
    receitaSemanal: [],
    matriculasNovasSemanal: [],
    matriculasCanceladasSemanal: [],
    ultimasCobrancas: [],
    alunosRecentes: [],
    aniversariantesDoMes: [],
    aulasExperimentais: [],
  };
}

async function fetchDashboardBlock(endpoint: string): Promise<Partial<DashboardMetricsDataDTO>> {
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Dashboard block failed: ${endpoint} ${response.status}`);
  }

  const raw = (await response.json()) as DashboardBlockResult | { success: false; error?: string };
  if (!raw.success) {
    throw new Error(raw.error ?? `Dashboard block failed: ${endpoint}`);
  }

  return raw.data;
}

async function fetchLegacyMetrics(contaId: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ contaId });
  const response = await fetch(`/api/dashboard/metrics?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return (await response.json()) as Record<string, unknown>;
}

const KycDashboardCard = dynamic(
  () =>
    import('@/features/kyc/components/KycDashboardCard').then((m) => ({
      default: m.KycDashboardCard,
    })),
  {
    loading: () => (
      <div className="md:col-span-2 xl:col-span-2">
        <Skeleton className="h-[140px] w-full rounded-2xl" />
      </div>
    ),
    ssr: false,
  },
);

const DashboardSecondarySection = dynamic(
  () => import('./DashboardSecondarySection').then((m) => ({ default: m.default })),
  {
    loading: () => <DashboardSecondaryChunkSkeleton />,
    ssr: false,
  },
);

function TaxaMatriculaCardDeferred({
  showKycCard,
  periodo,
  onPeriodoChange,
}: {
  showKycCard: boolean;
  periodo: PeriodoTaxaMatricula;
  onPeriodoChange?: (periodo: PeriodoTaxaMatricula | null) => void;
}) {
  const LazyTaxaMatriculaCard = useMemo(
    () =>
      dynamic(
        () =>
          import('./components/TaxaMatriculaCard').then((m) => ({
            default: m.TaxaMatriculaCard,
          })),
        {
          loading: () => <Skeleton className="min-h-[220px] w-full rounded-2xl" />,
          ssr: false,
        },
      ),
    [],
  );

  return (
    <div className={showKycCard ? 'xl:col-span-2' : undefined}>
      <LazyTaxaMatriculaCard periodo={periodo} onPeriodoChange={onPeriodoChange} />
    </div>
  );
}

export default function DashboardClient() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetricsDataDTO | null>(null);
  const [financeKpis, setFinanceKpis] = useState<DashboardFinanceKpisDataDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [kycCardDismissed, setKycCardDismissed] = useState(false);
  const [periodoTaxaMatricula, setPeriodoTaxaMatricula] = useState<PeriodoTaxaMatricula>('1a');
  const [welcomeWizardOpen, setWelcomeWizardOpen] = useState(false);
  const { verification, loading: verificationLoading, isApproved } = useKycEnforcement();
  const handleGoToCadastro = useCallback(() => {
    router.push('/alunos');
  }, [router]);

  const fetchMetrics = useCallback(async (silent = false) => {
    if (!user?.contaId) {
      setMetrics(null);
      return;
    }

    if (!silent) setLoading(true);
    try {
      const raw = DASHBOARD_BLOCKS_ENABLED
        ? {
            success: true,
            data: Object.assign(
              emptyDashboardMetrics(),
              ...(await Promise.all(DASHBOARD_BLOCK_ENDPOINTS.map(fetchDashboardBlock))),
            ),
          }
        : await fetchLegacyMetrics(user.contaId);
      const data = mapDashboardMetricsResultToDTO(raw);

      if (data.success) {
        setMetrics(data.data);
      } else {
        console.error('[DashboardClient] Erro na resposta:', data);
      }
    } catch (error) {
      if (DASHBOARD_BLOCKS_ENABLED) {
        try {
          const fallbackRaw = await fetchLegacyMetrics(user.contaId);
          const fallbackData = mapDashboardMetricsResultToDTO(fallbackRaw);
          if (fallbackData.success) {
            setMetrics(fallbackData.data);
            return;
          }
        } catch (fallbackError) {
          console.error('[DashboardClient] Erro ao buscar métricas pelo endpoint legado:', fallbackError);
        }
      }

      console.error('[DashboardClient] Erro ao buscar métricas:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user?.contaId]);

  const fetchFinanceKpis = useCallback(async (silent = false) => {
    if (!user?.contaId) {
      setFinanceKpis(null);
      return;
    }

    if (!silent) setFinanceLoading(true);
    try {
      const response = await fetch('/api/dashboard/finance-kpis', {
        headers: { Accept: 'application/json' },
      });
      const raw = (await response.json()) as Record<string, unknown>;
      const data = mapDashboardFinanceKpisResultToDTO(raw);

      if (data.success) {
        setFinanceKpis(data.data);
      } else {
        console.error('[DashboardClient] Erro na resposta financeira:', data);
      }
    } catch (error) {
      console.error('[DashboardClient] Erro ao buscar KPI financeiro:', error);
    } finally {
      if (!silent) setFinanceLoading(false);
    }
  }, [user?.contaId]);

  const refreshDashboard = useCallback(async (silent = false) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const trackedPromise = Promise.all([
      fetchMetrics(silent),
      fetchFinanceKpis(silent),
    ]).then(() => undefined)
      .finally(() => {
        if (refreshInFlightRef.current === trackedPromise) {
          refreshInFlightRef.current = null;
        }
      });

    refreshInFlightRef.current = trackedPromise;
    return trackedPromise;
  }, [fetchFinanceKpis, fetchMetrics]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  useLiveRefresh(
    () => refreshDashboard(true),
    {
      enabled: Boolean(user?.contaId) && !loading && !financeLoading,
      intervalMs: 60_000,
      minIntervalMs: 10_000,
    },
  );

  useEffect(() => {
    if (verificationLoading) return;
    if (!verification || isApproved) {
      setKycCardDismissed(false);
    }
  }, [verification, verificationLoading, isApproved]);

  useEffect(() => {
    if (!user?.id) return;
    if (FORCE_PERSISTENT_WELCOME_WIZARD) {
      setWelcomeWizardOpen(true);
    }
  }, [user?.id]);

  const handleCompleteWelcomeWizard = async () => {
    if (FORCE_PERSISTENT_WELCOME_WIZARD) {
      setWelcomeWizardOpen(false);
      return;
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const showKycCard = !verificationLoading && Boolean(verification) && !isApproved && !kycCardDismissed;
  const isMetricsLoading = loading && !metrics;

  return (
    <>
      <section
        aria-label="Conteúdo do Dashboard"
        aria-busy={isMetricsLoading}
        className="alusa-dashboard-page flex flex-col gap-6 pb-8"
      >
        <header>
          <h1 className="text-2xl font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
            Olá, {user?.name || 'Usuário'}
          </h1>
          <p className="text-sm text-gray-500 mt-1 alusa-dark:text-[color:var(--color-text-muted)]">
            Veja o resumo das suas métricas e acompanhe o desempenho do seu negócio.
          </p>
        </header>

        <div className="grid auto-rows-fr grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {showKycCard ? (
            <div className="md:col-span-2 xl:col-span-2">
              <KycDashboardCard onDismiss={() => setKycCardDismissed(true)} />
            </div>
          ) : null}

          <div>
            <TotalAlunosCard
              total={metrics?.alunosAtivos ?? 0}
              ativos={metrics?.alunosAtivos ?? 0}
              recentStudents={(metrics?.alunosRecentes || []).map((aluno) => ({
                id: aluno.id,
                name: aluno.nome,
                avatarUrl: aluno.avatarUrl ?? aluno.foto,
              }))}
              onAddAluno={handleGoToCadastro}
              disableAddAluno={!verificationLoading && Boolean(verification) && !isApproved}
              loading={isMetricsLoading}
            />
          </div>

          <div>
            <RecebidasKpiCard data={metrics} loading={isMetricsLoading} />
          </div>

          <div className={showKycCard ? 'xl:col-span-2' : undefined}>
            <AguardandoPagamentoCard data={financeKpis} loading={financeLoading && !financeKpis} />
          </div>

          <TaxaMatriculaCardDeferred
            showKycCard={showKycCard}
            periodo={periodoTaxaMatricula}
            onPeriodoChange={(periodo) => {
              if (periodo) setPeriodoTaxaMatricula(periodo);
            }}
          />
        </div>

        <DashboardSecondarySection metrics={metrics} isMetricsLoading={isMetricsLoading} />
      </section>

      <WelcomeWizardDialog
        open={welcomeWizardOpen}
        userName={user?.name}
        onComplete={handleCompleteWelcomeWizard}
      />
    </>
  );
}
