'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import AuthShell from '@/components/auth/AuthShell';
import { CustomToast } from '@/components/ui/toast';
import { resolvePostVerificationRedirect } from '@/lib/safe-redirect';

export default function ConfirmEmailPage() {
  const { data: session, status, update } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const sessionRefreshRequestedRef = useRef(false);
  const callbackUrl = resolvePostVerificationRedirect(
    searchParams.get('callbackUrl'),
    session?.user?.role,
    (session?.user as { financeStatus?: string | null } | undefined)?.financeStatus,
    (session?.user as { financeIntegrationMode?: string | null } | undefined)?.financeIntegrationMode,
    (session?.user as { externalAsaasOnboardingStatus?: string | null } | undefined)?.externalAsaasOnboardingStatus,
  );

  // Força um refresh da sessão ao montar para capturar emailVerifiedAt que pode ter sido
  // atualizado no banco mas ainda não refletido no JWT cookie (ex: update() falhou na
  // página verify-email).
  useEffect(() => {
    if (status !== 'authenticated' || session?.user?.emailVerified || sessionRefreshRequestedRef.current) {
      return;
    }

    sessionRefreshRequestedRef.current = true;
    void update();
  }, [session?.user?.emailVerified, status, update]);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.emailVerified) {
      router.replace(callbackUrl);
    }
  }, [callbackUrl, router, session?.user?.emailVerified, status]);

  async function handleResend() {
    if (sending) return;
    setSending(true);

    try {
      const response = await fetch('/api/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callbackUrl }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Não foi possível reenviar"
            description={body.error || 'Tente novamente em alguns minutos.'}
            onClose={() => {
              toast.dismiss(t);
            }}
          />
        ));
        return;
      }

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="E-mail reenviado"
          description="Confira sua caixa de entrada e spam."
          onClose={() => {
            toast.dismiss(t);
          }}
        />
      ));
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthPageContainer>
      <AuthShell>
        <div className="flex w-full max-w-[360px] flex-col items-center gap-5 text-center">
          <div className="space-y-2">
            <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-pretty">
              Confirme seu e-mail
            </h1>
            <p className="text-[12px] font-medium text-brand-muted leading-relaxed text-pretty">
              Enviamos um link de confirmação para{' '}
              <span className="font-semibold text-[#4a3f35]">{session?.user?.email || 'seu e-mail'}</span>.
              Abra a mensagem para validar seu endereço e concluir a criação da conta.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                void handleResend();
              }}
              disabled={sending || status !== 'authenticated'}
              className="w-full h-12 rounded-[12px] bg-[#3e1f63] text-white font-medium hover:opacity-95 disabled:opacity-50 transition-colors"
            >
              {sending ? 'Reenviando...' : 'Reenviar e-mail'}
            </button>

            <button
              type="button"
              onClick={() => {
                void signOut({ callbackUrl: '/auth/login' });
              }}
              className="w-full h-12 rounded-[12px] border border-[#d8cec2] bg-white text-[#4a3f35] font-medium hover:bg-[#f6f0e8] transition-colors"
            >
              Sair da conta
            </button>
          </div>

          <p className="w-full text-center text-[11px] font-medium">
            <span className="text-[#686868]">Entrou com o e-mail errado? </span>
            <Link href="/auth/login" className="text-brand-accent hover:underline">
              Voltar para login
            </Link>
          </p>
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}
