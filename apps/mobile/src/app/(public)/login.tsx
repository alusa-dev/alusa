import { useRef, useState } from 'react';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Controller, useForm } from 'react-hook-form';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ErrorState } from '@/components/feedback/ErrorState';
import { BrandMark } from '@/components/layout/BrandMark';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { TextField } from '@/components/primitives/TextField';
import { isApiError } from '@/lib/api/errors';
import { colors, radius, spacing } from '@/theme/tokens';
import { useLogin } from '@/features/auth/hooks/use-login';
import { loginSchema, type LoginFormValues } from '@/features/auth/schemas/login-schema';

type AuthTab = 'login' | 'create';
type FieldSymbol = 'person' | 'lock' | 'eye' | 'eyeOff' | 'school' | 'mail';

const fieldIconNames: Record<FieldSymbol, SFSymbol> = {
  person: 'person.fill',
  lock: 'lock.fill',
  eye: 'eye.fill',
  eyeOff: 'eye.slash.fill',
  school: 'building.columns.fill',
  mail: 'envelope.fill',
};

export default function LoginScreen() {
  const passwordRef = useRef<TextInput>(null);
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const login = useLogin();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(async (values) => {
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') {
          setError(field, { message: issue.message });
        }
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

  return (
    <Screen scroll keyboard style={styles.screen}>
      <View style={styles.logoWrap}>
        <BrandMark centered compact={false} />
      </View>

      <View style={styles.copy}>
        <AppText variant="display" weight="bold" style={styles.title}>
          Seja bem-vindo(a)
        </AppText>
        <AppText tone="muted" style={styles.subtitle}>
          Acesse sua conta para acompanhar a gestão escolar com segurança.
        </AppText>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        <TabButton active={activeTab === 'login'} label="Entrar" onPress={() => setActiveTab('login')} />
        <TabButton active={activeTab === 'create'} label="Criar conta" onPress={() => setActiveTab('create')} />
      </View>

      <View style={styles.form}>
        <View style={styles.sectionCopy}>
          <AppText variant="subheading" weight="bold">
            {activeTab === 'login' ? 'Entrar para continuar' : 'Solicitar acesso'}
          </AppText>
          <AppText variant="small" tone="muted">
            {activeTab === 'login'
              ? 'Use suas credenciais para acessar sua instituição.'
              : 'Informe seus dados para iniciar a criação da conta.'}
          </AppText>
        </View>

        {errorMessage ? (
          <ErrorState
            title="Acesso não concluído"
            message={errorMessage}
          />
        ) : null}

        {activeTab === 'login' ? (
          <>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  leftIcon={<FieldIcon symbol="person" />}
                  placeholder="E-mail institucional"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  accessibilityLabel="E-mail institucional"
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  ref={passwordRef}
                  leftIcon={<FieldIcon symbol="lock" />}
                  rightElement={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                      hitSlop={10}
                      onPress={() => setPasswordVisible((current) => !current)}
                    >
                      <FieldIcon symbol={passwordVisible ? 'eyeOff' : 'eye'} />
                    </Pressable>
                  }
                  placeholder="Senha"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                  secureTextEntry={!passwordVisible}
                  textContentType="password"
                  autoComplete="password"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  accessibilityLabel="Senha"
                />
              )}
            />
          </>
        ) : (
          <View style={styles.createFields}>
            <TextField
              leftIcon={<FieldIcon symbol="person" />}
              placeholder="Nome completo"
              editable={false}
              accessibilityLabel="Nome completo"
            />
            <TextField
              leftIcon={<FieldIcon symbol="school" />}
              placeholder="Nome da instituição"
              editable={false}
              accessibilityLabel="Nome da instituição"
            />
            <TextField
              leftIcon={<FieldIcon symbol="mail" />}
              placeholder="E-mail de contato"
              editable={false}
              accessibilityLabel="E-mail de contato"
            />
          </View>
        )}

        <Button
          title={activeTab === 'login' ? 'Entrar' : 'Solicitar acesso'}
          loading={login.isPending}
          disabled={activeTab === 'create'}
          onPress={activeTab === 'login' ? submit : undefined}
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => setActiveTab(activeTab === 'login' ? 'create' : 'login')}
          style={styles.switchLink}
        >
          <AppText variant="small" weight="bold" tone="accent" style={styles.switchLinkText}>
            {activeTab === 'login' ? 'Ainda não tem conta? Criar conta' : 'Já tenho conta. Entrar'}
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tabButton, active ? styles.tabButtonActive : null, pressed ? styles.pressed : null]}
    >
      <AppText weight="bold" tone={active ? 'primary' : 'muted'} style={styles.tabText}>
        {label}
      </AppText>
    </Pressable>
  );
}

function FieldIcon({ symbol }: { symbol: FieldSymbol }) {
  return <SymbolView name={fieldIconNames[symbol]} size={20} tintColor={colors.inkMuted} type="hierarchical" />;
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['3xl'],
  },
  logoWrap: {
    alignItems: 'center',
  },
  copy: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 300,
    textAlign: 'center',
  },
  tabs: {
    minHeight: 62,
    borderRadius: radius.lg,
    backgroundColor: '#F4F4F6',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
    gap: 5,
  },
  tabButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  tabText: {
    textAlign: 'center',
  },
  form: {
    gap: spacing.lg,
  },
  sectionCopy: {
    gap: spacing.xs,
  },
  createFields: {
    gap: spacing.lg,
  },
  switchLink: {
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  switchLinkText: {
    color: colors.brand,
  },
  pressed: {
    opacity: 0.86,
  },
});
