"use client";

import React, { useState } from 'react';
import { Mail } from '@/components/icons/icons';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import { debugLog, isAuthDebug } from '@/lib/debug-logger';
import AuthShell from '@/components/auth/AuthShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const safeParse = async (r: Response): Promise<{ error?: string }> => {
    try {
      const j: unknown = await r.json();
      if (typeof j === 'object' && j !== null) {
        const rec = j as Record<string, unknown>;
        if (typeof rec.error === 'string') return { error: rec.error };
      }
      return {};
    } catch { return { error: 'Recuperação indisponível.' }; }
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (isAuthDebug) debugLog('forgot-password', 'request', { email });
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (res.status === 501) {
        const body = await safeParse(res);
        if (isAuthDebug) debugLog('forgot-password', 'unavailable', { status: res.status });
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Erro"
            description={body.error || 'Recuperação de senha indisponível.'}
            onClose={() => { toast.dismiss(t); }}
          />
        ));
      } else if (res.ok) {
        if (isAuthDebug) debugLog('forgot-password', 'success');
        toast.custom((t) => (
          <CustomToast
            variant="info"
            title="Verifique seu e-mail"
            description="Se existir cadastro, enviamos um link de redefinição."
            onClose={() => { toast.dismiss(t); }}
          />
        ));
      } else {
        if (isAuthDebug) debugLog('forgot-password', 'error', { status: res.status });
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Erro"
            description="Não foi possível enviar. Tente mais tarde."
            onClose={() => { toast.dismiss(t); }}
          />
        ));
      }
    } catch {
      if (isAuthDebug) debugLog('forgot-password', 'network-error');
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro de rede"
          description="Tente novamente."
          onClose={() => { toast.dismiss(t); }}
        />
      ));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageContainer>
      <AuthShell>
        <div className="flex w-[min(100%,21.5rem)] min-[400px]:w-[min(100%,24rem)] flex-col items-stretch self-center text-left lg:max-w-[320px] lg:w-full lg:self-auto">
          <header className="mb-6 w-full space-y-2 text-left lg:mb-8">
            <h1 className="w-full text-left text-[1.25rem] font-medium leading-snug tracking-tight text-brand-primary min-[400px]:text-[1.375rem] lg:text-[1.625rem] lg:font-semibold lg:leading-tight">
              Recuperar Senha
            </h1>
            <p className="text-left text-justify text-sm font-medium leading-relaxed text-brand-muted lg:text-[12px]">
              Informe o e-mail associado à sua conta para receber um link de redefinição de senha.
            </p>
          </header>
          <form
            onSubmit={(e) => { void onSubmit(e); }}
            className="flex w-full flex-col items-stretch gap-4 lg:items-start"
            noValidate
          >
            <div className="relative h-12 w-full lg:h-12">
              <label htmlFor="email" className="sr-only">E-mail</label>
              <input
                id="email"
                type="email"
                placeholder="Digite seu E-mail"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); }}
                className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-4 pr-11 text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 lg:h-12 lg:pl-5 lg:pr-11 lg:text-[14px]"
                aria-invalid={email.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'true' : undefined}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted lg:right-4" aria-hidden>
                <Mail className="h-4 w-4 lg:h-4 lg:w-4" />
              </span>
            </div>
            <button
              type="submit"
              disabled={loading || email.trim().length === 0}
              className="flex h-12 w-full items-center justify-center rounded-[12px] bg-[#3e1f63] text-base font-medium text-white outline-none transition-colors hover:bg-[#4b217a] disabled:opacity-60 lg:h-12 lg:text-[14px]"
            >
              {loading ? 'Enviando...' : 'Enviar link'}
            </button>
            <p className="mt-8 w-full text-left text-[0.8125rem] font-medium min-[400px]:text-sm lg:text-[11px]">
              <span className="text-[#686868]">Tenho uma conta? </span>
              <a href="/auth/login" className="text-brand-accent hover:underline">
                Fazer login
              </a>
            </p>
          </form>
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}
