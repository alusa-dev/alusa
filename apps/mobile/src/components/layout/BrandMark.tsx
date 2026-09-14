import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export function BrandMark({ compact = false, centered = false, showSymbol = true }: { compact?: boolean; centered?: boolean; showSymbol?: boolean }) {
  return (
    <View style={[styles.row, centered ? styles.centered : null]}>
      {showSymbol ? (
        <View style={styles.symbol}>
          <AppText weight="bold" tone="inverse" variant="subheading">
            A
          </AppText>
        </View>
      ) : null}
      {!compact ? (
        <View>
          <AppText weight="bold" variant="subheading" style={centered ? styles.centerText : null}>
            Alusa
          </AppText>
          <AppText variant="tiny" tone="muted" style={centered ? styles.centerText : null}>
            ERP Educacional
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  centered: {
    flexDirection: 'column',
    gap: spacing.sm,
  },
  centerText: {
    textAlign: 'center',
  },
  symbol: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
});
