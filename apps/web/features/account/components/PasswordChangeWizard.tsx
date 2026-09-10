'use client';

import { useEffect, useMemo, useState } from 'react';

import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChatBubble, Eye, EyeOff, Mail } from '@/components/icons/icons';
import { InfoCallout } from '@/components/ui/info-callout';
import { OtpCodeInput } from '@/features/contratos/public/OtpCodeInput';
import { logoutCurrentSession } from '@/lib/client/logout';
import { isPasswordPolicyValid, passwordMinLength, passwordPolicyMessage } from '@/lib/password-policy';
import {
  completePasswordChange,
  requestPasswordChangeOtp,
  verifyPasswordChangeOtp,
  type PasswordChangeChannel,
} from '@/features/account/services/security-service';

type WizardStep = 'channel' | 'otp' | 'password' | 'success';
const cooldownErrorMessage = 'Você tentou muitas vezes, aguarde alguns minutos.';

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function PasswordStrength({ password }: { password: string }) {
  const requirements = useMemo(() => [
    password.length >= passwordMinLength,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[!@#$%^&*]/.test(password),
  ], [password]);
  const score = requirements.filter(Boolean).length;
  const tone = score <= 2 ? 'bg-red-500' : score < 5 ? 'bg-amber-400' : 'bg-emerald-500';

  if (!password) return null;

  return (
    <div className="space-y-2" aria-label="Força da senha">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((bar) => (
          <span
            key={bar}
            className={`h-1.5 flex-1 rounded-full ${bar < Math.ceil(score / 2) ? tone : 'bg-gray-200 alusa-dark:bg-[color:var(--color-bg-card-soft)]'}`}
          />
        ))}
      </div>
      <p className="text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
        {isPasswordPolicyValid(password) ? 'Senha forte.' : passwordPolicyMessage}
      </p>
    </div>
  );
}

export function PasswordChangeWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>('channel');
  const [channel, setChannel] = useState<PasswordChangeChannel>('email');
  const [challengeId, setChallengeId] = useState('');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState('');
  const [verificationExpiresAt, setVerificationExpiresAt] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revokeAllSessions, setRevokeAllSessions] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [errorVariant, setErrorVariant] = useState<'error' | 'info'>('error');
  const [loadingAction, setLoadingAction] = useState<'send' | 'verify' | 'complete' | null>(null);

  const cooldownSeconds = resendAvailableAt
    ? Math.max(0, Math.ceil((new Date(resendAvailableAt).getTime() - now) / 1000))
    : 0;
  const isLoading = loadingAction !== null;

  useEffect(() => {
    if (!open || (step !== 'otp' && step !== 'password')) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, step]);

  function resetWizard() {
    setStep('channel');
    setChannel('email');
    setChallengeId('');
    setDestination('');
    setCode('');
    setVerificationToken('');
    setResendAvailableAt('');
    setVerificationExpiresAt('');
    setNewPassword('');
    setConfirmPassword('');
    setRevokeAllSessions(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError('');
    setErrorVariant('error');
    setLoadingAction(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isLoading) return;
    setOpen(nextOpen);
    if (!nextOpen) resetWizard();
  }

  async function sendCode(selectedChannel: PasswordChangeChannel = channel) {
    if (isLoading) return;
    setLoadingAction('send');
    setError('');
    setErrorVariant('error');
    try {
      const result = await requestPasswordChangeOtp(selectedChannel);
      setChannel(selectedChannel);
      setChallengeId(result.challengeId);
      setDestination(result.destination);
      setResendAvailableAt(result.resendAvailableAt);
      setCode('');
      setNow(Date.now());
      setStep('otp');
    } catch (requestError) {
      const message = getErrorMessage(requestError, 'Não foi possível enviar o código.');
      setError(message);
      setErrorVariant(message === cooldownErrorMessage ? 'info' : 'error');
    } finally {
      setLoadingAction(null);
    }
  }

  async function verifyCode() {
    if (isLoading || code.length !== 6) return;
    setLoadingAction('verify');
    setError('');
    setErrorVariant('error');
    try {
      const result = await verifyPasswordChangeOtp({ challengeId, code });
      setVerificationToken(result.verificationToken);
      setVerificationExpiresAt(result.verificationExpiresAt);
      setStep('password');
    } catch (verifyError) {
      setError(getErrorMessage(verifyError, 'Não foi possível validar o código.'));
    } finally {
      setLoadingAction(null);
    }
  }

  async function finishPasswordChange() {
    if (isLoading) return;
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
    setErrorVariant('error');
    try {
      const result = await completePasswordChange({
        challengeId,
        verificationToken,
        newPassword,
        confirmPassword,
        revokeAllSessions,
      });

      if (result.revokedAllSessions) {
        await logoutCurrentSession('/auth/login?password=changed');
        return;
      }

      setStep('success');
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Senha atualizada"
          description="Sua senha foi alterada com sucesso."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (completeError) {
      setError(getErrorMessage(completeError, 'Não foi possível atualizar a senha.'));
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <>
      <section className="grid gap-6 rounded-[10px] border border-[#e2e0e6] bg-white px-5 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:grid-cols-[1fr_auto] md:items-start md:px-6">
        <div className="space-y-1">
          <h3 className="text-xl font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
            Alterar senha
          </h3>
          <p className="text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            Confirme sua identidade antes de criar uma nova senha para a conta.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            resetWizard();
            setOpen(true);
          }}
          className="h-[34px] rounded-[5px] bg-[#512a82] px-5 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
        >
          Alterar senha
        </Button>
      </section>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent closeDisabled={isLoading} className="max-w-[530px] gap-6 rounded-2xl p-6 sm:p-7">
          <DialogHeader className="space-y-1 pr-8">
            <DialogTitle className="text-xl font-medium text-gray-950 alusa-dark:text-[color:var(--color-text-primary)]">
              {step === 'channel' ? 'Confirme sua identidade' : step === 'otp' ? 'Digite o código' : step === 'password' ? 'Defina sua nova senha' : 'Senha alterada'}
            </DialogTitle>
            <DialogDescription className="leading-5">
              {step === 'channel'
                ? 'Escolha onde deseja receber o código de segurança.'
                : step === 'otp'
                  ? <>Enviamos um código de 6 dígitos para <strong className="font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{destination}</strong>.</>
                  : step === 'password'
                    ? 'Crie uma senha forte e exclusiva para proteger sua conta.'
                    : 'Sua nova senha já está ativa.'}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            errorVariant === 'info' ? (
              <InfoCallout variant="info" size="sm" showIcon>
                {error}
              </InfoCallout>
            ) : (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
                {error}
              </div>
            )
          ) : null}

          {step === 'channel' ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setChannel('email')}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${channel === 'email' ? 'border-[#e6d6fb] bg-[#f8f3fd]' : 'border-slate-200 bg-white hover:bg-gray-50'} alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f8efff] text-[#512a82] alusa-dark:bg-[color:rgba(169,77,255,0.16)] alusa-dark:text-[color:var(--color-text-brand)]">
                  <Mail className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">E-mail</span>
                  <span className="block text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Usar o e-mail cadastrado</span>
                </span>
                <span className={`h-4 w-4 rounded-full border-2 ${channel === 'email' ? 'border-[#5c2f91] bg-[#5c2f91]' : 'border-gray-300'}`} aria-hidden />
              </button>

              <div className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-gray-50 p-4 opacity-70 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-gray-500 alusa-dark:bg-[color:var(--color-bg-card)]">
                  <ChatBubble className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">WhatsApp</span>
                  <span className="block text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Disponível em breve</span>
                </span>
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-500 alusa-dark:bg-[color:var(--color-bg-card)]">Em breve</span>
              </div>
            </div>
          ) : null}

          {step === 'otp' ? (
            <div className="space-y-5">
              <div>
                <span id="public-otp-label" className="sr-only">Código de segurança de 6 dígitos</span>
                <OtpCodeInput
                  value={code}
                  onChange={setCode}
                  disabled={isLoading}
                  autoFocus
                  inputClassName="h-14 w-14 text-2xl md:text-2xl sm:h-16 sm:w-16"
                />
              </div>
              <div className="space-y-1 text-center text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                {cooldownSeconds > 0 ? (
                  <p>Tente novamente em {formatSeconds(cooldownSeconds)}.</p>
                ) : (
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                    <button type="button" className="font-medium text-[#512a82] hover:underline disabled:opacity-50" onClick={() => void sendCode()} disabled={isLoading || cooldownSeconds > 0}>
                      Reenviar código
                    </button>
                    <button type="button" className="font-medium text-[#512a82] hover:underline" onClick={() => { setError(''); setStep('channel'); }} disabled={isLoading}>
                      Trocar método de envio
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {step === 'password' ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password-change-new">Nova senha</Label>
                <div className="relative">
                  <Input id="password-change-new" type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" disabled={isLoading} className="h-10 rounded-lg border-slate-200 bg-white px-3 py-2 pr-11 text-sm shadow-none focus-visible:border-brand-accent focus-visible:ring-2 focus-visible:ring-brand-accent/20" />
                  <button type="button" onClick={() => setShowNewPassword((current) => !current)} aria-label={showNewPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-gray-500 hover:text-gray-900">
                    {showNewPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
                <PasswordStrength password={newPassword} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password-change-confirm">Confirmar nova senha</Label>
                <div className="relative">
                  <Input id="password-change-confirm" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" disabled={isLoading} className="h-10 rounded-lg border-slate-200 bg-white px-3 py-2 pr-11 text-sm shadow-none focus-visible:border-brand-accent focus-visible:ring-2 focus-visible:ring-brand-accent/20" />
                  <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? 'Ocultar confirmação da senha' : 'Mostrar confirmação da senha'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-gray-500 hover:text-gray-900">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-gray-50 p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                <Checkbox id="password-change-revoke" checked={revokeAllSessions} onCheckedChange={setRevokeAllSessions} />
                <Label htmlFor="password-change-revoke" className="cursor-pointer text-sm font-medium leading-5 text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Encerrar todas as outras sessões após alterar a senha</Label>
              </div>
            </div>
          ) : null}

          {step === 'success' ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-5 text-emerald-800">
              Sua senha foi alterada com sucesso. Você continuará conectado neste dispositivo.
            </div>
          ) : null}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-0">
            {step === 'channel' ? (
              <Button type="button" onClick={() => void sendCode()} disabled={isLoading} className="w-full sm:w-auto">
                {loadingAction === 'send' ? 'Enviando...' : 'Enviar código'}
              </Button>
            ) : null}
            {step === 'otp' ? (
              <Button type="button" onClick={() => void verifyCode()} disabled={isLoading || code.length !== 6} className="w-full sm:w-auto">
                {loadingAction === 'verify' ? 'Validando...' : 'Continuar'}
              </Button>
            ) : null}
            {step === 'password' ? (
              <Button type="button" onClick={() => void finishPasswordChange()} disabled={isLoading} className="w-full sm:w-auto">
                {loadingAction === 'complete' ? 'Atualizando...' : 'Atualizar senha'}
              </Button>
            ) : null}
            {step === 'success' ? (
              <Button type="button" onClick={() => handleOpenChange(false)} className="w-full sm:w-auto">Concluir</Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
