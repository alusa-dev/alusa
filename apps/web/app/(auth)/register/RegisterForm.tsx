// Página de registro: componente client isolado para permitir wrapper SSR em page.tsx
"use client";
import React, { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { Eye, EyeOff, Mail, ChevronDown } from '@/components/icons/icons';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { debugLog, isAuthDebug } from '@/lib/debug-logger';
import AuthShell from '@/components/auth/AuthShell';

export const REQUIRES_SCHOOL_DATA = false;

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
const passwordRequirementsText = 'Use no minimo 8 caracteres, com letra maiuscula, letra minuscula, numero e caractere especial.';



// Schema condicional por modo
const baseSchema = z.object({
  firstName: z.string().min(2, 'Informe o nome'),
  lastName: z.string().min(2, 'Informe o sobrenome'),
  email: z.string().email('E-mail inválido'),
  financeIntegrationMode: z.enum(['WHITELABEL_BAAS', 'EXTERNAL_ASAAS_ACCOUNT']).default('WHITELABEL_BAAS'),
  senha: z.string().regex(strongPassword, 'Senha fraca'),
  confirmarSenha: z.string(),
  termos: z.literal(true, { errorMap: () => ({ message: 'Você deve aceitar os termos' }) }),
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
  termos: true;
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
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: {
      email: inviteData?.email || '',
      financeIntegrationMode: 'WHITELABEL_BAAS',
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
      <div data-layer="form register" className="flex w-full max-w-[min(100%,21.5rem)] min-[400px]:max-w-[min(100%,24rem)] flex-col items-center text-center">
        <header className="mb-7 space-y-2 min-[400px]:mb-8">
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-tight min-[400px]:text-[2rem]">
            {mode === 'invite' ? 'Aceitar Convite' : 'Abra sua conta'}
          </h1>
          <p className="text-[0.8125rem] font-medium leading-relaxed text-[#5c5c5c] min-[400px]:text-[0.9375rem]">
            {mode === 'invite' && inviteData
              ? `Você foi convidado como ${inviteData.role} para acessar o sistema.`
              : 'Informe seu e-mail e defina uma senha para começar a abertura da sua conta na alusa.'
            }
          </p>
          {/* No modo convite, o e-mail é editável no campo abaixo (pré-preenchido pelo convite) */}
          {/* Erro global visível apenas se necessário */}
          {globalError && <p data-testid="register-error" className="text-[0.8125rem] text-red-600 text-center min-[400px]:text-sm" role="alert">{globalError}</p>}
        </header>


        <form onSubmit={(e) => { void handleSubmit(onSubmit, onError)(e); }} className="flex w-full flex-col items-stretch gap-3.5 min-[400px]:gap-4" data-testid="register-form" noValidate>
          <div className="flex gap-4 w-full">
            <div className="flex-1">
              <div className="relative h-12 min-[400px]:h-14">
                <input type="text" placeholder="Nome" data-testid="register-nome-first" className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white px-5 text-[0.9375rem] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base" {...register('firstName')} />
              </div>
            </div>
            <div className="flex-1">
              <div className="relative h-12 min-[400px]:h-14">
                <input type="text" placeholder="Sobrenome" data-testid="register-nome-last" className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white px-5 text-[0.9375rem] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base" {...register('lastName')} />
              </div>
            </div>
          </div>

          <div className="w-full">
            <div className="relative h-12 min-[400px]:h-14">
              <input
                type="email"
                placeholder="Email"
                data-testid="register-email"
                autoComplete="email"
                className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base disabled:bg-gray-100"
                {...register('email')}
                readOnly={mode === 'invite' && !!inviteData?.email}
                disabled={mode === 'invite' && !!inviteData?.email}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted min-[400px]:right-[1.125rem]" aria-hidden><Mail className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" /></span>
            </div>
          </div>
          {mode === 'first' && enableExternalAsaasOnboarding ? (
            <div className="w-full">
              <div className="relative h-12 min-[400px]:h-14">
                <select
                  data-testid="register-finance-integration-mode"
                  className="h-12 w-full min-[400px]:h-14 appearance-none rounded-[12px] border border-gray-300 bg-white px-5 pr-11 text-[0.9375rem] font-medium text-gray-900 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base"
                  {...register('financeIntegrationMode')}
                >
                  <option value="WHITELABEL_BAAS">Quero abrir conta com a Alusa (padrão)</option>
                  <option value="EXTERNAL_ASAAS_ACCOUNT">Já tenho uma conta no Asaas</option>
                </select>
                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted min-[400px]:right-[1.125rem]">
                  <ChevronDown className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" />
                </div>
              </div>
            </div>
          ) : null}
          <div className="w-full">
            <div className="relative h-12 min-[400px]:h-14">
              <input type={showPassword ? 'text' : 'password'} placeholder="Senha" data-testid="register-senha" autoComplete="new-password" className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base" {...register('senha')} />
              <button type="button" onClick={() => { setShowPassword(s => !s); }} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-2 text-brand-muted outline-none min-[400px]:right-3.5">{showPassword ? <EyeOff className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" /> : <Eye className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" />}</button>
            </div>
          </div>
          <div className="w-full">
            <div className="relative h-12 min-[400px]:h-14">
              <input type={showConfirmPassword ? 'text' : 'password'} placeholder="Confirmar senha" data-testid="register-senha-confirmar" autoComplete="new-password" className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base" {...register('confirmarSenha')} />
              <button type="button" onClick={() => { setShowConfirmPassword(s => !s); }} aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-2 text-brand-muted outline-none min-[400px]:right-3.5">{showConfirmPassword ? <EyeOff className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" /> : <Eye className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" />}</button>
            </div>
            <p className="mt-2 px-1 text-center text-[0.8125rem] font-medium leading-relaxed text-[#5c5c5c] min-[400px]:text-[0.9375rem]">
              {passwordRequirementsText}
            </p>
          </div>
          <div className="flex w-full justify-center pt-1">
            <label className="flex max-w-[300px] cursor-pointer select-none items-start gap-2 text-center text-[0.8125rem] font-medium leading-relaxed min-[400px]:text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded-[5px] border border-brand-accent accent-brand-accent outline-none min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" {...register('termos')} />
              <span className="text-[#686868]">Aceito os <a className="text-brand-accent hover:underline" href="/termos" target="_blank" rel="noopener noreferrer">Termos de Uso</a></span>
            </label>
          </div>
          <button type="submit" data-testid="register-submit" disabled={isSubmitting} className="mt-1 flex h-12 w-full min-[400px]:h-14 items-center justify-center rounded-[12px] bg-[#3e1f63] text-[0.9375rem] font-medium text-white outline-none transition-colors hover:bg-[#4b217a] disabled:opacity-60 min-[400px]:text-base">
            {isSubmitting ? 'Processando...' : (mode === 'invite' ? 'Aceitar Convite' : 'Criar conta')}
          </button>
          <p className="mt-2 text-center text-[0.8125rem] font-medium min-[400px]:text-sm">
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
