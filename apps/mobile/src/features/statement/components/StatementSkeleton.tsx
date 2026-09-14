import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/feedback/Skeleton';
import { colors, radius, shadows, spacing } from '@/theme/tokens';

const movementSkeletons = [0, 1, 2, 3];

export function StatementSkeleton() {
  return (
    <View style={styles.container} accessibilityLabel="Carregando extrato">
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Skeleton width="58%" height={22} />
        </View>
        <View style={styles.summaryBody}>
          {[0, 1, 2].map((item) => (
            <View key={item} style={[styles.summaryMetric, item === 2 ? styles.summaryMetricLast : null]}>
              <Skeleton width="78%" height={16} />
              <Skeleton width="38%" height={25} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.movementsSection}>
        <View style={styles.sectionHeader}>
          <Skeleton width="58%" height={22} />
          <Skeleton width={28} height={28} radius={radius.pill} />
        </View>
        {movementSkeletons.map((item) => (
          <View key={item} style={styles.movementCard}>
            <Skeleton width={28} height={28} radius={radius.pill} />
            <View style={styles.movementCopy}>
              <Skeleton width="76%" height={18} />
              <Skeleton width="88%" height={15} />
              <Skeleton width="32%" height={13} />
            </View>
            <View style={styles.movementAside}>
              <Skeleton width={66} height={13} />
              <Skeleton width={82} height={18} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  summaryCard: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral, ...shadows.soft },
  summaryHeader: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.xl },
  summaryBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  summaryMetric: { gap: spacing.xs, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryMetricLast: { borderBottomWidth: 0 },
  movementsSection: { gap: spacing.md },
  sectionHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  movementCard: { minHeight: 108, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  movementCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  movementAside: { minWidth: 82, alignItems: 'flex-end', gap: spacing.xs },
});
