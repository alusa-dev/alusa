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
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRef = useRef(update);

  const token = searchParams.get('token');
  const callbackUrl = resolvePostVerificationRedirect(
    searchParams.get('callbackUrl'),
    session?.user?.role,
    (session?.user as { financeStatus?: string | null } | undefined)?.financeStatus,
    (session?.user as { financeIntegrationMode?: string | null } | undefined)?.financeIntegrationMode,
    (session?.user as { externalAsaasOnboardingStatus?: string | null } | undefined)?.externalAsaasOnboardingStatus,
  );
  const isReactivationFlow = callbackUrl.includes('reactivated=1');

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
            body: JSON.stringify({ token }),
            signal: controller.signal,
          }),
          VERIFY_EMAIL_TIMEOUT_MS,
          () => controller.abort(),
        );

        const body = (await response.json().catch(() => ({}))) as { error?: string };

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

        if (cancelled) {
          return;
        }

        setState('success');
        setMessage(isReactivationFlow ? 'Conta reativada com sucesso.' : 'E-mail confirmado com sucesso.');
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
  }, [isReactivationFlow, token]);

  useEffect(() => {
    if (state !== 'success') {
      return;
    }

    redirectTimeoutRef.current = setTimeout(() => {
      window.location.replace(callbackUrl);
    }, SUCCESS_REDIRECT_DELAY_MS);

    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    };
  }, [callbackUrl, state]);

  return (
    <AuthPageContainer>
      <AuthShell>
        <div className="flex w-full max-w-[360px] flex-col items-center gap-5 text-center">
          <div className="space-y-2">
            <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-pretty">
              {state === 'success'
                ? isReactivationFlow
                  ? 'Conta reativada'
                  : 'E-mail confirmado'
                : state === 'error'
                  ? 'Falha na confirmação'
                  : 'Confirmando e-mail'}
            </h1>
            <p className="text-[12px] font-medium text-brand-muted leading-relaxed text-pretty">
              {message}
            </p>
          </div>

          {state !== 'loading' && (
            <div className="flex w-full flex-col gap-3">
              <Link
                href={state === 'success' ? callbackUrl : '/auth/confirm-email'}
                className="w-full h-12 rounded-[12px] bg-[#3e1f63] text-white font-medium hover:opacity-95 transition-colors inline-flex items-center justify-center"
              >
                {state === 'success' ? (isReactivationFlow ? 'Ir para login' : 'Continuar') : 'Voltar'}
              </Link>
              {state === 'error' && (
                <Link
                  href="/auth/login"
                  className="w-full h-12 rounded-[12px] border border-[#d8cec2] bg-white text-[#4a3f35] font-medium hover:bg-[#f6f0e8] transition-colors inline-flex items-center justify-center"
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
