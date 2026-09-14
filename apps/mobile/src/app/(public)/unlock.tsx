import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Keyboard, Modal, Pressable, StyleSheet, View } from 'react-native';
import { FaceSmileIcon, EyeIcon, EyeSlashIcon, XMarkIcon } from 'react-native-heroicons/outline';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { AppText } from '@/components/primitives/AppText';
import { Screen } from '@/components/layout/Screen';
import { TextField } from '@/components/primitives/TextField';
import { authService } from '@/features/auth/services/auth-service';
import {
  clearBiometricSession,
  establishBiometricSession,
  establishSession,
} from '@/features/session/services/session-service';
import { readBiometricSession } from '@/features/session/services/session-storage';
import { useSession } from '@/features/session/hooks/use-session';
import { useSessionStore } from '@/features/session/stores/session-store';
import { isApiError } from '@/lib/api/errors';
import { colors, radius, spacing } from '@/theme/tokens';

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(3, Math.min(name.length, 5)))}@${domain}`;
}

function initials(name?: string | null, email?: string) {
  const source = name?.trim() || email?.trim() || 'A';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function UnlockScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { lockedProfile, savedProfile } = useSession();
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [faceIdPending, setFaceIdPending] = useState(false);
  const [faceIdFailed, setFaceIdFailed] = useState(false);
  const showPasswordFallback = reason !== 'app-resume';
  const [error, setError] = useState<string | null>(null);
  const attemptedAutomatically = useRef(false);

  const profile = lockedProfile ?? savedProfile;
  const maskedEmail = useMemo(() => (profile ? maskEmail(profile.user.email) : ''), [profile]);

  const unlockWithFaceId = useCallback(async () => {
    if (faceIdPending) return;
    setFaceIdPending(true);
    setFaceIdFailed(false);
    setError(null);

    try {
      if (!profile?.biometricEnabled) throw new Error('Biometric access unavailable');
      const persistedSession = await readBiometricSession(profile);
      if (!persistedSession?.refreshToken) throw new Error('Biometric session unavailable');

      const session = await authService.refresh(
        persistedSession.refreshToken,
        persistedSession.activeContaId,
      );
      await establishBiometricSession(session);
      router.replace('/(app)');
    } catch (requestError) {
      if (profile && isApiError(requestError) && requestError.code === 'UNAUTHORIZED') {
        const updatedProfile = await clearBiometricSession(profile);
        useSessionStore.getState().setSavedProfile(updatedProfile);
      }
      setFaceIdFailed(true);
    } finally {
      setFaceIdPending(false);
    }
  }, [faceIdPending, profile]);

  useEffect(() => {
    if (profile?.biometricEnabled && !attemptedAutomatically.current) {
      attemptedAutomatically.current = true;
      void unlockWithFaceId();
    }
  }, [profile, unlockWithFaceId]);

  async function unlockWithPassword() {
    if (!profile || !password.trim() || faceIdPending) return;
    Keyboard.dismiss();
    setError(null);

    try {
      const session = await authService.login({
        email: profile.user.email,
        password,
        contaId: profile.activeContaId,
      });
      if (profile.biometricEnabled) {
        try {
          await establishBiometricSession(session);
        } catch {
          await clearBiometricSession(profile);
          await establishSession(session);
        }
      } else {
        await establishSession(session);
      }
      router.replace('/(app)');
    } catch (requestError) {
      setError(isApiError(requestError) ? requestError.message : 'Não foi possível acessar a Alusa agora.');
    }
  }

  if (!profile) return null;

  return (
    <Screen keyboard backgroundColor={colors.white} style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <AppText variant="subheading" weight="medium" tone="inverse">
              {initials(profile.user.name, profile.user.email)}
            </AppText>
          </View>
          <View style={styles.profileCopy}>
            <AppText variant="subheading" weight="medium" numberOfLines={1}>
              {profile.user.name || 'Usuário Alusa'}
            </AppText>
            <AppText variant="body" tone="muted" numberOfLines={1}>
              {maskedEmail}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Trocar usuário"
            onPress={() => router.push('/select-account')}
            style={({ pressed }) => [styles.changeButton, pressed ? styles.pressed : null]}
          >
            <AppText weight="medium" tone="primary">Trocar</AppText>
          </Pressable>
        </View>

        <AppText variant="heading" weight="medium" style={styles.title}>
          {reason === 'app-resume' ? 'Confirme sua identidade' : 'Digite sua senha'}
        </AppText>

        {showPasswordFallback ? (
          <>
            <TextField
              placeholder="Senha"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setError(null);
              }}
              secureTextEntry={!passwordVisible}
              textContentType="password"
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={unlockWithPassword}
              accessibilityLabel="Senha do aplicativo"
              shellStyle={styles.inputShell}
              style={styles.input}
              rightElement={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                  hitSlop={10}
                  onPress={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? <EyeSlashIcon size={22} color={colors.inkMuted} /> : <EyeIcon size={22} color={colors.inkMuted} />}
                </Pressable>
              }
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Entrar"
              accessibilityState={{ disabled: !password.trim() || faceIdPending, busy: faceIdPending }}
              disabled={!password.trim() || faceIdPending}
              onPress={unlockWithPassword}
              style={({ pressed }) => [
                styles.enterButton,
                !password.trim() || faceIdPending ? styles.disabledButton : null,
                pressed && password.trim() && !faceIdPending ? styles.pressed : null,
              ]}
            >
              {faceIdPending ? <ActivityIndicator color={colors.inkMuted} /> : <AppText variant="subheading" weight="medium">Entrar</AppText>}
            </Pressable>
          </>
        ) : null}

        {profile.biometricEnabled ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Entrar com Face ID"
            accessibilityState={{ busy: faceIdPending }}
            disabled={faceIdPending}
            onPress={() => void unlockWithFaceId()}
            style={({ pressed }) => [styles.faceIdButton, pressed && !faceIdPending ? styles.pressed : null]}
          >
            <FaceSmileIcon size={30} color={colors.brand} strokeWidth={1.7} />
            <AppText weight="medium" tone="primary">{faceIdFailed ? 'Tentar novamente' : 'Entrar com Face ID'}</AppText>
          </Pressable>
        ) : null}

        {faceIdFailed && reason === 'app-resume' ? (
          <AppText variant="small" tone="muted" style={styles.retryHint}>
            Tente o Face ID novamente ou use o código de desbloqueio do aparelho.
          </AppText>
        ) : null}

        {showPasswordFallback ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/forgot-password')} style={styles.forgotLink}>
            <AppText weight="medium" tone="primary">Esqueci minha senha</AppText>
          </Pressable>
        ) : null}
      </View>

      <UnlockErrorModal message={error} onClose={() => setError(null)} />
    </Screen>
  );
}

function UnlockErrorModal({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <Modal visible={Boolean(message)} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <Animated.View entering={FadeIn.duration(220)} style={styles.modalBackdrop} />
        <Animated.View entering={SlideInDown.duration(260)} style={styles.errorSheet}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar mensagem de erro" hitSlop={12} onPress={onClose}>
            <XMarkIcon size={30} color={colors.inkMuted} strokeWidth={1.5} />
          </Pressable>
          <AppText variant="display" weight="medium" style={styles.errorTitle}>Ops, algo está errado</AppText>
          <AppText variant="heading" tone="muted" style={styles.errorMessage}>
            Verifique sua senha e tente novamente.
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Entendi" onPress={onClose} style={styles.dismissButton}>
            <AppText variant="subheading" weight="medium">Entendi</AppText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  content: { flex: 1, paddingTop: spacing['3xl'], gap: spacing.lg },
  profileCard: {
    minHeight: 92,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCopy: { flex: 1, gap: spacing.xs },
  changeButton: { padding: spacing.sm },
  title: { fontSize: 30, lineHeight: 36, marginTop: spacing.xl },
  inputShell: {
    minHeight: 64,
    borderRadius: 0,
    backgroundColor: colors.white,
    paddingHorizontal: 0,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  input: { minHeight: 64, paddingVertical: spacing.sm, backgroundColor: colors.white, fontSize: 22 },
  enterButton: {
    minHeight: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    marginTop: spacing.lg,
  },
  disabledButton: { backgroundColor: colors.border },
  faceIdButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  passwordFallback: { alignItems: 'center', paddingVertical: spacing.sm },
  forgotLink: { alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.sm },
  retryHint: { textAlign: 'center', marginTop: -spacing.sm },
  pressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  modalContainer: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.78)' },
  errorSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
    gap: spacing.lg,
  },
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
