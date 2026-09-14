import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/feedback/Skeleton';
import { colors, radius, spacing } from '@/theme/tokens';

export function EventListSkeleton() {
  return (
    <View style={styles.list} accessibilityLabel="Carregando eventos">
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.eventCard}>
          <View style={styles.eventCopy}>
            <Skeleton width={`${58 + (item % 3) * 8}%`} height={18} />
            <Skeleton width="48%" height={15} />
            <Skeleton width="72%" height={14} />
          </View>
          <Skeleton width={72} height={24} radius={radius.pill} />
        </View>
      ))}
    </View>
  );
}

export function EventDetailSkeleton() {
  return (
    <View style={styles.detail} accessibilityLabel="Carregando evento">
      <View style={styles.heroCard}>
        <Skeleton width="72%" height={24} />
        <Skeleton width="36%" height={30} />
        <Skeleton width="58%" height={16} />
        <Skeleton width="44%" height={16} />
      </View>
      <View style={styles.summaryCard}>
        <Skeleton width="42%" height={20} />
        <View style={styles.metricGrid}>
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} width="45%" height={54} radius={radius.md} />)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  eventCard: { minHeight: 96, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  eventCopy: { flex: 1, gap: spacing.sm },
  detail: { gap: spacing.lg },
  heroCard: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  summaryCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.md },
});
