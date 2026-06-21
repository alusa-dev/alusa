import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

type ScreenProps = ViewProps & {
  scroll?: boolean;
  keyboard?: boolean;
};

export function Screen({ children, style, scroll = false, keyboard = false, ...props }: ScreenProps) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={[styles.scrollContent, style]} keyboardShouldPersistTaps="handled" {...props}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, style]} {...props}>
      {children}
    </View>
  );

  const wrapped = keyboard ? (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {wrapped}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceSoft,
  },
  fill: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.xl,
  },
});
