import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { Skeleton } from '@/components/feedback/Skeleton';
import { AppText } from '@/components/primitives/AppText';
import type { MobileEventFinancialEntry } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

export function EventFinancialEntryList({
  entries,
  onEntryPress,
}: {
  entries: MobileEventFinancialEntry[];
  onEntryPress: (_entry: MobileEventFinancialEntry) => void;
}) {
  return (
    <View style={styles.entryList}>
      {entries.map((entry) => (
        <FinancialEntryRow key={entry.id} entry={entry} onPress={() => onEntryPress(entry)} />
      ))}
    </View>
  );
}

export function FinancialEntryRow({
  entry,
  onPress,
}: {
  entry: MobileEventFinancialEntry;
  onPress: () => void;
}) {
  const tone = getFinancialEntryTone(entry);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.type === 'COST' ? 'Custo' : 'Receita'}: ${entry.description}, ${financialEntryStatusLabel(entry.status)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.entryRow, pressed ? styles.pressed : null]}
    >
      <View style={[styles.entryDot, { backgroundColor: tone }]} />
      <View style={styles.entryCopy}>
        <AppText weight="medium" numberOfLines={1}>{entry.description}</AppText>
        <AppText variant="small" tone="muted" numberOfLines={1}>{entry.type === 'COST' ? 'Custo' : 'Receita'} · {entry.category}</AppText>
      </View>
      <View style={styles.entryAmount}>
        <AppText variant="small" weight="medium" numberOfLines={1} adjustsFontSizeToFit style={{ color: tone }}>{formatFinancialCurrency(entry.expectedAmount)}</AppText>
        <AppText variant="tiny" tone="muted" numberOfLines={1}>{financialEntryStatusLabel(entry.status)}</AppText>
      </View>
      <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} style={styles.entryArrow} />
    </Pressable>
  );
}

export function EventFinancialEntryListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.entryList} accessibilityLabel="Carregando lançamentos financeiros">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.entryRow}>
          <Skeleton width={10} height={10} radius={radius.pill} />
          <View style={styles.entryCopy}>
            <Skeleton width={`${54 + (index % 3) * 10}%`} height={17} />
            <Skeleton width="70%" height={13} />
          </View>
          <View style={styles.entryAmount}>
            <Skeleton width={82} height={17} />
            <Skeleton width={56} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EventFinancialListFooter({
  hasMore,
  loading,
  error,
  onRetry,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore?: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.brand} />
        <AppText variant="small" tone="muted">Carregando mais lançamentos...</AppText>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.footer}>
        <AppText variant="small" tone="muted" numberOfLines={2}>{error}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Tentar carregar mais lançamentos" onPress={onRetry} hitSlop={8}>
          <AppText variant="small" weight="medium" style={styles.footerAction}>Tentar novamente</AppText>
        </Pressable>
      </View>
    );
  }

  if (hasMore && onLoadMore) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Carregar mais lançamentos" onPress={onLoadMore} hitSlop={8} style={({ pressed }) => [styles.loadMore, pressed ? styles.pressed : null]}>
        <AppText variant="small" weight="medium" style={styles.footerAction}>Carregar mais lançamentos</AppText>
      </Pressable>
    );
  }

  if (!hasMore) return <AppText variant="small" tone="muted" style={styles.endMessage}>Fim da lista</AppText>;
  return null;
}

export function getFinancialEntryTone(entry: MobileEventFinancialEntry) {
  if (['CANCELLED', 'REFUNDED'].includes(entry.status)) return colors.danger;
  if (['PAID', 'RECEIVED'].includes(entry.status)) return colors.success;
  return entry.type === 'REVENUE' ? colors.info : colors.warning;
}

export function financialEntryStatusLabel(status: string) {
  const labels: Record<string, string> = {
    EXPECTED: 'Previsto',
    PENDING: 'Pendente',
    PAID: 'Pago',
    RECEIVED: 'Recebido',
    CANCELLED: 'Cancelado',
    REFUNDED: 'Estornado',
    PARTIALLY_REFUNDED: 'Estorno parcial',
  };
  return labels[status] ?? status;
}

export function formatFinancialCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

const styles = StyleSheet.create({
  entryList: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  entryRow: { position: 'relative', minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingRight: spacing['3xl'], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  entryDot: { width: 10, height: 10, borderRadius: radius.pill },
  entryCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  entryAmount: { width: 104, alignItems: 'flex-end', gap: spacing.xs },
  entryArrow: { position: 'absolute', right: spacing.sm },
  footer: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  footerAction: { color: colors.brand },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  endMessage: { textAlign: 'center', paddingVertical: spacing.lg },
  pressed: { opacity: 0.74 },
});
