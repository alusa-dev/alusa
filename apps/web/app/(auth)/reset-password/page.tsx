"use client";

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Eye, EyeOff } from '@/components/icons/icons';
import { toast } from '@/components/ui/toast';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import AuthShell from '@/components/auth/AuthShell';
import { CustomToast } from '@/components/ui/toast';

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Não foi possível redefinir"
            description={body.error || 'Confira o link e tente novamente.'}
            onClose={() => {
              toast.dismiss(t);
            }}
          />
        ));
        return;
      }

      setDone(true);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Senha atualizada"
          description="Agora você já pode fazer login com a nova senha."
          onClose={() => {
            toast.dismiss(t);
          }}
        />
      ));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageContainer>
      <AuthShell>
        <div className="w-full max-w-[320px] flex flex-col items-start px-0">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-left">
            Redefinir senha
          </h1>
          <p className="mt-2 text-[12px] font-medium text-brand-muted text-left">
            Defina uma nova senha para acessar sua conta.
          </p>

          {!token ? (
            <div className="mt-6 w-full rounded-[16px] border border-[#eadfce] bg-white px-5 py-4 text-[13px] text-[#5c544b]">
              Link inválido. Solicite um novo e-mail de redefinição.
            </div>
          ) : done ? (
            <div className="mt-6 w-full flex flex-col gap-4">
              <div className="rounded-[16px] border border-[#eadfce] bg-white px-5 py-4 text-[13px] text-[#5c544b]">
                Sua senha foi alterada com sucesso.
              </div>
              <Link
                href="/auth/login?reset=success"
                className="w-full h-12 rounded-[12px] bg-[#3e1f63] text-white font-medium hover:opacity-95 transition-colors inline-flex items-center justify-center"
              >
                Fazer login
              </Link>
            </div>
          ) : (
            <form onSubmit={(event) => { void onSubmit(event); }} className="mt-6 flex flex-col gap-4 w-full" noValidate>
              <div className="relative w-full">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Nova senha"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowPassword((current) => !current);
                  }}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-brand-muted outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="relative w-full">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirmar nova senha"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                  }}
                  className="h-12 w-full rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmPassword((current) => !current);
                  }}
                  aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-brand-muted outline-none"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="px-1 text-[11px] font-medium leading-relaxed text-brand-muted">
                Use no mínimo 8 caracteres, com letra maiúscula, letra minúscula, número e caractere especial.
              </p>
              <button
                type="submit"
                disabled={loading || !password || !confirmPassword}
                className="w-full h-12 rounded-[12px] bg-[#3e1f63] text-white font-medium hover:opacity-95 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}