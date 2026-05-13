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
        <div className="flex w-full max-w-[min(100%,21.5rem)] min-[400px]:max-w-[min(100%,24rem)] flex-col items-center px-0 text-center">
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-pretty min-[400px]:text-[2rem]">
            Redefinir senha
          </h1>
          <p className="mt-3 text-[0.8125rem] font-medium leading-relaxed text-[#5c5c5c] text-pretty min-[400px]:text-[0.9375rem]">
            Defina uma nova senha para acessar sua conta.
          </p>

          {!token ? (
            <div className="mt-7 w-full rounded-[16px] border border-[#eadfce] bg-white px-5 py-4 text-center text-[0.8125rem] text-[#5c544b] min-[400px]:mt-8 min-[400px]:text-[0.9375rem]">
              Link inválido. Solicite um novo e-mail de redefinição.
            </div>
          ) : done ? (
            <div className="mt-7 w-full flex min-[400px]:mt-8 flex-col gap-4">
              <div className="rounded-[16px] border border-[#eadfce] bg-white px-5 py-4 text-center text-[0.8125rem] text-[#5c544b] min-[400px]:text-[0.9375rem]">
                Sua senha foi alterada com sucesso.
              </div>
              <Link
                href="/auth/login?reset=success"
                className="inline-flex h-12 w-full min-[400px]:h-14 items-center justify-center rounded-[12px] bg-[#3e1f63] text-[0.9375rem] font-medium text-white transition-colors hover:opacity-95 min-[400px]:text-base"
              >
                Fazer login
              </Link>
            </div>
          ) : (
            <form onSubmit={(event) => { void onSubmit(event); }} className="mt-7 flex w-full flex-col gap-3.5 min-[400px]:mt-8 min-[400px]:gap-4" noValidate>
              <div className="relative h-12 w-full min-[400px]:h-14">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Nova senha"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowPassword((current) => !current);
                  }}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-2 text-brand-muted outline-none min-[400px]:right-3.5"
                >
                  {showPassword ? <EyeOff className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" /> : <Eye className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" />}
                </button>
              </div>
              <div className="relative h-12 w-full min-[400px]:h-14">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirmar nova senha"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                  }}
                  className="h-12 w-full min-[400px]:h-14 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[0.9375rem] text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 min-[400px]:text-base"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmPassword((current) => !current);
                  }}
                  aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-2 text-brand-muted outline-none min-[400px]:right-3.5"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" /> : <Eye className="h-4 w-4 min-[400px]:h-[1.125rem] min-[400px]:w-[1.125rem]" />}
                </button>
              </div>
              <p className="px-1 text-center text-[0.8125rem] font-medium leading-relaxed text-[#5c5c5c] min-[400px]:text-[0.9375rem]">
                Use no mínimo 8 caracteres, com letra maiúscula, letra minúscula, número e caractere especial.
              </p>
              <button
                type="submit"
                disabled={loading || !password || !confirmPassword}
                className="flex h-12 w-full min-[400px]:h-14 items-center justify-center rounded-[12px] bg-[#3e1f63] text-[0.9375rem] font-medium text-white transition-colors hover:opacity-95 disabled:opacity-50 min-[400px]:text-base"
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