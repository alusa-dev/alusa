'use client';

import { useUserStore } from '@/lib/stores/user-store';

function safeCallbackUrl(callbackUrl: string): string {
  const target = new URL(callbackUrl, window.location.origin);
  return target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : '/';
}

function clearLocalSession(): void {
  useUserStore.getState().clear();
  try {
    sessionStorage.removeItem('alusa:user');
  } catch {
    // O estado em memória já foi removido; storage pode estar indisponível.
  }
}

async function endSession(path: string, callbackUrl: string): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  if (!response.ok) {
    throw new Error('Não foi possível encerrar a sessão com segurança. Tente novamente.');
  }

  clearLocalSession();
  window.location.assign(safeCallbackUrl(callbackUrl));
}

/** Encerra somente a sessão deste navegador. */
export function logoutCurrentSession(callbackUrl = '/'): Promise<void> {
  return endSession('/api/auth/logout', callbackUrl);
}

/** Revoga todas as sessões do usuário e encerra também o navegador atual. */
export function revokeAllSessions(callbackUrl = '/'): Promise<void> {
  return endSession('/api/auth/revoke-all-sessions', callbackUrl);
}
