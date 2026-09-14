import { useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ChevronLeftIcon } from 'react-native-heroicons/outline';

import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { authService } from '@/features/auth/services/auth-service';
import { isApiError } from '@/lib/api/errors';
import { colors, spacing } from '@/theme/tokens';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await authService.requestPasswordReset({ email: email.trim() });
      setStatus('success');
    } catch (requestError) {
      setError(isApiError(requestError) ? requestError.message : 'Não foi possível continuar agora.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen keyboard backgroundColor={colors.white} style={styles.screen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Voltar para o login"
        hitSlop={12}
        onPress={() => router.back()}
        style={styles.backButton}
      >
        <ChevronLeftIcon size={32} color={colors.inkMuted} strokeWidth={1.5} />
      </Pressable>

      <View style={styles.content}>
        {status === 'success' ? (
          <>
            <AppText variant="heading" weight="medium" style={styles.title}>
              Confira seu e-mail
            </AppText>
            <AppText variant="heading" tone="muted" style={styles.subtitle}>
              Enviamos as instruções para recuperar o acesso ao aplicativo.
            </AppText>
          </>
        ) : (
          <>
            <AppText variant="heading" weight="medium" style={styles.title}>
              Esqueci minha senha
            </AppText>
            <AppText variant="heading" tone="muted" style={styles.subtitle}>
              Digite seu e-mail para recuperar o acesso ao aplicativo
            </AppText>

            <TextField
              placeholder="seu@email.com"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setError(null);
              }}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submit}
              error={error ?? undefined}
              accessibilityLabel="E-mail para recuperação de senha"
              shellStyle={styles.underlineShell}
              style={styles.input}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar instruções de recuperação"
              accessibilityState={{ disabled: !email.trim() || isSubmitting }}
              disabled={!email.trim() || isSubmitting}
              onPress={submit}
              style={({ pressed }) => [
                styles.action,
                !email.trim() || isSubmitting ? styles.actionDisabled : null,
                pressed && email.trim() && !isSubmitting ? styles.pressed : null,
              ]}
            >
              {isSubmitting ? <ActivityIndicator color={colors.white} /> : <AppText style={styles.arrow}>→</AppText>}
            </Pressable>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  backButton: {
    alignSelf: 'flex-start',
    width: 42,
    height: 42,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingTop: spacing['3xl'],
    gap: spacing.xl,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    maxWidth: 340,
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
    maxWidth: 340,
  },
  input: {
    minHeight: 64,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    fontSize: 22,
  },
  underlineShell: {
    minHeight: 64,
    borderRadius: 0,
    backgroundColor: colors.white,
    paddingHorizontal: 0,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    gap: 0,
  },
  action: {
    alignSelf: 'flex-end',
    width: 72,
    height: 72,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    marginTop: spacing.xl,
  },
  actionDisabled: {
    backgroundColor: colors.border,
  },
  arrow: {
    color: colors.white,
    fontSize: 34,
    lineHeight: 36,
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },
});
