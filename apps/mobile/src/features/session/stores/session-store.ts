import { create } from 'zustand';

import type { PersistedSession, SessionStatus } from '../types/session';

type SessionState = {
  status: SessionStatus;
  session: PersistedSession | null;
  error: string | null;
  activeContaId: string | null;
  setBootstrapping(): void;
  setAnonymous(): void;
  setAuthenticated(_session: PersistedSession): void;
  setExpired(): void;
  setError(_message: string): void;
  setActiveContaId(_contaId: string | null): void;
};

function resolveActiveContaId(session: PersistedSession | null) {
  return session?.activeContaId ?? session?.user.contaId ?? session?.user.contas?.[0]?.id ?? null;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'bootstrapping',
  session: null,
  error: null,
  activeContaId: null,
  setBootstrapping: () => set({ status: 'bootstrapping', error: null }),
  setAnonymous: () => set({ status: 'anonymous', session: null, error: null, activeContaId: null }),
  setAuthenticated: (session) =>
    set({ status: 'authenticated', session, error: null, activeContaId: resolveActiveContaId(session) }),
  setExpired: () => set({ status: 'expired', session: null, activeContaId: null }),
  setError: (message) => set({ status: 'error', error: message, session: null, activeContaId: null }),
  setActiveContaId: (contaId) =>
    set((state) => ({
      activeContaId: contaId,
      session: state.session ? { ...state.session, activeContaId: contaId } : state.session,
    })),
}));
