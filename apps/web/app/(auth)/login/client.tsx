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
import { logClientOperationalEvent } from '@/lib/observability/client-operational-log';
import { nextParamToRedirect } from '@/lib/safe-redirect';
import AuthShell from '@/components/auth/AuthShell';
import { Checkbox } from '@/components/ui/checkbox';

type LoginValidationReason =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'RATE_LIMITED'
  | 'UNEXPECTED_ERROR';

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'A senha deve ter ao menos 6 caracteres')
});
type FormData = z.infer<typeof schema>;
type LoginAccount = { id: string; name: string };

function showLoginErrorToast(reason: LoginValidationReason, authContext?: string) {
  if (reason === 'EMAIL_NOT_VERIFIED') {
    toast.custom((t) => (
      <CustomToast title="Confirme seu e-mail" description="Abra o link de confirmação enviado para este contexto e tente novamente." variant="warning" onClose={() => { toast.dismiss(t); }} />
    ));
    return;
  }
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

  if (reason === 'RATE_LIMITED') {
    toast.custom((t) => (
      <CustomToast
        title="Muitas tentativas"
        description="Aguarde alguns minutos antes de tentar novamente."
        variant="error"
        onClose={() => { toast.dismiss(t); }}
      />
    ));
    return;
  }

  if (reason === 'INVALID_CREDENTIALS') {
    toast.custom((t) => (
      <CustomToast
        title="Não foi possível entrar"
        description={<span>E-mail ou senha inválidos, ou acesso indisponível. <a href={`/auth/forgot-password?context=${authContext === 'OWNER' ? 'owner' : authContext === 'PORTAL' ? 'portal' : 'collaborator'}`} className="underline">Redefinir senha</a>.</span>}
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

async function validateLoginCredentials(data: FormData, authContext: string): Promise<{ ok: true; accounts: LoginAccount[] } | { ok: false; reason: LoginValidationReason }> {
  const response = await fetch('/api/auth/login/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, authContext }),
  });

      const body = (await response.json().catch(() => null)) as { ok?: boolean; reason?: LoginValidationReason; accounts?: LoginAccount[] } | null;

  if (response.ok && body?.ok) {
    return { ok: true, accounts: body.accounts ?? [] };
  }

  return { ok: false, reason: body?.reason ?? 'UNEXPECTED_ERROR' };
}

export default function LoginClient() {

  const sp = useSearchParams();
  // callbackUrl pode vir como ?callbackUrl=/algo ou legado ?next=/algo
  const rawCb = sp.get('callbackUrl') || sp.get('next');
  const requestedContext = sp.get('context');
  const authContext = requestedContext === 'owner' ? 'OWNER' : requestedContext === 'portal' ? 'PORTAL' : 'COLLABORATOR';
  const isPortal = authContext === 'PORTAL';
  const callbackUrl = nextParamToRedirect(rawCb) || (authContext === 'PORTAL' ? '/portal' : '/dashboard');
  const [accounts, setAccounts] = useState<LoginAccount[] | null>(null);
  const [selectedContaId, setSelectedContaId] = useState('');
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
      const validation = await validateLoginCredentials(data, authContext);
      if (!validation.ok) {
        setAccounts(null);
        setSelectedContaId('');
        showLoginErrorToast(validation.reason, authContext);
        return;
      }

      const chosenAccount = validation.accounts.find((account) => account.id === selectedContaId);
      if (validation.accounts.length > 1 && !chosenAccount) {
        setAccounts(validation.accounts);
        setSelectedContaId('');
        return;
      }
      setAccounts(null);
      const contaId = validation.accounts.length === 1 ? validation.accounts[0].id : chosenAccount?.id;
      if (!contaId) {
        showLoginErrorToast('INVALID_CREDENTIALS', authContext);
        return;
      }
      const res = await signIn('credentials', { email: data.email, password: data.password, authContext, contaId, redirect: false, callbackUrl });
      if (res?.error) {
        logClientOperationalEvent('auth.login.sign_in.failed');
        showLoginErrorToast('UNEXPECTED_ERROR', authContext);
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
    <AuthShell heroPosition="right" heroImageSrc="/images/auth/backgroud-login.webp" hideHeroCopy heroLogoVariant="white" heroSealVariant="negativo-branco" desktopFooter={
      <nav aria-label="Informações e suporte" className="flex items-center gap-2 text-center text-xs text-[#717171]">
        <Link href="mailto:contato@alusa.app" className="hover:underline">Suporte</Link>
        <span aria-hidden="true">-</span>
        <Link href="/termos" className="hover:underline">Termos de Uso</Link>
        <span aria-hidden="true">-</span>
        <Link href="/privacidade" className="hover:underline">Política de Privacidade</Link>
      </nav>
    }>
      <div className="flex w-full max-w-[24rem] flex-col items-stretch self-center p-0 text-left lg:w-[355px] lg:max-w-[355px] lg:self-auto">
        <h1 className="w-full text-left text-[1.25rem] font-medium leading-snug tracking-tight text-brand-primary min-[400px]:text-[1.375rem] lg:hidden">
          {isPortal ? 'Portal do aluno' : 'Bem-vindo de volta'}
        </h1>
        <h1 className="mt-6 hidden text-left text-[1.625rem] font-semibold leading-tight tracking-tight text-brand-primary lg:mt-0 lg:block">
          {isPortal ? 'Portal do aluno' : 'Bem-vindo de volta'}
        </h1>
        <p className="mt-2 hidden text-left text-[12px] font-medium leading-normal text-brand-muted lg:block">
          {isPortal ? 'Entre para acompanhar a vida escolar do aluno.' : 'Entre com seus dados para acessar sua conta.'}
        </p>
        {!isPortal && <nav aria-label="Tipo de acesso" className="mt-6 flex h-12 w-full gap-1 rounded-lg bg-[#f2f4f7] p-1">
          <Link aria-current={authContext === 'OWNER' ? 'page' : undefined} href="/auth/login?context=owner" className={`flex flex-1 items-center justify-center rounded-md text-xs font-medium ${authContext === 'OWNER' ? 'bg-white text-[#3d3a3f] shadow-sm' : 'text-[#717171]'}`}>Acesso do diretor</Link>
          <Link aria-current={authContext === 'COLLABORATOR' ? 'page' : undefined} href="/auth/login?context=collaborator" className={`flex flex-1 items-center justify-center rounded-md text-xs font-medium ${authContext === 'COLLABORATOR' ? 'bg-white text-[#3d3a3f] shadow-sm' : 'text-[#717171]'}`}>Acesso do colaborador</Link>
        </nav>}
        <form
          method="post"
          action="/auth/login"
          onSubmit={(e) => { void handleSubmit(onSubmit, onError)(e); }}
          data-testid="login-form"
          className="mt-6 flex w-full flex-col items-stretch gap-4 lg:mt-6"
          noValidate
        >
          <div className="relative h-12 w-full lg:h-12">
            <input
              type="email"
              data-testid="email"
              placeholder="Digite seu e-mail"
              autoComplete="email"
              aria-invalid={!!errors.email || undefined}
              className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-11 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:pl-5 lg:pr-11 lg:text-[14px]"
              {...register('email')}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted lg:right-4" aria-hidden>
              <User className="h-4 w-4 lg:h-4 lg:w-4" />
            </span>
          </div>
          {accounts && accounts.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Escolha a escola
              <select value={selectedContaId} onChange={(event) => setSelectedContaId(event.target.value)} required className="h-12 rounded-[12px] border border-gray-300 bg-white px-3">
                <option value="">Selecione uma escola</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
          ) : null}
          <div className="relative h-12 w-full lg:h-12">
            <input
              type={showPassword ? 'text' : 'password'}
              data-testid="password"
              placeholder="Digite sua senha"
              autoComplete="current-password"
              aria-invalid={!!errors.password || undefined}
              className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-11 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:pl-5 lg:pr-11 lg:text-[14px]"
              {...register('password')}
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
          <div className="flex w-full items-center justify-between gap-2 text-sm font-medium lg:text-[12px]">
            <label htmlFor="login-remember" className="flex cursor-pointer select-none items-center gap-2 py-1 lg:py-0">
              <Checkbox
                id="login-remember"
                checked={remember}
                onCheckedChange={setRemember}
                className="h-[18px] w-[18px] rounded-[4px] border-[#d0d5dd] shadow-none"
              />
              <span className="text-[#686868]">Lembrar-me</span>
            </label>
            <Link href={`/auth/forgot-password?context=${authContext === 'OWNER' ? 'owner' : authContext === 'PORTAL' ? 'portal' : 'collaborator'}`} className="shrink-0 py-2 text-brand-accent outline-none hover:underline lg:py-0 lg:text-[12px]">
              Esqueceu a senha?
            </Link>
          </div>
          <div className="mt-1 w-full">
            <button
              type="submit"
              data-testid="login-button"
              disabled={isSubmitting}
              className="flex h-12 w-full items-center justify-center rounded-[12px] bg-[#3e1f63] text-base font-medium text-white outline-none transition-colors hover:bg-[#4b217a] disabled:opacity-60 lg:h-12 lg:text-[14px]"
            >
              Entrar
            </button>
          </div>
          {!isPortal && <p className="mt-4 w-full text-left text-[0.8125rem] font-medium min-[400px]:text-sm lg:hidden">
            <span className="text-[#686868]">Não tem uma conta? </span>
            <Link href="/auth/register" className="text-brand-accent hover:underline outline-none rounded">
              Clique aqui
            </Link>
          </p>}
        </form>
      </div>
    </AuthShell>
  );
}
