import { create } from 'zustand';

import type { BiometricProfile, PersistedSession, SavedAccessProfile, SessionStatus } from '../types/session';

type SessionState = {
  status: SessionStatus;
  session: PersistedSession | null;
  lockedProfile: BiometricProfile | null;
  savedProfile: SavedAccessProfile | null;
  error: string | null;
  activeContaId: string | null;
  setBootstrapping(): void;
  setAnonymous(): void;
  setLocked(_profile: BiometricProfile): void;
  setSavedProfile(_profile: SavedAccessProfile | null): void;
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
  lockedProfile: null,
  savedProfile: null,
  error: null,
  activeContaId: null,
  setBootstrapping: () => set({ status: 'bootstrapping', error: null }),
  setAnonymous: () => set({ status: 'anonymous', session: null, lockedProfile: null, error: null, activeContaId: null }),
  setLocked: (profile) =>
    set({ status: 'locked', session: null, lockedProfile: profile, savedProfile: profile, error: null, activeContaId: profile.activeContaId ?? profile.user.contaId ?? null }),
  setSavedProfile: (profile) => set({ savedProfile: profile }),
  setAuthenticated: (session) =>
    set({ status: 'authenticated', session, lockedProfile: null, error: null, activeContaId: resolveActiveContaId(session) }),
  setExpired: () => set({ status: 'expired', session: null, lockedProfile: null, activeContaId: null }),
  setError: (message) => set({ status: 'error', error: message, session: null, lockedProfile: null, activeContaId: null }),
  setActiveContaId: (contaId) =>
    set((state) => ({
      activeContaId: contaId,
      session: state.session ? { ...state.session, activeContaId: contaId } : state.session,
    })),
}));
