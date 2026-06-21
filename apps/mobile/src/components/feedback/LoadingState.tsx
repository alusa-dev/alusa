import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { colors, spacing } from '@/theme/tokens';

export function LoadingState({ title = 'Preparando a Alusa...' }: { title?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.brand} />
      <AppText tone="muted" style={styles.text}>
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  text: {
    textAlign: 'center',
  },
});
