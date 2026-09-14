import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ChevronLeftIcon,
  ExclamationCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  XMarkIcon,
} from 'react-native-heroicons/outline';
import { ActivityIndicator, Keyboard, Modal, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOutLeft,
  FadeOutRight,
  SlideInDown,
} from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { isApiError } from '@/lib/api/errors';
import { colors, radius, spacing } from '@/theme/tokens';
import { useLogin } from '@/features/auth/hooks/use-login';
import { loginSchema, type LoginFormValues } from '@/features/auth/schemas/login-schema';

type LoginStep = 'welcome' | 'email' | 'password';

export default function LoginScreen() {
  const [step, setStep] = useState<LoginStep>('welcome');
  const [transitionDirection, setTransitionDirection] = useState<'forward' | 'back'>('forward');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const login = useLogin();
  const {
    control,
    handleSubmit,
    setError,
    trigger,
    watch,
    formState: { errors },
  } = useForm<LoginFormValues>({
    defaultValues: { email: '', password: '' },
    mode: 'onChange',
  });

  const email = watch('email');

  async function continueFromEmail() {
    if (await trigger('email')) navigateToStep('password', 'forward');
  }

  function navigateToStep(nextStep: LoginStep, direction: 'forward' | 'back') {
    setTransitionDirection(direction);
    setStep(nextStep);
  }

  const submit = handleSubmit(async (values) => {
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') setError(field, { message: issue.message });
      }
      return;
    }

    Keyboard.dismiss();
    await login.mutateAsync(parsed.data).catch(() => undefined);
  });

  const errorMessage = login.error
    ? isApiError(login.error)
      ? login.error.message
      : 'Não foi possível acessar a Alusa agora.'
    : null;

  if (step === 'welcome') {
    return (
      <Screen keyboard backgroundColor={colors.white} style={styles.welcomeScreen}>
        <Animated.View
          entering={transitionDirection === 'back' ? FadeInLeft.duration(280) : FadeIn.duration(280)}
          exiting={FadeOutLeft.duration(240)}
          style={styles.transition}
        >
          <View style={styles.welcomeCopy}>
            <AppText variant="display" weight="medium" style={styles.welcomeTitle}>
              Uma vida escolar sem complexidades
            </AppText>
            <PrimaryAction title="Começar" onPress={() => navigateToStep('email', 'forward')} />
          </View>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen keyboard backgroundColor={colors.white} style={styles.formScreen}>
      <Animated.View
        key={step}
        entering={transitionDirection === 'forward' ? FadeInRight.duration(280) : FadeInLeft.duration(280)}
        exiting={transitionDirection === 'forward' ? FadeOutLeft.duration(240) : FadeOutRight.duration(240)}
        style={styles.transition}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={12}
          onPress={() => navigateToStep(step === 'password' ? 'email' : 'welcome', 'back')}
          style={styles.backButton}
        >
          <ChevronLeftIcon size={32} color={colors.inkMuted} strokeWidth={1.5} />
        </Pressable>

        <View style={styles.formContent}>
          {step === 'email' ? (
          <>
            <AppText variant="heading" weight="medium" style={styles.formTitle}>
              Boas-vindas à Alusa! Qual é o seu e-mail?
            </AppText>
            <AppText variant="heading" tone="muted" style={styles.formSubtitle}>
              Precisamos dele para iniciar o seu{`\n`}acesso ou cadastrar você no aplicativo
            </AppText>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  placeholder="seu@email.com"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={continueFromEmail}
                  accessibilityLabel="E-mail"
                  shellStyle={[styles.underlineShell, errors.email ? styles.errorUnderlineShell : null]}
                  errorStyle={styles.fieldError}
                  rightElement={errors.email ? <ExclamationCircleIcon size={28} color={colors.danger} /> : undefined}
                  style={styles.underlinedInput}
                />
              )}
            />
            <CircleAction
              accessibilityLabel="Continuar para a senha"
              disabled={!email || Boolean(errors.email)}
              onPress={continueFromEmail}
            />
          </>
          ) : (
          <>
            <AppText variant="heading" weight="medium" style={styles.formTitle}>
              Agora digite sua{`\n`}senha do aplicativo
            </AppText>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  rightElement={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                      hitSlop={10}
                      onPress={() => setPasswordVisible((current) => !current)}
                    >
                      {passwordVisible ? (
                        <EyeSlashIcon size={22} color={colors.inkMuted} />
                      ) : (
                        <EyeIcon size={22} color={colors.inkMuted} />
                      )}
                    </Pressable>
                  }
                  placeholder="Digite sua senha"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                  secureTextEntry={!passwordVisible}
                  textContentType="password"
                  autoComplete="password"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  accessibilityLabel="Senha do aplicativo"
                  shellStyle={styles.underlineShell}
                  style={styles.underlinedInput}
                />
              )}
            />
            <AppText variant="body" weight="medium" style={styles.passwordHint}>
              Essa é a senha que você cadastrou quando criou sua conta.
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => router.push('/forgot-password')} style={styles.forgotLink}>
              <AppText variant="body" weight="medium" tone="primary" style={styles.forgotLinkText}>
                Esqueci a senha →
              </AppText>
            </Pressable>
            <CircleAction
              accessibilityLabel="Entrar na Alusa"
              disabled={login.isPending}
              loading={login.isPending}
              onPress={submit}
            />
          </>
          )}
        </View>
      </Animated.View>
      <LoginErrorModal message={errorMessage} onClose={() => login.reset()} />
    </Screen>
  );
}

function LoginErrorModal({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <Modal visible={Boolean(message)} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <Animated.View entering={FadeIn.duration(220)} style={styles.modalBackdrop} />
        <Animated.View entering={SlideInDown.duration(260)} style={styles.errorSheet}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar mensagem de erro"
            hitSlop={12}
            onPress={onClose}
            style={styles.closeButton}
          >
            <XMarkIcon size={30} color={colors.inkMuted} strokeWidth={1.5} />
          </Pressable>
          <AppText variant="display" weight="medium" style={styles.errorTitle}>
            Ops, algo está errado
          </AppText>
          <AppText variant="heading" tone="muted" style={styles.errorMessage}>
            Por favor, verifique seu e-mail e sua senha e tente novamente.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Entendi"
            onPress={onClose}
            style={({ pressed }) => [styles.dismissButton, pressed ? styles.pressed : null]}
          >
            <AppText variant="subheading" weight="medium">Entendi</AppText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function PrimaryAction({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.primaryAction, pressed ? styles.pressed : null]}
    >
      <AppText variant="subheading" weight="bold" tone="inverse">{title}</AppText>
    </Pressable>
  );
}

function CircleAction({
  accessibilityLabel,
  disabled,
  loading = false,
  onPress,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled), busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.circleAction,
        disabled ? styles.circleActionDisabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.inkMuted} /> : <AppText style={styles.arrow}>→</AppText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  welcomeScreen: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing.xl,
  },
  welcomeCopy: { gap: spacing.xl, marginTop: 'auto', paddingBottom: spacing.xl },
  transition: { flex: 1 },
  welcomeTitle: { fontSize: 32, lineHeight: 37, maxWidth: 340, textAlign: 'left' },
  primaryAction: {
    minHeight: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
  },
  formScreen: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  backButton: { alignSelf: 'flex-start', width: 42, height: 42, justifyContent: 'center' },
  formContent: { flex: 1, paddingTop: spacing['3xl'], gap: spacing.xl },
  formTitle: { fontSize: 30, lineHeight: 36, maxWidth: 360 },
  formSubtitle: { fontSize: 18, lineHeight: 26, maxWidth: 340 },
  underlinedInput: {
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
  errorUnderlineShell: { borderBottomColor: colors.danger },
  fieldError: { fontSize: 16, lineHeight: 22 },
  passwordHint: { marginTop: -spacing.md, fontSize: 16, lineHeight: 24, maxWidth: 320 },
  forgotLink: { alignSelf: 'flex-start', marginTop: -spacing.sm, paddingVertical: spacing.sm },
  forgotLinkText: { color: colors.brand },
  circleAction: {
    alignSelf: 'flex-end',
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    marginTop: spacing.xl,
  },
  circleActionDisabled: { backgroundColor: colors.border },
  arrow: { color: colors.white, fontSize: 34, lineHeight: 36 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  errorSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
    gap: spacing.lg,
  },
  closeButton: { alignSelf: 'flex-start', padding: spacing.xs },
  errorTitle: { fontSize: 30, lineHeight: 36 },
  errorMessage: { fontSize: 20, lineHeight: 28 },
  dismissButton: {
    minHeight: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F1F1',
    marginTop: spacing.md,
  },
});
