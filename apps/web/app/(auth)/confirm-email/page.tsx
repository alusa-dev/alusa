'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { logoutCurrentSession } from '@/lib/client/logout';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
      <AuthShell heroPosition="right" heroImageSrc="" desktopFooter={
        <nav aria-label="Informações e suporte" className="flex items-center gap-2 text-center text-xs text-[#717171]">
          <a href="mailto:contato@alusa.app" className="hover:underline">Suporte</a>
          <span aria-hidden="true">-</span>
          <a href="/termos" className="hover:underline">Termos de Uso</a>
          <span aria-hidden="true">-</span>
          <a href="/privacidade" className="hover:underline">Política de Privacidade</a>
        </nav>
      }>
        <div className="flex w-full max-w-[24rem] flex-col items-stretch gap-6 self-center p-0 text-left lg:w-[355px] lg:max-w-[355px] lg:self-auto">
          <div className="space-y-2">
            <h1 className="text-[1.25rem] font-semibold leading-tight tracking-tight text-pretty min-[400px]:text-[1.375rem] lg:text-[1.625rem]">
              Confirme seu e-mail
            </h1>
            <p className="text-sm font-medium leading-5 text-brand-muted">
              Enviamos um link de confirmação para{' '}
              <span className="font-semibold text-[#4a3f35]">{session?.user?.email || 'seu e-mail'}</span>.
              Abra a mensagem para validar seu endereço e concluir a criação da conta.
            </p>
          </div>

          <div className="flex w-full flex-col gap-4">
            <button
              type="button"
              onClick={() => {
                void handleResend();
              }}
              disabled={sending || status !== 'authenticated'}
              className="flex h-12 w-full items-center justify-center rounded-[12px] bg-[#3e1f63] text-sm font-medium text-white transition-colors hover:bg-[#4b217a] disabled:opacity-50"
            >
              {sending ? 'Reenviando...' : 'Reenviar e-mail'}
            </button>

            <button
              type="button"
              onClick={() => {
                void logoutCurrentSession('/auth/login');
              }}
              className="flex h-12 w-full items-center justify-center rounded-[12px] border border-gray-300 bg-white text-sm font-medium text-gray-900 transition-colors hover:bg-[#f6f3f7]"
            >
              Sair da conta
            </button>
          </div>

          <p className="w-full text-left text-sm font-medium">
            <span className="text-[#686868]">Entrou com o e-mail errado? </span>
            <Link href="/auth/login" className="text-brand-accent hover:underline">
              Voltar para o login
            </Link>
          </p>
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}
