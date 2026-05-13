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
        <div className="flex w-full max-w-[320px] flex-col items-center px-0 text-center">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-pretty">
            Recuperar senha
          </h1>
          <p className="mt-2 text-[12px] font-medium text-brand-muted text-pretty">
            Informe o e-mail cadastrado. Enviaremos um link para redefinir sua senha.
          </p>
          <form onSubmit={(e) => { void onSubmit(e); }} className="mt-6 flex w-full flex-col items-stretch gap-5" noValidate>
            <div className="relative w-full h-12">
              <label htmlFor="email" className="sr-only">E-mail</label>
              <input
                id="email"
                type="email"
                placeholder="Digite seu E-mail"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); }}
                className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
                aria-invalid={email.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'true' : undefined}
              />
              <Mail className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#828282]" aria-hidden />
            </div>
            <button
              type="submit"
              disabled={loading || email.trim().length === 0}
              className="w-full h-12 rounded-[12px] bg-[#3e1f63] text-white font-medium hover:opacity-95 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Enviando...' : 'Enviar link'}
            </button>
            <p className="mt-1 w-full text-center text-[11px] font-medium">
              <span className="text-[#686868]">Tenho uma conta? </span>
              <a href="/auth/login" className="text-[#5c2f91] hover:underline">Fazer login</a>
            </p>
          </form>
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}
