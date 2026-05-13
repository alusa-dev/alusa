"use client";
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import type { FieldErrors } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { User, Eye, EyeOff } from '@/components/icons/icons';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { debugLog, isAuthDebug } from '@/lib/debug-logger';
import { nextParamToRedirect } from '@/lib/safe-redirect';
import AuthShell from '@/components/auth/AuthShell';

type LoginValidationReason =
  | 'INVALID_INPUT'
  | 'USER_NOT_FOUND'
  | 'USER_INACTIVE'
  | 'ACCOUNT_DEACTIVATED'
  | 'ACCOUNT_UNAVAILABLE'
  | 'INVALID_PASSWORD'
  | 'UNEXPECTED_ERROR';

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'A senha deve ter ao menos 6 caracteres')
});
type FormData = z.infer<typeof schema>;

function showLoginErrorToast(reason: LoginValidationReason) {
  if (reason === 'INVALID_INPUT') {
    toast.custom((t) => (
      <CustomToast
        title="Dados inválidos"
        description="Preencha e-mail e senha corretamente para continuar."
        variant="error"
        onClose={() => { toast.dismiss(t); }}
      />
    ));
    return;
  }

  if (reason === 'USER_NOT_FOUND') {
    toast.custom((t) => (
      <CustomToast
        title="Usuário não encontrado"
        description={<span>Não existe conta para este e-mail. <a href="/auth/register" className="underline">Criar conta</a>.</span>}
        variant="error"
        onClose={() => { toast.dismiss(t); }}
      />
    ));
    return;
  }

  if (reason === 'USER_INACTIVE') {
    toast.custom((t) => (
      <CustomToast
        title="Acesso inativo"
        description="Seu usuário está inativo. Entre em contato com o administrador da conta."
        variant="error"
        onClose={() => { toast.dismiss(t); }}
      />
    ));
    return;
  }

  if (reason === 'ACCOUNT_DEACTIVATED') {
    toast.custom((t) => (
      <CustomToast
        title="Conta desativada"
        description="Enviamos um link de reativação para o e-mail informado. Confirme o e-mail para voltar a acessar."
        variant="warning"
        onClose={() => { toast.dismiss(t); }}
      />
    ));
    return;
  }

  if (reason === 'ACCOUNT_UNAVAILABLE') {
    toast.custom((t) => (
      <CustomToast
        title="Conta indisponível"
        description="Esta conta não está disponível para acesso no momento."
        variant="error"
        onClose={() => { toast.dismiss(t); }}
      />
    ));
    return;
  }

  if (reason === 'INVALID_PASSWORD') {
    toast.custom((t) => (
      <CustomToast
        title="Senha incorreta"
        description={<span>A senha informada está incorreta. <a href="/auth/forgot-password" className="underline">Redefinir senha</a>.</span>}
        variant="error"
        onClose={() => { toast.dismiss(t); }}
      />
    ));
    return;
  }

  toast.custom((t) => (
    <CustomToast
      title="Não foi possível fazer login"
      description="Ocorreu uma falha inesperada. Tente novamente em instantes."
      variant="error"
      onClose={() => { toast.dismiss(t); }}
    />
  ));
}

async function validateLoginCredentials(data: FormData): Promise<{ ok: true } | { ok: false; reason: LoginValidationReason }> {
  const response = await fetch('/api/auth/login/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const body = (await response.json().catch(() => null)) as { ok?: boolean; reason?: LoginValidationReason } | null;

  if (response.ok && body?.ok) {
    return { ok: true };
  }

  return { ok: false, reason: body?.reason ?? 'UNEXPECTED_ERROR' };
}

export default function LoginClient() {

  const sp = useSearchParams();
  // callbackUrl pode vir como ?callbackUrl=/algo ou legado ?next=/algo
  const rawCb = sp.get('callbackUrl') || sp.get('next');
  const callbackUrl = nextParamToRedirect(rawCb) || '/dashboard';
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting }, setValue } = useForm<FormData>({ resolver: zodResolver(schema), mode: 'onSubmit' });
  const expiredToastShown = useRef(false);
  const errorToastShown = useRef(false);
  const accountToastShown = useRef(false);
  const successToastShown = useRef(false);

  useEffect(() => {
    try {
      const flag = localStorage.getItem('alusa.remember');
      const savedEmail = localStorage.getItem('alusa.remember.email');
      if (flag === '1' && savedEmail) {
        setRemember(true);
        setValue('email', savedEmail);
      }
    } catch { /* ignore */ }
  }, [setValue]);

  // Feedback quando a sessão expira e o middleware envia expired=true
  useEffect(() => {
    if (expiredToastShown.current) return;
    const expired = sp.get('expired');
    if (expired === 'true') {
      expiredToastShown.current = true;
      toast.custom((t) => (
        <CustomToast
          title="Sua sessão expirou"
          description="Faça login novamente."
          variant="error"
          onClose={() => { toast.dismiss(t); }}
        />
      ), { duration: 3000 });
    }
  }, [sp]);

  // Feedback quando NextAuth retorna para a página com erro de credenciais
  useEffect(() => {
    if (errorToastShown.current) return;
    const err = sp.get('error');
    if (err) {
      errorToastShown.current = true;
      if (err === 'invalid_token') {
        toast.custom((t) => (
          <CustomToast
            title="Convite inválido"
            description="O link de cadastro é inválido ou expirou. Solicite um novo convite."
            variant="error"
            onClose={() => { toast.dismiss(t); }}
          />
        ));
        return;
      }

      showLoginErrorToast('UNEXPECTED_ERROR');
    }
  }, [sp]);

  useEffect(() => {
    if (accountToastShown.current) return;

    const account = sp.get('account');
    const deactivated = sp.get('deactivated');

    if (deactivated === '1') {
      accountToastShown.current = true;
      toast.custom((t) => (
        <CustomToast
          title="Conta desativada"
          description="Seu acesso foi desativado. Para voltar, use o link de reativação enviado para o e-mail cadastrado."
          variant="success"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
      return;
    }

    if (account === 'deactivated') {
      accountToastShown.current = true;
      toast.custom((t) => (
        <CustomToast
          title="Conta desativada"
          description="Sua sessão foi encerrada porque a conta está desativada. Faça login com suas credenciais para solicitar a reativação por e-mail."
          variant="warning"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
      return;
    }

    if (account === 'inactive-user') {
      accountToastShown.current = true;
      toast.custom((t) => (
        <CustomToast
          title="Acesso inativo"
          description="Seu usuário está inativo. Entre em contato com o administrador da conta."
          variant="error"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
    }
  }, [sp]);

  useEffect(() => {
    if (successToastShown.current) return;

    const verified = sp.get('verified');
    const reactivated = sp.get('reactivated');
    const reset = sp.get('reset');

    if (verified === '1') {
      successToastShown.current = true;
      toast.custom((t) => (
        <CustomToast
          title="E-mail confirmado"
          description="Seu acesso foi liberado."
          variant="success"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
      return;
    }

    if (reactivated === '1') {
      successToastShown.current = true;
      toast.custom((t) => (
        <CustomToast
          title="Conta reativada"
          description="Faça login para continuar." 
          variant="success"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
      return;
    }

    if (reset === 'success') {
      successToastShown.current = true;
      toast.custom((t) => (
        <CustomToast
          title="Senha redefinida"
          description="Faça login com sua nova senha."
          variant="success"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
    }
  }, [sp]);

  const onSubmit = (data: FormData) => {
    void (async () => {
      if (isAuthDebug) debugLog('login', 'attempt', { email: data.email });
      const validation = await validateLoginCredentials(data);
      if (!validation.ok) {
        if (isAuthDebug) debugLog('login', 'validation error', { email: data.email, reason: validation.reason });
        showLoginErrorToast(validation.reason);
        return;
      }

      const res = await signIn('credentials', { email: data.email, password: data.password, redirect: false, callbackUrl });
      if (isAuthDebug) debugLog('login', 'signIn response', res);
      if (res?.error) {
        const code = typeof res.error === 'string' ? res.error : 'UNEXPECTED_ERROR';
        if (isAuthDebug) debugLog('login', 'error', { code });
        showLoginErrorToast('UNEXPECTED_ERROR');
        return;
      }

      try {
        if (remember) {
          localStorage.setItem('alusa.remember', '1');
          localStorage.setItem('alusa.remember.email', data.email);
        } else {
          localStorage.removeItem('alusa.remember');
          localStorage.removeItem('alusa.remember.email');
        }
      } catch { /* ignore */ }

      window.location.href = `/auth/loading?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    })();
  };

  const onError = (formErrors: FieldErrors<FormData>) => {
    if (formErrors.email) {
      toast.custom((t) => (
        <CustomToast
          title="E-mail inválido"
          description="Preencha corretamente seu e-mail."
          variant="error"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
      return;
    }
    if (formErrors.password) {
      toast.custom((t) => (
        <CustomToast
          title="Senha inválida"
          description="Digite sua senha corretamente."
          variant="error"
          onClose={() => { toast.dismiss(t); }}
        />
      ));
    }
  };

  return (
    <AuthShell>
      <div className="flex w-full max-w-[min(100%,21.5rem)] min-[400px]:max-w-[min(100%,24rem)] flex-col items-stretch text-left lg:max-w-[320px]">
        <h1 className="w-full text-left text-[1.375rem] font-semibold leading-snug tracking-tight text-gray-900 min-[400px]:text-[1.5rem] lg:hidden">
          Acesse sua conta
        </h1>
        <h1 className="mt-6 hidden text-left text-[30px] font-semibold leading-tight tracking-tight lg:mt-0 lg:block">
          Bem-vindo de volta!
        </h1>
        <p className="mt-2 hidden text-left text-[12px] font-medium leading-normal text-brand-muted lg:block">
          Informe seu e-mail e senha para acessar
          <br />
          sua conta na alusa.
        </p>
        <form
          method="post"
          action="/auth/login"
          onSubmit={(e) => { void handleSubmit(onSubmit, onError)(e); }}
          data-testid="login-form"
          className="mt-7 flex w-full flex-col items-stretch gap-3.5 min-[400px]:mt-8 min-[400px]:gap-4 lg:mt-6 lg:gap-4"
          noValidate
        >
          <div className="relative h-12 w-full min-[400px]:h-14 lg:h-12">
            <input
              type="email"
              data-testid="email"
              placeholder="Digite seu E-mail"
              autoComplete="email"
              aria-invalid={!!errors.email || undefined}
              className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base lg:h-12 lg:text-[14px]"
              {...register('email')}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted min-[400px]:right-[1.125rem] lg:right-4" aria-hidden>
              <User className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem] lg:h-4 lg:w-4" />
            </span>
          </div>
          <div className="relative h-12 w-full min-[400px]:h-14 lg:h-12">
            <input
              type={showPassword ? 'text' : 'password'}
              data-testid="password"
              placeholder="Digite sua senha"
              autoComplete="current-password"
              aria-invalid={!!errors.password || undefined}
              className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base lg:h-12 lg:text-[14px]"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => { setShowPassword(s => !s); }}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-brand-muted outline-none min-[400px]:right-3.5 lg:right-3 lg:p-1"
            >
              {showPassword ? <EyeOff className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem] lg:h-4 lg:w-4" /> : <Eye className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem] lg:h-4 lg:w-4" />}
            </button>
          </div>
          <div className="flex w-full items-center justify-between gap-2 text-[0.8125rem] font-medium min-[400px]:text-sm lg:text-[12px]">
            <label className="flex cursor-pointer select-none items-center gap-2 py-1 lg:py-0">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => { setRemember(e.target.checked); }}
                className="h-4 w-4 shrink-0 rounded-[5px] border border-brand-accent accent-[#3e1f63] outline-none min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem] lg:h-4 lg:w-4"
              />
              <span className="text-[#686868]">Lembrar-me</span>
            </label>
            <Link href="/auth/forgot-password" className="shrink-0 text-brand-accent outline-none hover:underline min-[400px]:text-sm lg:text-[12px]">
              Esqueceu sua senha?
            </Link>
          </div>
          <div className="mt-1 w-full">
            <button
              type="submit"
              data-testid="login-button"
              disabled={isSubmitting}
              className="flex h-12 w-full min-[400px]:h-14 items-center justify-center rounded-[12px] bg-[#3e1f63] text-[0.9375rem] font-medium text-white outline-none transition-colors hover:bg-[#4b217a] disabled:opacity-60 min-[400px]:text-base lg:h-12 lg:text-[14px]"
            >
              Fazer login
            </button>
          </div>
          <p className="mt-4 w-full text-left text-[0.8125rem] font-medium min-[400px]:text-sm lg:text-[11px]">
            <span className="text-[#686868]">Não tem uma conta? </span>
            <Link href="/auth/register" className="text-brand-accent hover:underline outline-none rounded">
              Cadastre-se
            </Link>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}