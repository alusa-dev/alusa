import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ClockIcon,
  UserGroupIcon,
} from 'react-native-heroicons/outline';
import { router } from 'expo-router';

import { Screen } from '@/components/layout/Screen';
import { SearchField } from '@/components/forms/SearchField';
import { AppText } from '@/components/primitives/AppText';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { enrollmentService } from '@/features/enrollments/services/enrollment-service';
import type { EnrollmentClass } from '@/features/enrollments/types/enrollment';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EnrollmentsScreen() {
  const [search, setSearch] = useState('');
  const [classes, setClasses] = useState<EnrollmentClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await enrollmentService.listClasses();
      setClasses(response.classes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as turmas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredClasses = useMemo(
    () => classes.filter((item) => item.name.toLocaleLowerCase().includes(normalizedSearch)),
    [classes, normalizedSearch],
  );

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium">Matrículas</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <SearchField value={search} onChangeText={setSearch} placeholder="Pesquisar turma" accessibilityLabel="Pesquisar turma" returnKeyType="search" />

      <View style={styles.list}>
        {loading ? <EnrollmentsSkeleton /> : null}
        {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadClasses()} /> : null}
        {!loading && !error && classes.length === 0 ? <EmptyState title="Nenhuma turma cadastrada" message="As turmas da conta aparecerão aqui quando forem cadastradas." /> : null}
        {!loading && !error && classes.length > 0 && filteredClasses.length === 0 ? <EmptyState title="Nenhuma turma encontrada" message="Revise o termo pesquisado e tente novamente." /> : null}
        {!loading && !error ? filteredClasses.map((classSummary) => (
          <ClassCard
            key={classSummary.id}
            classSummary={classSummary}
            onPress={() => router.push({ pathname: '/(app)/enrollments/[classId]', params: { classId: classSummary.id } })}
          />
        )) : null}
      </View>
    </Screen>
  );
}

function ClassCard({ classSummary, onPress }: { classSummary: EnrollmentClass; onPress: () => void }) {
  const { enrolled, capacity } = classSummary.occupancy;
  const occupancy = capacity > 0 ? Math.min(enrolled / capacity, 1) : 0;
  const isActive = classSummary.status === 'ATIVO';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${classSummary.name}, ${isActive ? 'turma ativa' : 'turma inativa'}, ${enrolled} de ${capacity} vagas ocupadas`}
      onPress={onPress}
      style={({ pressed }) => [styles.classCard, pressed ? styles.pressed : null]}
    >
      <View style={styles.cardHeader}>
        <AppText variant="subheading" weight="medium" numberOfLines={1}>{classSummary.name}</AppText>
        <View
          accessibilityLabel={isActive ? 'Turma ativa' : 'Turma inativa'}
          style={[styles.statusDot, isActive ? styles.statusDotActive : styles.statusDotInactive]}
        />
      </View>

      <View style={styles.detailRow}>
        <ClockIcon color={colors.inkMuted} size={16} strokeWidth={1.7} />
          <AppText variant="small" tone="muted">{classSummary.schedule.startTime} - {classSummary.schedule.endTime}</AppText>
      </View>
      <View style={styles.detailRow}>
        <CalendarDaysIcon color={colors.inkMuted} size={16} strokeWidth={1.7} />
          <AppText variant="small" tone="muted">{formatDays(classSummary.schedule.days)}</AppText>
      </View>

      <View style={styles.occupancyHeader}>
        <View style={styles.detailRow}>
          <UserGroupIcon color={colors.inkMuted} size={16} strokeWidth={1.7} />
          <AppText variant="small" tone="muted">Ocupação</AppText>
        </View>
        <AppText variant="small" tone="muted">{enrolled} / {capacity}</AppText>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressValue, { width: `${occupancy * 100}%` }]} />
      </View>
    </Pressable>
  );
}

function EnrollmentsSkeleton() {
  return (
    <View style={skeletonStyles.list} accessibilityLabel="Carregando turmas">
      {[0, 1, 2].map((item) => (
        <View key={item} style={skeletonStyles.card}>
          <View style={skeletonStyles.header}><Skeleton width="70%" height={20} /><Skeleton width={12} height={12} radius={radius.pill} /></View>
          <Skeleton width="44%" height={15} /><Skeleton width="36%" height={15} /><Skeleton width="50%" height={15} /><Skeleton width="100%" height={8} radius={radius.pill} />
        </View>
      ))}
    </View>
  );
}

function formatDays(days: string[]) {
  const labels: Record<string, string> = {
    DOM: 'Dom', DOMINGO: 'Dom',
    SEG: 'Seg', SEGUNDA: 'Seg', SEGUNDAFEIRA: 'Seg',
    TER: 'Ter', TERCA: 'Ter', TERCAFEIRA: 'Ter',
    QUA: 'Qua', QUARTA: 'Qua', QUARTAFEIRA: 'Qua',
    QUI: 'Qui', QUINTA: 'Qui', QUINTAFEIRA: 'Qui',
    SEX: 'Sex', SEXTA: 'Sex', SEXTAFEIRA: 'Sex',
    SAB: 'Sáb', SABADO: 'Sáb',
  };
  return days.map((day) => labels[day.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/gi, '').toUpperCase()] ?? day).join(', ');
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { flex: 1 },
  list: { gap: spacing.md },
  classCard: { position: 'relative', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  statusDot: { width: 11, height: 11, borderRadius: radius.pill },
  statusDotActive: { backgroundColor: colors.success },
  statusDotInactive: { backgroundColor: colors.inkSubtle },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  occupancyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  progressTrack: { height: 7, overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.border },
  progressValue: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});

const skeletonStyles = StyleSheet.create({
  list: { gap: spacing.xl },
  card: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
