import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/feedback/Skeleton';
import { colors, radius, spacing } from '@/theme/tokens';

export function AgendaSkeleton() {
  return (
    <View style={styles.container} accessibilityLabel="Carregando agenda">
      <View style={styles.periodHeader}>
        <View style={styles.periodCopy}>
          <Skeleton width="42%" height={18} />
          <Skeleton width="58%" height={14} />
        </View>
        <View style={styles.periodActions}>
          <Skeleton width={36} height={36} radius={radius.pill} />
          <Skeleton width={36} height={36} radius={radius.pill} />
          <Skeleton width={36} height={36} radius={radius.pill} />
          <Skeleton width={36} height={36} radius={radius.pill} />
        </View>
      </View>
      <View style={styles.viewToggle}>
        <Skeleton width="44%" height={30} radius={radius.pill} />
        <Skeleton width="44%" height={30} radius={radius.pill} />
      </View>
      <View style={styles.dayStrip}>
        {[0, 1, 2, 3, 4, 5, 6].map((item) => (
          <View key={item} style={styles.dayItem}>
            <Skeleton width={22} height={12} />
            <Skeleton width={30} height={30} radius={radius.pill} />
          </View>
        ))}
      </View>
      <View style={styles.selectedHeader}>
        <Skeleton width="64%" height={18} />
        <Skeleton width="34%" height={14} />
      </View>
      <View style={styles.timeline}>
        {[0, 1, 2, 3, 4].map((item) => (
          <View key={item} style={styles.timelineRow}>
            <Skeleton width={42} height={12} />
            <View style={styles.eventLine}>
              <Skeleton width={item === 1 ? '72%' : item === 3 ? '54%' : '86%'} height={item === 1 ? 76 : 58} radius={radius.md} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  periodHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  periodCopy: { flex: 1, gap: spacing.sm },
  periodActions: { flexDirection: 'row', gap: spacing.sm },
  viewToggle: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral },
  dayStrip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  dayItem: { alignItems: 'center', gap: spacing.sm },
  selectedHeader: { gap: spacing.xs, paddingVertical: spacing.xs },
  timeline: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  timelineRow: { minHeight: 82, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  eventLine: { flex: 1, alignItems: 'flex-start' },
});
