import type { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/errors';
import { clearPersistedSession, readPersistedSession, writePersistedSession } from './session-storage';
import { useSessionStore } from '../stores/session-store';
import type { PersistedSession } from '../types/session';

function isExpired(session: PersistedSession) {
  return Boolean(session.expiresAt && Date.parse(session.expiresAt) <= Date.now());
}

export async function hydrateSession() {
  useSessionStore.getState().setBootstrapping();
  try {
    const session = await readPersistedSession();
    if (!session) {
      useSessionStore.getState().setAnonymous();
      return null;
    }
    if (isExpired(session)) {
      await clearPersistedSession();
      useSessionStore.getState().setExpired();
      return null;
    }
    useSessionStore.getState().setAuthenticated(session);
    return session;
  } catch {
    useSessionStore.getState().setError('Não foi possível restaurar a sessão.');
    return null;
  }
}

export async function establishSession(session: PersistedSession) {
  await writePersistedSession(session);
  useSessionStore.getState().setAuthenticated(session);
}

export async function clearSession(queryClient?: QueryClient) {
  await clearPersistedSession();
  queryClient?.clear();
  useSessionStore.getState().setAnonymous();
}

export async function expireSession(queryClient?: QueryClient) {
  await clearPersistedSession();
  queryClient?.clear();
  useSessionStore.getState().setExpired();
}

export function requireAccessToken() {
  const token = useSessionStore.getState().session?.accessToken;
  if (!token) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'Sessão ausente.' });
  }
  return token;
}
