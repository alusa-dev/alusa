import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export function EmptyState({ title, message, variant = 'outlined' }: { title: string; message: string; variant?: 'outlined' | 'neutral' }) {
  return (
    <View style={[styles.card, variant === 'neutral' ? styles.neutralCard : null]}>
      <AppText variant="subheading" weight="bold">
        {title}
      </AppText>
      <AppText tone="muted">{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  neutralCard: {
    borderWidth: 0,
    backgroundColor: colors.surfaceNeutral,
  },
});
