import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { ChatBubbleLeftRightIcon, CheckCircleIcon, EnvelopeIcon, EyeIcon, EyeSlashIcon } from 'react-native-heroicons/outline';
import { useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { OtpCodeField } from '@/components/forms/OtpCodeField';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { TextField } from '@/components/primitives/TextField';
import { authService } from '@/features/auth/services/auth-service';
import { passwordChangeService, type PasswordChangeChannel } from '@/features/auth/services/password-change-service';
import { useSession } from '@/features/session/hooks/use-session';
import { isPasswordPolicyValid, passwordMinLength, passwordPolicyMessage } from '@/lib/password-policy';
import { colors, radius, spacing } from '@/theme/tokens';

type WizardStep = 'channel' | 'otp' | 'password' | 'success';
type LoadingAction = 'send' | 'verify' | 'complete' | null;

export default function ChangePasswordScreen() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [step, setStep] = useState<WizardStep>('channel');
  const [channel, setChannel] = useState<PasswordChangeChannel>('email');
  const [challengeId, setChallengeId] = useState('');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [verificationExpiresAt, setVerificationExpiresAt] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revokeAllSessions, setRevokeAllSessions] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [error, setError] = useState('');

  const cooldownSeconds = resendAvailableAt
    ? Math.max(0, Math.ceil((new Date(resendAvailableAt).getTime() - now) / 1000))
    : 0;
  const loading = loadingAction !== null;
  const passwordScore = useMemo(() => [
    newPassword.length >= passwordMinLength,
    /[A-Z]/.test(newPassword),
    /[a-z]/.test(newPassword),
    /\d/.test(newPassword),
    /[!@#$%^&*]/.test(newPassword),
  ].filter(Boolean).length, [newPassword]);

  useEffect(() => {
    if (step !== 'otp' && step !== 'password') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  async function sendCode(selectedChannel: PasswordChangeChannel = channel) {
    if (!session || loading) return;
    setLoadingAction('send');
    setError('');
    try {
      const result = await passwordChangeService.requestCode(selectedChannel);
      setChannel(selectedChannel);
      setChallengeId(result.challengeId);
      setDestination(result.destination);
      setResendAvailableAt(result.resendAvailableAt);
      setCode('');
      setNow(Date.now());
      setStep('otp');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Não foi possível enviar o código.';
      setError(message);
    } finally {
      setLoadingAction(null);
    }
  }

  async function verifyCode() {
    if (!session || loading || code.length !== 6) return;
    setLoadingAction('verify');
    setError('');
    try {
      const result = await passwordChangeService.verifyCode({ challengeId, code });
      setVerificationToken(result.verificationToken);
      setVerificationExpiresAt(result.verificationExpiresAt);
      setStep('password');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Não foi possível validar o código.');
    } finally {
      setLoadingAction(null);
    }
  }

  async function finish() {
    if (!session || loading) return;
    if (!isPasswordPolicyValid(newPassword)) {
      setError(passwordPolicyMessage);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (!verificationToken || (verificationExpiresAt && new Date(verificationExpiresAt).getTime() <= Date.now())) {
      setError('A confirmação expirou. Inicie o processo novamente.');
      return;
    }

    setLoadingAction('complete');
    setError('');
    try {
      const result = await passwordChangeService.complete({
        challengeId,
        verificationToken,
        newPassword,
        confirmPassword,
        revokeAllSessions,
      });

      if (result.revokedAllSessions) {
        await authService.logout(queryClient);
        router.replace('/(public)/login');
        return;
      }
      setStep('success');
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : 'Não foi possível atualizar a senha.');
    } finally {
      setLoadingAction(null);
    }
  }

  function goBack() {
    if (loading) return;
    if (step === 'channel') {
      router.back();
    } else if (step === 'otp') {
      setError('');
      setStep('channel');
    } else if (step === 'password') {
      setError('');
      setStep('otp');
    } else {
      router.back();
    }
  }

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <PageHeader title="Alterar senha" onBack={goBack} />
      <View style={styles.content}>
        <AppText variant="subheading" weight="medium">
          {step === 'channel' ? 'Confirme sua identidade' : step === 'otp' ? 'Digite o código' : step === 'password' ? 'Crie sua nova senha' : 'Senha alterada'}
        </AppText>
        <AppText tone="muted" style={styles.description}>
          {step === 'channel'
            ? 'Escolha onde deseja receber o código de segurança.'
            : step === 'otp'
              ? `Enviamos um código de 6 dígitos para ${destination}.`
              : step === 'password'
                ? 'Use uma senha forte e exclusiva para proteger sua conta.'
                : 'Sua nova senha já está ativa.'}
        </AppText>

        {error ? <View style={styles.errorBox}><AppText variant="small" tone="danger">{error}</AppText></View> : null}

        {step === 'channel' ? (
          <View style={styles.options}>
            <ChannelOption icon={<EnvelopeIcon color={colors.brand} size={23} />} title="E-mail" description="Usar o e-mail cadastrado" selected={channel === 'email'} onPress={() => setChannel('email')} />
            <View style={[styles.channelOption, styles.disabledOption]}>
              <View style={styles.optionIcon}><ChatBubbleLeftRightIcon color={colors.inkSubtle} size={23} /></View>
              <View style={styles.optionCopy}><AppText weight="medium" tone="muted">WhatsApp</AppText><AppText variant="small" tone="subtle">Disponível em breve</AppText></View>
              <AppText variant="tiny" tone="subtle" weight="medium">EM BREVE</AppText>
            </View>
          </View>
        ) : null}

        {step === 'otp' ? (
          <View style={styles.stepContent}>
            <OtpCodeField value={code} onChangeText={(value) => { setCode(value); setError(''); }} disabled={loading} autoFocus error={Boolean(error)} />
            <AppText variant="small" tone="muted" style={styles.centerText}>O código expira em 10 minutos.</AppText>
            {cooldownSeconds > 0 ? <AppText variant="small" tone="muted" style={styles.centerText}>Você poderá solicitar outro código em {formatSeconds(cooldownSeconds)}.</AppText> : <Pressable accessibilityRole="button" disabled={loading} onPress={() => void sendCode()}><AppText variant="small" weight="medium" style={styles.link}>Reenviar código</AppText></Pressable>}
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => { setError(''); setStep('channel'); }}><AppText variant="small" weight="medium" style={styles.link}>Trocar método de envio</AppText></Pressable>
          </View>
        ) : null}

        {step === 'password' ? (
          <View style={styles.stepContent}>
            <TextField label="Nova senha" value={newPassword} onChangeText={(value) => { setNewPassword(value); setError(''); }} secureTextEntry={!showNewPassword} autoComplete="new-password" textContentType="newPassword" rightElement={<Pressable accessibilityRole="button" accessibilityLabel={showNewPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'} hitSlop={8} onPress={() => setShowNewPassword((value) => !value)}>{showNewPassword ? <EyeSlashIcon color={colors.inkMuted} size={22} /> : <EyeIcon color={colors.inkMuted} size={22} />}</Pressable>} />
            {newPassword ? <PasswordStrength score={passwordScore} valid={isPasswordPolicyValid(newPassword)} /> : null}
            <TextField label="Confirmar nova senha" value={confirmPassword} onChangeText={(value) => { setConfirmPassword(value); setError(''); }} secureTextEntry={!showConfirmPassword} autoComplete="new-password" textContentType="newPassword" rightElement={<Pressable accessibilityRole="button" accessibilityLabel={showConfirmPassword ? 'Ocultar confirmação da senha' : 'Mostrar confirmação da senha'} hitSlop={8} onPress={() => setShowConfirmPassword((value) => !value)}>{showConfirmPassword ? <EyeSlashIcon color={colors.inkMuted} size={22} /> : <EyeIcon color={colors.inkMuted} size={22} />}</Pressable>} />
            <View style={styles.sessionOption}><View style={styles.sessionCopy}><AppText variant="small" weight="medium">Encerrar outras sessões</AppText><AppText variant="tiny" tone="muted">Aumenta a proteção da conta em outros aparelhos.</AppText></View><Switch accessibilityLabel="Encerrar outras sessões após alterar a senha" value={revokeAllSessions} onValueChange={setRevokeAllSessions} trackColor={{ false: colors.border, true: colors.brandSoft }} thumbColor={revokeAllSessions ? colors.brand : colors.inkSubtle} ios_backgroundColor={colors.border} /></View>
          </View>
        ) : null}

        {step === 'success' ? <View style={styles.successBox}><CheckCircleIcon color={colors.success} size={28} /><AppText tone="muted">Sua senha foi alterada com sucesso. Você continuará conectado neste aparelho.</AppText></View> : null}

        <View style={styles.actions}>
          {step === 'channel' ? <Button title={loadingAction === 'send' ? 'Enviando...' : 'Enviar código'} loading={loadingAction === 'send'} disabled={loading} onPress={() => void sendCode()} /> : null}
          {step === 'otp' ? <Button title={loadingAction === 'verify' ? 'Validando...' : 'Continuar'} loading={loadingAction === 'verify'} disabled={loading || code.length !== 6} onPress={() => void verifyCode()} /> : null}
          {step === 'password' ? <Button title={loadingAction === 'complete' ? 'Atualizando...' : 'Atualizar senha'} loading={loadingAction === 'complete'} disabled={loading} onPress={() => void finish()} /> : null}
          {step === 'success' ? <Button title="Concluir" onPress={() => router.back()} /> : null}
        </View>
      </View>
    </Screen>
  );
}

function ChannelOption({ icon, title, description, selected, onPress }: { icon: React.ReactNode; title: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.channelOption, selected ? styles.selectedOption : null, pressed ? styles.pressed : null]}><View style={styles.optionIcon}>{icon}</View><View style={styles.optionCopy}><AppText weight="medium">{title}</AppText><AppText variant="small" tone="muted">{description}</AppText></View><View style={[styles.radio, selected ? styles.radioSelected : null]} /></Pressable>;
}

function PasswordStrength({ score, valid }: { score: number; valid: boolean }) {
  const color = score <= 2 ? colors.danger : score < 5 ? colors.warning : colors.success;
  return <View style={styles.passwordStrength} accessibilityLabel="Força da senha"><View style={styles.strengthBars}>{[0, 1, 2].map((bar) => <View key={bar} style={[styles.strengthBar, bar < Math.ceil(score / 2) ? { backgroundColor: color } : null]} />)}</View><AppText variant="tiny" tone="muted">{valid ? 'Senha forte.' : passwordPolicyMessage}</AppText></View>;
}

function formatSeconds(value: number) {
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing.xl },
  content: { gap: spacing.md },
  description: { lineHeight: 22 },
  options: { gap: spacing.md, marginTop: spacing.sm },
  channelOption: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  selectedOption: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  disabledOption: { opacity: 0.7, backgroundColor: colors.surfaceNeutral },
  optionIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.brandSoft },
  optionCopy: { flex: 1, gap: spacing.xs },
  radio: { width: 20, height: 20, borderWidth: 2, borderColor: colors.inkSubtle, borderRadius: radius.pill },
  radioSelected: { borderColor: colors.brand, backgroundColor: colors.brand },
  stepContent: { gap: spacing.md, marginTop: spacing.sm },
  centerText: { textAlign: 'center' },
  link: { alignSelf: 'center', color: colors.brand },
  errorBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  sessionOption: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  sessionCopy: { flex: 1, gap: spacing.xs },
  passwordStrength: { gap: spacing.sm },
  strengthBars: { flexDirection: 'row', gap: spacing.xs },
  strengthBar: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  actions: { marginTop: spacing.md },
  pressed: { opacity: 0.8 },
});
