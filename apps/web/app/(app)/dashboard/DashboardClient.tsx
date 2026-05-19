'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/use-current-user';
import { TotalAlunosCard } from './components/TotalAlunosCard';
import { AguardandoPagamentoCard } from './components/FinanceiroKpiCards';
import { RecebidasKpiCard } from './components/RecebidasKpiCard';
import type { PeriodoTaxaMatricula } from './components/TaxaMatriculaCard';
import { useKycEnforcement } from '@/features/kyc/KycEnforcementProvider';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { useFinanceRealtimeSync } from '@/hooks/use-finance-realtime-sync';
import { DashboardSecondaryChunkSkeleton } from './dashboard-secondary-skeletons';
import WelcomeWizardDialog from './WelcomeWizardDialog';
import type { SerializableDashboardPrefetch } from '@/lib/dashboard/prefetch-dashboard-data-serializable';
import {
  useDashboardFinanceKpisQuery,
  useDashboardMetricsQuery,
} from '@/hooks/use-dashboard-queries';

const FORCE_PERSISTENT_WELCOME_WIZARD = false;

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

const TaxaMatriculaCard = dynamic(
  () =>
    import('./components/TaxaMatriculaCard').then((m) => ({
      default: m.TaxaMatriculaCard,
    })),
  {
    loading: () => <Skeleton className="min-h-[220px] w-full rounded-2xl" />,
    ssr: false,
  },
);

type DashboardClientProps = {
  initialData?: SerializableDashboardPrefetch | null;
};

export default function DashboardClient({ initialData = null }: DashboardClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const [kycCardDismissed, setKycCardDismissed] = useState(false);
  const [periodoTaxaMatricula, setPeriodoTaxaMatricula] = useState<PeriodoTaxaMatricula>('1a');
  const [welcomeWizardOpen, setWelcomeWizardOpen] = useState(false);
  const { verification, loading: verificationLoading, isApproved } = useKycEnforcement();

  const metricsQuery = useDashboardMetricsQuery(initialData?.metrics ?? null);
  const financeKpisQuery = useDashboardFinanceKpisQuery(initialData?.financeKpis ?? null);

  const metrics = metricsQuery.data ?? null;
  const financeKpis = financeKpisQuery.data ?? null;
  const loading = metricsQuery.isLoading && !metrics;
  const financeLoading = financeKpisQuery.isLoading && !financeKpis;

  const refreshDashboard = useCallback(
    async (silent = false) => {
      if (!user?.contaId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'finance-kpis'] }),
      ]);
      if (!silent) {
        await Promise.all([metricsQuery.refetch(), financeKpisQuery.refetch()]);
      }
    },
    [financeKpisQuery, metricsQuery, queryClient, user?.contaId],
  );

  useLiveRefresh(
    () => refreshDashboard(true),
    {
      enabled: Boolean(user?.contaId) && !loading && !financeLoading,
      intervalMs: 60_000,
      minIntervalMs: 10_000,
    },
  );

  useFinanceRealtimeSync({
    enabled: Boolean(user?.contaId) && !loading && !financeLoading,
    scope: { dashboard: true, cobrancaQueries: false },
  });

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

  const handleGoToCadastro = useCallback(() => {
    router.push('/alunos');
  }, [router]);

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

          <div className={showKycCard ? 'xl:col-span-2' : undefined}>
            <TaxaMatriculaCard
              periodo={periodoTaxaMatricula}
              onPeriodoChange={(periodo) => {
                if (periodo) setPeriodoTaxaMatricula(periodo);
              }}
            />
          </div>
        </div>

        <DashboardSecondarySection metrics={metrics} isMetricsLoading={isMetricsLoading} />
      </section>

      <WelcomeWizardDialog
        open={welcomeWizardOpen}
        userName={user?.name}
        onComplete={async () => {
          setWelcomeWizardOpen(false);
        }}
      />
    </>
  );
}
