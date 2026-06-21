import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.card}>
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
});
