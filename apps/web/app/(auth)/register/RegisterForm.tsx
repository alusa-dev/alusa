// Página de registro: componente client isolado para permitir wrapper SSR em page.tsx
"use client";
import React, { useMemo, useState } from 'react';
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

export const REQUIRES_SCHOOL_DATA = false;

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;

// Schema condicional por modo
const baseSchema = z.object({
  firstName: z.string().min(2, 'Informe o nome'),
  lastName: z.string().min(2, 'Informe o sobrenome'),
  email: z.string().email('E-mail inválido'),
  financeIntegrationMode: z.enum(['WHITELABEL_BAAS', 'EXTERNAL_ASAAS_ACCOUNT']).default('WHITELABEL_BAAS'),
  senha: z.string().regex(strongPassword, 'Senha fraca'),
  confirmarSenha: z.string(),
  termos: z.boolean().refine((val) => val === true, { message: 'Você deve aceitar os termos' }),
});

function schemaFor() {
  return baseSchema.refine((data) => data.senha === data.confirmarSenha, {
    path: ['confirmarSenha'],
    message: 'Senhas não coincidem'
  });
}

// Tipos do formulário (superset para todos os modos)
type FormValues = {
  firstName: string;
  lastName: string;
  email: string;
  financeIntegrationMode: 'WHITELABEL_BAAS' | 'EXTERNAL_ASAAS_ACCOUNT';
  senha: string;
  confirmarSenha: string;
  termos: boolean;
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
  const schema = useMemo(() => schemaFor(), []);
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: {
      email: inviteData?.email || '',
      financeIntegrationMode: 'WHITELABEL_BAAS',
      termos: false,
    }
  });

  const targetAfterVerification =
    mode === 'first' || inviteData?.role?.toUpperCase() === 'ADMIN'
      ? '/finance/wizard'
      : '/dashboard';
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
      };

      // Ajuste por modo
      if (mode === 'invite' && inviteData) {
        endpoint = '/api/users/accept';
        payload = {
          token: inviteData.token,
          name: `${data.firstName} ${data.lastName}`.trim(),
          email: data.email, // Envia o email (pode ser do convite ou digitado pelo usuário)
          password: data.senha,
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
        const isDeactivatedAccount = isConflict && responsePayload.code === 'ACCOUNT_DEACTIVATED';
        const isAsaasEmailInUse = isConflict && responsePayload.code === 'ASAAS_EMAIL_IN_USE';
        const descText = isDeactivatedAccount
          ? 'Já existe uma conta desativada para este e-mail. Faça login para iniciar a reativação.'
          : responsePayload.error ?? (isConflict ? 'E-mail já cadastrado.' : 'Falha ao criar conta.');
        setGlobalError(descText);
        if (isAuthDebug) debugLog('register', 'error', { status: res.status, error: responsePayload.error });
        const descNode = isDeactivatedAccount ? (
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
            variant={isDeactivatedAccount ? 'warning' : 'error'}
            title={isDeactivatedAccount ? 'Conta desativada encontrada' : isAsaasEmailInUse ? 'E-mail indisponível no cadastro financeiro' : isConflict ? 'E-mail já cadastrado' : 'Erro ao criar conta'}
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
      heroImageSrc="/brand/image-register.jpg"
      heroContent={(
        <div className="flex w-full justify-center -mt-6">
          <p className="max-w-[460px] text-center text-[30px] font-normal leading-tight tracking-[-0.02em] text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.24)]">
            Abra sua conta e conte com uma gestão escolar{' '}
            <span className="font-bold text-[#c9a6ff]">simples</span>
            {' '}e{' '}
            <span className="font-bold text-[#c9a6ff]">segura</span>.
          </p>
        </div>
      )}
    >
      <div data-layer="form register" className="flex w-[min(100%,21.5rem)] min-[400px]:w-[min(100%,24rem)] flex-col items-stretch self-center text-left lg:max-w-[320px] lg:w-full lg:self-auto">
        <header className="mb-6 w-full space-y-2 text-left lg:mb-8">
          <h1 className="w-full text-left text-[1.25rem] font-medium leading-snug tracking-tight text-brand-primary min-[400px]:text-[1.375rem] lg:text-[1.625rem] lg:font-semibold lg:leading-tight">
            {mode === 'invite' ? 'Aceitar convite' : 'Crie sua conta Alusa'}
          </h1>
          {mode === 'invite' && inviteData ? (
            <p className="text-left text-sm font-medium leading-relaxed text-brand-muted lg:text-[12px]">
              Você foi convidado como {inviteData.role} para acessar o sistema.
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
                className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-11 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 disabled:bg-gray-100 lg:h-12 lg:pl-5 lg:pr-11 lg:text-[14px]"
                {...register('email')}
                readOnly={mode === 'invite' && !!inviteData?.email}
                disabled={mode === 'invite' && !!inviteData?.email}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted lg:right-4" aria-hidden>
                <Mail className="h-4 w-4 lg:h-4 lg:w-4" />
              </span>
            </div>
          </div>
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
                type={showPassword ? 'text' : 'password'}
                placeholder="Senha"
                data-testid="register-senha"
                autoComplete="new-password"
                className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-11 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:pl-5 lg:pr-11 lg:text-[14px]"
                {...register('senha')}
              />
              <button
                type="button"
                onClick={() => { setShowPassword(s => !s); }}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-2 top-1/2 flex min-h-12 min-w-12 -translate-y-1/2 items-center justify-center text-brand-muted outline-none lg:right-3 lg:min-h-0 lg:min-w-0 lg:p-1"
              >
                {showPassword ? <EyeOff className="h-4 w-4 lg:h-4 lg:w-4" /> : <Eye className="h-4 w-4 lg:h-4 lg:w-4" />}
              </button>
            </div>
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
                className="absolute right-2 top-1/2 flex min-h-12 min-w-12 -translate-y-1/2 items-center justify-center text-brand-muted outline-none lg:right-3 lg:min-h-0 lg:min-w-0 lg:p-1"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4 lg:h-4 lg:w-4" /> : <Eye className="h-4 w-4 lg:h-4 lg:w-4" />}
              </button>
            </div>
          </div>
          <div className="flex w-full justify-start pt-1">
            <label htmlFor="register-termos" className="flex cursor-pointer select-none items-start gap-2 text-left text-sm font-medium text-[#686868] lg:items-center lg:text-[12px]">
              <Controller
                control={control}
                name="termos"
                render={({ field }) => (
                  <Checkbox
                    id="register-termos"
                    data-testid="register-termos-checkbox"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className="mt-0.5 lg:mt-0"
                  />
                )}
              />
              <span>
                Li e aceito os{' '}
                <a className="text-brand-accent hover:underline" href="/termos" target="_blank" rel="noopener noreferrer">
                  Termos de Uso
                </a>{' '}
                e a{' '}
                <a className="text-brand-accent hover:underline" href="/privacidade" target="_blank" rel="noopener noreferrer">
                  Política de Privacidade
                </a>
                .
              </span>
            </label>
          </div>
          <button
            type="submit"
            data-testid="register-submit"
            disabled={isSubmitting}
            className="mt-1 flex h-12 w-full items-center justify-center rounded-[12px] bg-[#3e1f63] text-base font-medium text-white outline-none transition-colors hover:bg-[#4b217a] disabled:opacity-60 lg:h-12 lg:text-[14px]"
          >
            {isSubmitting ? 'Processando...' : (mode === 'invite' ? 'Aceitar Convite' : 'Criar conta')}
          </button>
          <p className="mt-6 pb-4 text-left text-[0.8125rem] font-medium min-[400px]:text-sm lg:mt-8 lg:pb-0 lg:text-[11px]">
            <span className="text-[#686868]">{mode === 'invite' ? 'Não recebeu este convite? ' : 'Já tenho uma conta! '}</span>
            <a href="/auth/login" className="text-brand-accent hover:underline">
              {mode === 'invite' ? 'Contatar administrador' : 'Fazer login'}
            </a>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
