'use client';

import { useUserStore } from '@/lib/stores/user-store';

function safeCallbackUrl(callbackUrl: string): string {
  const target = new URL(callbackUrl, window.location.origin);
  return target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : '/';
}

/** Revoga a sessão no servidor, remove os cookies e descarta dados locais. */
export async function logoutCurrentSession(callbackUrl = '/'): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  if (!response.ok) {
    throw new Error('Não foi possível encerrar a sessão com segurança. Tente novamente.');
  }

  useUserStore.getState().clear();
  try {
    sessionStorage.removeItem('alusa:user');
  } catch {
    // O estado em memória já foi removido; storage pode estar indisponível.
  }

  window.location.assign(safeCallbackUrl(callbackUrl));
}
