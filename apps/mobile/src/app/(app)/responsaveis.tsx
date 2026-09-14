import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import { ResponsibleFilterSheet, type ResponsibleStatusFilter } from '@/features/responsibles/components/ResponsibleFilterSheet';
import { responsibleService } from '@/features/responsibles/services/responsible-service';
import type { Responsible } from '@/features/responsibles/types/responsible';
import { colors, radius, spacing } from '@/theme/tokens';

export default function ResponsiblesScreen() {
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ResponsibleStatusFilter>('ALL');
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await responsibleService.listResponsibles({ query: search, status: statusFilter });
      setResponsibles(response.responsibles);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os responsáveis.');
    } finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { void load(); }, [load]);
  const emptySearch = !loading && !error && responsibles.length === 0;
  const title = useMemo(() => search.trim() ? 'Nenhum responsável encontrado' : 'Nenhum responsável cadastrado', [search]);

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <InlineSearchHeader title="Responsáveis" search={search} onSearchChange={setSearch} placeholder="Procurar pelo nome" accessibilityLabel="Pesquisar responsáveis" onBack={() => router.back()} onFilterPress={() => setFilterOpen(true)} filterActive={statusFilter !== 'ALL'} />
      <View style={styles.list}>
        {loading ? <ResponsibleSkeleton /> : null}
        {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : null}
        {emptySearch ? <EmptyState variant="neutral" title={title} message={search.trim() ? 'Revise o nome pesquisado e tente novamente.' : 'Os responsáveis da conta aparecerão aqui quando forem cadastrados.'} /> : null}
        {!loading && !error ? responsibles.map((responsible) => <ResponsibleCard key={responsible.id} responsible={responsible} />) : null}
      </View>
      <ResponsibleFilterSheet visible={filterOpen} currentValue={statusFilter} onChange={setStatusFilter} onClose={() => setFilterOpen(false)} />
    </Screen>
  );
}

function ResponsibleSkeleton() {
  return <View style={skeletonStyles.list} accessibilityLabel="Carregando responsáveis">{[0, 1, 2, 3, 4].map((item) => <View key={item} style={skeletonStyles.card}><Skeleton width={44} height={44} radius={radius.pill} /><Skeleton width={`${56 + (item % 3) * 10}%`} height={18} /></View>)}</View>;
}

function ResponsibleCard({ responsible }: { responsible: Responsible }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir detalhes de ${responsible.name}`} onPress={() => router.push({ pathname: '/(app)/responsaveis/[responsibleId]', params: { responsibleId: responsible.id } })} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}><StudentAvatar name={responsible.name} photo={responsible.photo} /><View style={styles.copy}><AppText variant="body" weight="medium" numberOfLines={1}>{responsible.name}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{responsible.financial ? 'Responsável financeiro' : 'Responsável'} · {responsible.studentsCount} {responsible.studentsCount === 1 ? 'aluno' : 'alunos'}</AppText></View><View style={styles.status}><View style={[styles.dot, { backgroundColor: responsible.status === 'ATIVO' ? colors.success : colors.inkSubtle }]} /><AppText variant="tiny" weight="medium" style={{ color: responsible.status === 'ATIVO' ? colors.success : colors.inkMuted }}>{responsible.status === 'ATIVO' ? 'Ativo' : 'Inativo'}</AppText></View><ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></Pressable>;
}

const styles = StyleSheet.create({ screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] }, list: { gap: spacing.sm }, card: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral }, copy: { flex: 1, minWidth: 0, gap: spacing.xs }, status: { alignItems: 'flex-end', gap: spacing.xs }, dot: { width: 7, height: 7, borderRadius: radius.pill }, pressed: { opacity: 0.76 } });
const skeletonStyles = StyleSheet.create({ list: { gap: spacing.sm }, card: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral } });
