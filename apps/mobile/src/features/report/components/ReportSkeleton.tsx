import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/feedback/Skeleton';
import { colors, radius, spacing } from '@/theme/tokens';

const rows = [0, 1, 2, 3];

export function ReportSkeleton() {
  return (
    <View style={styles.container} accessibilityLabel="Carregando relatório">
      <View style={styles.filterCard}>
        <Skeleton width={58} height={14} />
        <Skeleton width="100%" height={52} radius={radius.md} />
      </View>

      <View style={styles.card}>
        <Skeleton width="52%" height={22} />
        <View style={styles.metrics}>
          {[0, 1, 2, 3].map((item) => (
            <View key={item} style={styles.metric}>
              <Skeleton width="62%" height={14} />
              <Skeleton width="78%" height={24} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.healthHeader}>
          <View style={styles.healthHeading}>
            <Skeleton width="82%" height={21} />
            <Skeleton width="76%" height={14} />
          </View>
          <Skeleton width={72} height={26} radius={radius.sm} />
        </View>
        <View style={styles.healthScoreRow}>
          <Skeleton width="42%" height={17} />
          <Skeleton width={58} height={17} />
        </View>
        <Skeleton width="100%" height={24} radius={3} />
        <Skeleton width="100%" height={38} />
      </View>

      {rows.map((item) => (
        <View key={item} style={styles.card}>
          <Skeleton width="48%" height={21} />
          <Skeleton width="82%" height={14} />
          <View style={styles.list}>
            {[0, 1, 2].map((row) => (
              <View key={row} style={styles.listRow}>
                <Skeleton width={10} height={10} radius={radius.pill} />
                <Skeleton width="58%" height={16} />
                <Skeleton width="24%" height={16} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  filterCard: { gap: spacing.sm },
  card: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.xl },
  metric: { width: '50%', gap: spacing.xs },
  healthHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  healthHeading: { minWidth: 0, flex: 1, gap: spacing.xs },
  healthScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  list: { gap: spacing.md, paddingTop: spacing.xs },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
