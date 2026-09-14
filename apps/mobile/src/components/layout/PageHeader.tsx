import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { ArrowLeftIcon } from 'react-native-heroicons/outline';

import { AppText } from '@/components/primitives/AppText';
import { colors, spacing } from '@/theme/tokens';

type PageHeaderProps = {
  title: string;
  onBack: () => void;
  rightElement?: ReactNode;
};

export function PageHeader({ title, onBack, rightElement }: PageHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={10}
        onPress={onBack}
        style={styles.backButton}
      >
        <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
      </Pressable>
      <AppText variant="heading" weight="medium" numberOfLines={1} style={styles.title}>{title}</AppText>
      {rightElement ? <View style={styles.rightElement}>{rightElement}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1 },
  rightElement: { minWidth: 28, alignItems: 'flex-end', justifyContent: 'center' },
});
