'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import AuthShell from '@/components/auth/AuthShell';
import { resolvePostVerificationRedirect } from '@/lib/safe-redirect';

type VerificationState = 'loading' | 'success' | 'error';

const VERIFY_EMAIL_TIMEOUT_MS = 12000;
const SESSION_UPDATE_TIMEOUT_MS = 4000;
const SUCCESS_REDIRECT_DELAY_MS = 1200;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new Error('timeout'));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const { data: session, update } = useSession();
  const [state, setState] = useState<VerificationState>('loading');
  const [message, setMessage] = useState('Validando seu link...');
  const [verifiedContext, setVerifiedContext] = useState<'OWNER' | 'COLLABORATOR' | 'PORTAL' | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRef = useRef(update);

  const token = searchParams.get('token');
  const inviteToken = searchParams.get('inviteToken');
  const callbackUrl = resolvePostVerificationRedirect(
    searchParams.get('callbackUrl'),
    session?.user?.role,
    (session?.user as { financeStatus?: string | null } | undefined)?.financeStatus,
    (session?.user as { financeIntegrationMode?: string | null } | undefined)?.financeIntegrationMode,
    (session?.user as { externalAsaasOnboardingStatus?: string | null } | undefined)?.externalAsaasOnboardingStatus,
  );
  const isReactivationFlow = callbackUrl.includes('reactivated=1');
  const destination = inviteToken
    ? `/auth/login?context=${verifiedContext === 'PORTAL' ? 'portal' : verifiedContext === 'OWNER' ? 'owner' : 'collaborator'}`
    : callbackUrl;

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('Link inválido. Solicite um novo e-mail de confirmação.');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await withTimeout(
          fetch('/api/auth/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, ...(inviteToken ? { inviteToken } : {}) }),
            signal: controller.signal,
          }),
          VERIFY_EMAIL_TIMEOUT_MS,
          () => controller.abort(),
        );

        const body = (await response.json().catch(() => ({}))) as { error?: string; inviteAccepted?: boolean; inviteError?: string; context?: 'OWNER' | 'COLLABORATOR' | 'PORTAL' | null };

        if (!response.ok) {
          if (cancelled) {
            return;
          }

          setState('error');
          setMessage(body.error || 'Não foi possível confirmar o e-mail.');
          return;
        }

        try {
          await withTimeout(updateRef.current({ user: { emailVerified: true } } as never), SESSION_UPDATE_TIMEOUT_MS);
        } catch {
          // seguir mesmo sem atualizar a sessão em memória
        }

        if (body.context === 'OWNER' || body.context === 'COLLABORATOR' || body.context === 'PORTAL') setVerifiedContext(body.context);

        if (cancelled) {
          return;
        }

        setState('success');
        setMessage(isReactivationFlow
          ? 'Conta reativada com sucesso.'
          : body.inviteAccepted
            ? 'E-mail confirmado e convite aceito. Faça login para acessar sua conta.'
            : body.inviteError
              ? `E-mail confirmado. ${body.inviteError}`
              : 'E-mail confirmado com sucesso.');
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setState('error');
        setMessage('Não foi possível confirmar o e-mail. Tente abrir o link novamente.');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [inviteToken, isReactivationFlow, token]);

  useEffect(() => {
    if (state !== 'success') {
      return;
    }

    redirectTimeoutRef.current = setTimeout(() => {
      window.location.replace(destination);
    }, SUCCESS_REDIRECT_DELAY_MS);

    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    };
  }, [destination, state]);

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
              {state === 'success'
                ? isReactivationFlow
                  ? 'Conta reativada'
                  : 'E-mail confirmado'
                : state === 'error'
                  ? 'Falha na confirmação'
                  : 'Confirmando e-mail'}
            </h1>
            <p className="text-sm font-medium leading-5 text-brand-muted">
              {message}
            </p>
          </div>

          {state !== 'loading' && (
            <div className="flex w-full flex-col gap-4">
              <Link
                href={state === 'success' ? destination : '/auth/confirm-email'}
                className="inline-flex h-12 w-full items-center justify-center rounded-[12px] bg-[#3e1f63] text-sm font-medium text-white transition-colors hover:bg-[#4b217a]"
              >
                {state === 'success' ? (isReactivationFlow || inviteToken ? 'Fazer login' : 'Continuar') : 'Voltar'}
              </Link>
              {state === 'error' && (
                <Link
                  href="/auth/login"
                  className="inline-flex h-12 w-full items-center justify-center rounded-[12px] border border-gray-300 bg-white text-sm font-medium text-gray-900 transition-colors hover:bg-[#f6f3f7]"
                >
                  Fazer login
                </Link>
              )}
            </div>
          )}
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}
