// Página de registro: componente client isolado para permitir wrapper SSR em page.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { Eye, EyeOff, Mail } from '@/components/icons/icons';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { debugLog, isAuthDebug } from '@/lib/debug-logger';
import AuthShell from '@/components/auth/AuthShell';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LegalAcceptanceModal } from '@/components/legal/LegalAcceptanceModal';
import PasswordStrengthIndicator from '@/components/auth/PasswordStrengthIndicator';
import { requiredRegisterLegalDocuments } from '@/lib/privacy/legal-versions';
import { passwordPolicyRegex } from '@/lib/password-policy';
import { isValidCpfDigits, normalizeCpfCnpjDigits } from '@alusa/shared/validators/cpf-cnpj';

export const REQUIRES_SCHOOL_DATA = false;

// Schema condicional por modo
const baseSchema = z.object({
  firstName: z.string().min(2, 'Informe o nome'),
  lastName: z.string().min(2, 'Informe o sobrenome'),
  email: z.string().email('E-mail inválido'),
  financeIntegrationMode: z.enum(['WHITELABEL_BAAS', 'EXTERNAL_ASAAS_ACCOUNT']).default('WHITELABEL_BAAS'),
  senha: z.string().regex(passwordPolicyRegex, 'Senha fraca'),
  confirmarSenha: z.string(),
  termos: z.boolean().refine((val) => val === true, { message: 'Você deve aceitar os termos' }),
  cpf: z.string().optional(),
  telefone: z.string().optional(),
});

function schemaFor(isGuardianInvite: boolean) {
  return baseSchema
    .refine((data) => data.senha === data.confirmarSenha, {
      path: ['confirmarSenha'],
      message: 'Senhas não coincidem',
    })
    .refine((data) => !isGuardianInvite || (Boolean(data.cpf) && isValidCpfDigits(normalizeCpfCnpjDigits(data.cpf))), {
      path: ['cpf'],
      message: 'Informe um CPF válido',
    })
    .refine((data) => !isGuardianInvite || /^\d{10,11}$/.test((data.telefone ?? '').replace(/\D/g, '')) , {
      path: ['telefone'],
      message: 'Informe um telefone com DDD',
    });
}

const INVITE_ROLE_LABELS: Record<string, string> = {
  PROFESSOR: 'Professor',
  RECEPCAO: 'Recepção',
  FINANCEIRO: 'Financeiro',
  RESPONSAVEL: 'Responsável',
};

// Tipos do formulário (superset para todos os modos)
type FormValues = {
  firstName: string;
  lastName: string;
  email: string;
  financeIntegrationMode: 'WHITELABEL_BAAS' | 'EXTERNAL_ASAAS_ACCOUNT';
  senha: string;
  confirmarSenha: string;
  termos: boolean;
  cpf?: string;
  telefone?: string;
};

interface InviteData {
  email?: string; // Opcional para RESPONSAVEL
  role: string;
  token: string;
  alunos?: Array<{
    id: string;
    nome: string;
    email: string | null;
    idade: number | null;
  }>;
}

type RegisterMode = 'first' | 'invite';

interface RegisterFormProps {
  inviteData?: InviteData;
  enableExternalAsaasOnboarding?: boolean;
}

export default function RegisterForm({ inviteData, enableExternalAsaasOnboarding = false }: RegisterFormProps) {
  const mode: RegisterMode = inviteData ? 'invite' : 'first';
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const isGuardianInvite = mode === 'invite' && inviteData?.role.toUpperCase() === 'RESPONSAVEL';
  const schema = useMemo(() => schemaFor(isGuardianInvite), [isGuardianInvite]);
  const { register, handleSubmit, control, formState: { errors, isSubmitting }, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: {
      email: inviteData?.email || '',
      financeIntegrationMode: 'WHITELABEL_BAAS',
      senha: '',
      confirmarSenha: '',
      termos: false,
    }
  });
  const termsAccepted = watch('termos');
  const passwordRegistration = register('senha');

  useEffect(() => {
    const autofilledPassword = passwordInputRef.current?.value;
    if (autofilledPassword) setPasswordValue(autofilledPassword);
  }, []);

  // Convites dão acesso a uma conta já configurada; somente o primeiro cadastro
  // deve iniciar o onboarding financeiro da nova escola.
  const targetAfterVerification = mode === 'first' ? '/finance/wizard' : '/dashboard';
  const postRegisterRedirect = `/auth/confirm-email?callbackUrl=${encodeURIComponent(targetAfterVerification)}`;

  /* helpers removed */


  async function onSubmit(data: FormValues) {
    setGlobalError(null);
    const escolaNome = `${data.firstName} ${data.lastName}`.trim();

    try {
      if (isAuthDebug) debugLog('register', 'submit', { mode, email: data.email });
      let endpoint = '/api/users/first-register';
      let payload: Record<string, unknown> = {
        nome: `${data.firstName} ${data.lastName}`.trim(),
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        senha: data.senha,
        escolaNome,
        financeIntegrationMode: mode === 'first' ? data.financeIntegrationMode : 'WHITELABEL_BAAS',
        legalAcceptance: {
          accepted: true,
          locale: 'pt-BR',
          source: 'REGISTER',
          documents: requiredRegisterLegalDocuments().map((document) => ({
            documentType: document.type,
            documentVersion: document.version,
          })),
        },
      };

      // Ajuste por modo
      if (mode === 'invite' && inviteData) {
        endpoint = '/api/users/accept';
        payload = {
          token: inviteData.token,
          name: `${data.firstName} ${data.lastName}`.trim(),
          email: inviteData.email ?? data.email,
          password: data.senha,
          ...(isGuardianInvite ? { cpf: data.cpf, telefone: data.telefone } : {}),
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (isAuthDebug) debugLog('register', 'response', { status: res.status });

      const responsePayload = (await res.json().catch(() => ({}))) as Partial<{
        error: string;
        code: string;
        user: { email?: string; contaId?: string; emailVerified?: boolean };
      }>;

      if (!res.ok) {
        const isConflict = res.status === 409;
        const isExistingInviteAccount = mode === 'invite' && responsePayload.code === 'ACCOUNT_EXISTS' && Boolean(inviteData?.token);
        const isAlreadyLinked = mode === 'invite' && responsePayload.code === 'USER_ALREADY_LINKED';
        const isDeactivatedAccount = isConflict && responsePayload.code === 'ACCOUNT_DEACTIVATED';
        const isInactiveInviteAccount = mode === 'invite' && responsePayload.code === 'ACCOUNT_INACTIVE';
        const isAsaasEmailInUse = isConflict && responsePayload.code === 'ASAAS_EMAIL_IN_USE';
        const descText = isAlreadyLinked
          ? 'Esta conta já está vinculada a esta escola. Fale com o administrador.'
          : isInactiveInviteAccount
          ? 'A conta associada a este e-mail está inativa. Peça ao administrador da escola para reativar o acesso antes de continuar.'
          : isDeactivatedAccount
          ? 'Já existe uma conta desativada para este e-mail. Faça login para iniciar a reativação.'
          : responsePayload.error ?? (isConflict ? 'E-mail já cadastrado.' : 'Falha ao criar conta.');
        setGlobalError(isAlreadyLinked ? null : descText);
        if (isAuthDebug) debugLog('register', 'error', { status: res.status, error: responsePayload.error });
        const descNode = isAlreadyLinked ? descText : isInactiveInviteAccount ? (
          <span>{descText}</span>
        ) : isExistingInviteAccount ? (
          <span>
            Este e-mail já possui uma conta.{' '}
            <a href={`/auth/login?callbackUrl=${encodeURIComponent(`/auth/register?token=${inviteData!.token}`)}`} className="underline">Entre para aceitar o convite</a>.
          </span>
        ) : isDeactivatedAccount ? (
          <span>
            Já existe uma conta desativada para este e-mail.{' '}
            <a href="/auth/login" className="underline">Faça login</a>{' '}
            para iniciar a reativação.
          </span>
        ) : isAsaasEmailInUse ? (
          'Este e-mail já está vinculado a um cadastro financeiro existente. Use outro e-mail para criar uma nova conta.'
        ) : isConflict ? (
          <span>
            Este e-mail já está em uso.{" "}
            <a href="/auth/login" className="underline">Fazer login</a>{" "}ou{" "}
            <a href="/auth/forgot-password" className="underline">recuperar senha</a>.
          </span>
        ) : (descText);
        toast.custom((t) => (
          <CustomToast
            variant={isAlreadyLinked || isDeactivatedAccount ? 'warning' : 'error'}
            title={isAlreadyLinked ? 'Conta já vinculada' : isInactiveInviteAccount ? 'Conta de usuário inativa' : isExistingInviteAccount ? 'Entre na sua conta para aceitar' : isDeactivatedAccount ? 'Conta desativada encontrada' : isAsaasEmailInUse ? 'E-mail indisponível no cadastro financeiro' : isConflict ? 'E-mail já cadastrado' : 'Erro ao criar conta'}
            description={descNode}
            onClose={() => { toast.dismiss(t); }}
          />
        ));
        return;
      }

      const loginEmail = responsePayload.user?.email || data.email;
      const login = await signIn('credentials', {
        redirect: false,
        email: loginEmail,
        password: data.senha,
        contaId: responsePayload.user?.contaId,
      });
      if (isAuthDebug) debugLog('register', 'auto-login response', login);
      if (login?.error) {
        const desc = 'Conta criada, mas não foi possível autenticar.';
        setGlobalError(desc);
        toast.custom((t) => (
          <CustomToast
            variant="warning"
            title="Falha na autenticação"
            description="Faça login manualmente."
            onClose={() => { toast.dismiss(t); }}
          />
        ));
        return;
      }

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Conta criada"
          description="Redirecionando para confirmar seu e-mail..."
          onClose={() => { toast.dismiss(t); }}
        />
      ), { duration: 3000 });
      if (isAuthDebug) debugLog('register', 'success', { email: loginEmail });
      setTimeout(() => {
        window.location.href =
          mode === 'invite' && responsePayload.user?.emailVerified
            ? targetAfterVerification
            : postRegisterRedirect;
      }, 450);
    } catch {
      setGlobalError('Erro inesperado. Tente novamente.');
      if (isAuthDebug) debugLog('register', 'unexpected');
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro inesperado"
          description="Tente novamente."
          onClose={() => { toast.dismiss(t); }}
        />
      ));
    }
  }

  function onError() {
    const order: Array<keyof FormValues> = ['firstName', 'lastName', 'email', 'senha', 'confirmarSenha', 'termos'];
    for (const key of order) {
      const err = errors[key];
      if (!err) continue;
      const base = (err.message as string) || 'Campo inválido';
      if (isAuthDebug) debugLog('register', 'validation-error', { field: key, message: base });
      let title = 'Campo inválido';
      let desc = 'Revise o valor informado.';
      switch (key) {
        case 'firstName': title = 'Nome inválido'; desc = 'Informe um nome válido (mín. 2 letras).'; break;
        case 'lastName': title = 'Sobrenome inválido'; desc = 'Informe um sobrenome válido.'; break;
        case 'email': title = 'E-mail inválido'; desc = 'Preencha corretamente seu e-mail.'; break;
        case 'senha': title = 'Senha fraca'; desc = 'Use 8+ caracteres, maiúscula, minúscula, número e símbolo.'; break;
        case 'confirmarSenha': title = 'Senhas não coincidem'; desc = 'Garanta que as duas senhas são iguais.'; break;
        case 'termos': title = 'Termos necessários'; desc = 'Aceite os termos para continuar.'; break;
      }
      if (base && base !== 'Campo inválido') {
        if (key === 'senha' && base !== 'Senha fraca') { desc = base; }
      }
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title={title}
          description={desc}
          onClose={() => { toast.dismiss(t); }}
        />
      ));
      break;
    }
  }

  return (
    <AuthShell
      hideHero
      heroImageSrc="/images/auth/login.webp"
      heroContent={(
        <div className="flex w-full justify-start">
          <p className="max-w-[360px] text-left text-3xl font-normal leading-tight text-[#3d3a3f]">
            Abra sua conta e conte com uma gestão escolar <span className="font-bold">simples</span> e <span className="font-bold">segura</span>.
          </p>
        </div>
      )}
    >
      <div data-layer="form register" className="auth-card auth-login-card flex w-[min(100%,21.5rem)] min-[400px]:w-[min(100%,24rem)] flex-col items-stretch self-center text-left lg:w-full lg:self-auto">
        <header className="mb-6 w-full space-y-2 text-left lg:mb-8 lg:text-center">
          <h1 className="w-full text-left text-[1.25rem] font-medium leading-snug tracking-tight text-brand-primary min-[400px]:text-[1.375rem] lg:text-center lg:text-[1.625rem] lg:font-semibold lg:leading-tight">
            {mode === 'invite' ? 'Aceitar convite' : 'Crie sua conta Alusa'}
          </h1>
          {mode === 'invite' && inviteData ? (
            <p className="text-left text-sm font-medium leading-relaxed text-brand-muted lg:text-center lg:text-[12px]">
              Você recebeu um convite para acessar a Alusa com o perfil de{' '}
              <strong className="font-semibold text-brand-primary">
                {INVITE_ROLE_LABELS[inviteData.role.toUpperCase()] ?? inviteData.role}
              </strong>.
            </p>
          ) : null}
          {globalError && (
            <p data-testid="register-error" className="text-left text-sm text-red-600 lg:text-[12px]" role="alert">
              {globalError}
            </p>
          )}
        </header>

        <form
          onSubmit={(e) => { void handleSubmit(onSubmit, onError)(e); }}
          className="flex w-full flex-col items-stretch gap-4 lg:items-start"
          data-testid="register-form"
          data-sentry-mask
          noValidate
        >
          <div className="flex w-full gap-3 lg:gap-4">
            <div className="min-w-0 flex-1">
              <div className="relative h-12 w-full lg:h-12">
                <input
                  type="text"
                  placeholder="Nome"
                  data-testid="register-nome-first"
                  className="h-12 w-full rounded-[12px] border border-gray-300 bg-white px-4 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:px-5 lg:text-[14px]"
                  {...register('firstName')}
                />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative h-12 w-full lg:h-12">
                <input
                  type="text"
                  placeholder="Sobrenome"
                  data-testid="register-nome-last"
                  className="h-12 w-full rounded-[12px] border border-gray-300 bg-white px-4 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:px-5 lg:text-[14px]"
                  {...register('lastName')}
                />
              </div>
            </div>
          </div>

          <div className="w-full">
            <div className="relative h-12 w-full lg:h-12">
              <input
                type="email"
                placeholder="Email"
                data-testid="register-email"
                autoComplete="email"
                {...register('email')}
                defaultValue={mode === 'invite' ? inviteData?.email ?? '' : undefined}
                readOnly={mode === 'invite' && !!inviteData?.email}
                aria-readonly={mode === 'invite' && !!inviteData?.email}
                className={`h-12 w-full rounded-[12px] border border-gray-300 pl-4 pr-11 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:pl-5 lg:pr-11 lg:text-[14px] ${mode === 'invite' && inviteData?.email ? 'cursor-not-allowed bg-gray-100 text-gray-600' : 'bg-white'}`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted lg:right-4" aria-hidden>
                <Mail className="h-4 w-4 lg:h-4 lg:w-4" />
              </span>
            </div>
          </div>
          {isGuardianInvite ? (
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  placeholder="CPF"
                  aria-label="CPF do responsável"
                  data-testid="register-guardian-cpf"
                  className="h-12 w-full rounded-[12px] border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
                  {...register('cpf')}
                />
                {errors.cpf ? <p role="alert" className="mt-1 text-xs text-red-600">{errors.cpf.message}</p> : null}
              </div>
              <div>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  placeholder="Telefone com DDD"
                  aria-label="Telefone do responsável"
                  data-testid="register-guardian-phone"
                  className="h-12 w-full rounded-[12px] border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
                  {...register('telefone')}
                />
                {errors.telefone ? <p role="alert" className="mt-1 text-xs text-red-600">{errors.telefone.message}</p> : null}
              </div>
            </div>
          ) : null}
          {mode === 'first' && enableExternalAsaasOnboarding ? (
            <div className="w-full">
              <Controller
                control={control}
                name="financeIntegrationMode"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      data-testid="register-finance-integration-mode"
                      className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-3 text-base font-medium text-gray-900 shadow-none transition-none hover:border-gray-300 focus:border-gray-300 focus:outline-none focus:ring-0 focus:ring-offset-0 lg:h-12 lg:pl-5 lg:text-[14px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      side="bottom"
                      sideOffset={6}
                      align="start"
                      collisionPadding={8}
                      className="z-[300] max-h-[min(50vh,20rem)] w-[var(--radix-select-trigger-width)] rounded-[12px] border border-gray-200 bg-white p-0 shadow-lg"
                    >
                      <SelectItem
                        value="WHITELABEL_BAAS"
                        className="cursor-pointer rounded-lg py-3 text-base font-medium lg:text-[14px]"
                      >
                        Quero abrir conta com a Alusa (padrão)
                      </SelectItem>
                      <SelectItem
                        value="EXTERNAL_ASAAS_ACCOUNT"
                        className="cursor-pointer rounded-lg py-3 text-base font-medium lg:text-[14px]"
                      >
                        Já tenho uma conta no Asaas
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          ) : null}
          <div className="w-full">
            <div className="relative h-12 w-full lg:h-12">
              <input
                id="register-senha"
                type={showPassword ? 'text' : 'password'}
                placeholder="Senha"
                data-testid="register-senha"
                autoComplete="new-password"
                className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-28 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:pl-5 lg:text-[14px]"
                {...passwordRegistration}
                ref={(element) => {
                  passwordRegistration.ref(element);
                  passwordInputRef.current = element;
                }}
                onChange={(event) => {
                  void passwordRegistration.onChange(event);
                  setPasswordValue(event.currentTarget.value);
                }}
                onInput={(event) => setPasswordValue(event.currentTarget.value)}
                onFocus={(event) => setPasswordValue(event.currentTarget.value)}
              />
              <PasswordStrengthIndicator password={passwordValue} placement="field" />
              <button
                type="button"
                onClick={() => { setShowPassword(s => !s); }}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showPassword}
                aria-controls="register-senha"
                data-testid="register-senha-toggle"
                className="absolute right-1 top-1/2 z-10 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-transparent text-brand-muted outline-none hover:bg-transparent hover:text-brand-primary active:bg-transparent focus-visible:ring-2 focus-visible:ring-brand-primary lg:right-1 lg:min-h-10 lg:min-w-10"
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
            <PasswordStrengthIndicator password={passwordValue} placement="meter" />
          </div>
          <div className="w-full">
            <div className="relative h-12 w-full lg:h-12">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirmar senha"
                data-testid="register-senha-confirmar"
                autoComplete="new-password"
                className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-11 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:pl-5 lg:pr-11 lg:text-[14px]"
                {...register('confirmarSenha')}
              />
              <button
                type="button"
                onClick={() => { setShowConfirmPassword(s => !s); }}
                aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showConfirmPassword}
                aria-controls="register-senha-confirmar"
                data-testid="register-senha-confirmar-toggle"
                className="absolute right-1 top-1/2 z-10 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-transparent text-brand-muted outline-none hover:bg-transparent hover:text-brand-primary active:bg-transparent focus-visible:ring-2 focus-visible:ring-brand-primary lg:right-1 lg:min-h-10 lg:min-w-10"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </div>
          <div className="flex w-full justify-start pt-1">
            <label htmlFor="register-termos" className="flex cursor-pointer select-none items-center gap-2.5 text-left text-sm font-medium text-[#686868] lg:text-[12px]">
              <Controller
                control={control}
                name="termos"
                render={({ field }) => (
                  <Checkbox
                    id="register-termos"
                    data-testid="register-termos-checkbox"
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      if (checked && !field.value) {
                        setLegalModalOpen(true);
                        return;
                      }
                      field.onChange(false);
                    }}
                    className="mt-0.5 lg:mt-0"
                  />
                )}
              />
              <span>
                Li e aceito os Termos e Políticas da Alusa.
              </span>
            </label>
          </div>
          <button
            type="submit"
            data-testid="register-submit"
            disabled={isSubmitting || !termsAccepted}
            className="mt-1 flex h-12 w-full items-center justify-center rounded-[12px] bg-[#3e1f63] text-base font-medium text-white outline-none transition-colors hover:bg-[#4b217a] disabled:opacity-60 lg:h-12 lg:text-[14px]"
          >
            {isSubmitting ? 'Processando...' : (mode === 'invite' ? 'Aceitar Convite' : 'Criar conta')}
          </button>
          {mode === 'first' ? (
            <p className="mt-6 w-full pb-4 text-center text-[0.8125rem] font-medium min-[400px]:text-sm lg:mt-8 lg:pb-0 lg:text-[11px]">
              <span className="text-[#686868]">Já tenho uma conta! </span>
              <a href="/auth/login" className="text-brand-accent hover:underline">Fazer login</a>
            </p>
          ) : null}
        </form>
        <LegalAcceptanceModal
          open={legalModalOpen}
          onOpenChange={setLegalModalOpen}
          onAccept={() => {
            setValue('termos', true, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
            setLegalModalOpen(false);
          }}
        />
      </div>
    </AuthShell>
  );
}
