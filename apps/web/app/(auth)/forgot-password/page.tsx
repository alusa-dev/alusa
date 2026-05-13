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
        <div className="flex w-full max-w-[min(100%,21.5rem)] min-[400px]:max-w-[min(100%,24rem)] flex-col items-center px-0 text-center">
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-pretty min-[400px]:text-[2rem]">
            Recuperar senha
          </h1>
          <p className="mt-3 text-[0.8125rem] font-medium leading-relaxed text-[#5c5c5c] text-pretty min-[400px]:text-[0.9375rem]">
            Informe o e-mail cadastrado. Enviaremos um link para redefinir sua senha.
          </p>
          <form onSubmit={(e) => { void onSubmit(e); }} className="mt-7 flex w-full flex-col items-stretch gap-4 min-[400px]:mt-8 min-[400px]:gap-5" noValidate>
            <div className="relative h-12 w-full min-[400px]:h-14">
              <label htmlFor="email" className="sr-only">E-mail</label>
              <input
                id="email"
                type="email"
                placeholder="Digite seu E-mail"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); }}
                className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base"
                aria-invalid={email.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'true' : undefined}
              />
              <Mail className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#828282] min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem] min-[400px]:right-[1.125rem]" aria-hidden />
            </div>
            <button
              type="submit"
              disabled={loading || email.trim().length === 0}
              className="flex h-12 w-full min-[400px]:h-14 items-center justify-center rounded-[12px] bg-[#3e1f63] text-[0.9375rem] font-medium text-white transition-colors hover:opacity-95 disabled:opacity-50 min-[400px]:text-base"
            >
              {loading ? 'Enviando...' : 'Enviar link'}
            </button>
            <p className="mt-1 w-full text-center text-[0.8125rem] font-medium min-[400px]:text-sm">
              <span className="text-[#686868]">Tenho uma conta? </span>
              <a href="/auth/login" className="text-[#5c2f91] hover:underline">Fazer login</a>
            </p>
          </form>
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}
