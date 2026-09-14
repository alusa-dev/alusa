import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { FunnelIcon } from 'react-native-heroicons/outline';
import { router } from 'expo-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Screen } from '@/components/layout/Screen';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReportFilterSheet } from '@/features/report/components/ReportFilterSheet';
import { useAppRefresh } from '@/hooks/use-app-refresh';
import { ReportOverview } from '@/features/report/components/ReportOverview';
import { ReportSkeleton } from '@/features/report/components/ReportSkeleton';
import { reportService } from '@/features/report/services/report-service';
import type { ReportPeriod, ReportResponse } from '@/features/report/types/report';
import { colors, spacing } from '@/theme/tokens';

const periodOptions: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'this-month', label: 'Este mês' },
  { value: 'previous-month', label: 'Mês anterior' },
  { value: 'last-3-months', label: 'Últimos 3 meses' },
];

export default function ReportScreen() {
  const [period, setPeriod] = useState<ReportPeriod>('this-month');
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<ReportPeriod>('this-month');

  const loadReport = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      setData(await reportService.get(period));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o relatório agora.');
      if (!options.silent) setData(null);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const { refreshing, refresh } = useAppRefresh(
    () => loadReport({ silent: true }),
    { intervalMs: null },
  );

  const openFilters = useCallback(() => {
    setDraftPeriod(period);
    setFilterVisible(true);
  }, [period]);

  const applyFilters = useCallback(() => {
    setPeriod(draftPeriod);
    setFilterVisible(false);
  }, [draftPeriod]);

  const clearFilters = useCallback(() => {
    setDraftPeriod('this-month');
  }, []);

  return (
    <Screen
      scroll
      backgroundColor={colors.surface}
      style={styles.screen}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      <PageHeader
        title="Relatório"
        onBack={() => router.back()}
        rightElement={(
          <Pressable accessibilityRole="button" accessibilityLabel="Filtrar relatório" hitSlop={8} onPress={openFilters} style={styles.filterButton}>
            <FunnelIcon color={colors.brand} size={23} strokeWidth={1.8} />
          </Pressable>
        )}
      />

      {loading ? <ReportSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadReport()} /> : null}
      {!loading && !error && data ? <ReportOverview data={data} /> : null}

      <ReportFilterSheet
        visible={filterVisible}
        period={draftPeriod}
        options={periodOptions}
        onPeriodChange={setDraftPeriod}
        onClear={clearFilters}
        onApply={applyFilters}
        onClose={() => setFilterVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: 116 },
  filterButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
