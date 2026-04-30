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
      <div className="flex flex-col items-start w-full max-w-[320px]">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-left">
          Bem-vindo de volta!
        </h1>
        <p className="mt-2 text-[12px] font-medium text-brand-muted text-left">
          Informe seu e-mail e senha para acessar<br />sua conta na alusa.
        </p>
        <form
          method="post"
          action="/auth/login"
          onSubmit={(e) => { void handleSubmit(onSubmit, onError)(e); }}
          data-testid="login-form"
          className="mt-6 flex flex-col gap-4 w-full items-start"
          noValidate
        >
          <div className="relative w-full h-12">
            <input
              type="email"
              data-testid="email"
              placeholder="Digite seu E-mail"
              autoComplete="email"
              aria-invalid={!!errors.email || undefined}
              className="w-full h-12 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
              {...register('email')}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted" aria-hidden>
              <User className="h-4 w-4" />
            </span>
          </div>
          <div className="relative w-full h-12">
            <input
              type={showPassword ? 'text' : 'password'}
              data-testid="password"
              placeholder="Digite sua senha"
              autoComplete="current-password"
              aria-invalid={!!errors.password || undefined}
              className="w-full h-12 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => { setShowPassword(s => !s); }}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted p-1 rounded outline-none"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex w-full justify-between text-[12px] font-medium">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => { setRemember(e.target.checked); }}
                className="h-4 w-4 rounded-[5px] border border-brand-accent accent-[#3e1f63] outline-none"
              />
              <span className="text-[#686868]">Lembrar-me</span>
            </label>
            <Link href="/auth/forgot-password" className="text-[12px] text-brand-accent hover:underline outline-none rounded">
              Esqueceu sua senha?
            </Link>
          </div>
          <div className="w-full mt-2">
            <button
              type="submit"
              data-testid="login-button"
              disabled={isSubmitting}
              className="w-full h-12 rounded-[12px] bg-[#3e1f63] hover:bg-[#4b217a] text-white text-[14px] font-medium flex items-center justify-center transition-colors outline-none disabled:opacity-60"
            >
              Fazer login
            </button>
          </div>
          <p className="text-left text-[11px] font-medium w-full mt-4">
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