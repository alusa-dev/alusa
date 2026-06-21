import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { colors, radius, spacing } from '@/theme/tokens';

type ErrorStateProps = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function ErrorState({ title, message, actionLabel, onAction }: ErrorStateProps) {
  return (
    <View style={styles.card}>
      <AppText variant="subheading" weight="bold">
        {title}
      </AppText>
      <AppText tone="muted">{message}</AppText>
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
  },
});
