import type { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/errors';
import { authenticateWithBiometrics } from '@/lib/biometrics/local-authentication';
import {
  clearAllSavedAccessProfiles,
  clearBiometricSession,
  clearPersistedSession,
  readSavedAccessProfile,
  readPersistedSession,
  removeSavedAccessProfile,
  writeBiometricSession,
  writePersistedSession,
  writeSavedAccessProfile,
  updateSavedAccessProfilesUser,
} from './session-storage';
import { useSessionStore } from '../stores/session-store';
import type { PersistedSession, SavedAccessProfile } from '../types/session';

export { clearBiometricSession, removeSavedAccessProfile, updateSavedAccessProfile } from './session-storage';

function isExpired(session: PersistedSession) {
  return Boolean(session.expiresAt && Date.parse(session.expiresAt) <= Date.now());
}

export async function hydrateSession(
  refresh?: (_refreshToken: string, _session: PersistedSession) => Promise<PersistedSession>,
) {
  useSessionStore.getState().setBootstrapping();
  try {
    const savedProfile = await readSavedAccessProfile();
    if (useSessionStore.getState().status !== 'bootstrapping') return useSessionStore.getState().session;
    useSessionStore.getState().setSavedProfile(savedProfile);

    const session = await readPersistedSession();
    if (useSessionStore.getState().status !== 'bootstrapping') return useSessionStore.getState().session;
    if (!session) {
      useSessionStore.getState().setAnonymous();
      return null;
    }
    if (isExpired(session) && session.refreshToken && refresh) {
      try {
        const refreshedSession = await refresh(session.refreshToken, session);
        if (useSessionStore.getState().status !== 'bootstrapping') return useSessionStore.getState().session;
        await establishSession(refreshedSession);
        return refreshedSession;
      } catch {
        await expireSession();
        return null;
      }
    }
    if (isExpired(session)) {
      await expireSession();
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
  const profile = await writeSavedAccessProfile(session);
  await writePersistedSession(session);
  useSessionStore.getState().setSavedProfile(profile);
  useSessionStore.getState().setAuthenticated(session);
}

export async function establishBiometricSession(session: PersistedSession) {
  const profile = await writeBiometricSession(session);
  useSessionStore.getState().setSavedProfile(profile);
  useSessionStore.getState().setAuthenticated(session);
}

export async function enableBiometrics(session: PersistedSession) {
  const authenticated = await authenticateWithBiometrics();
  if (!authenticated) return false;

  const profile = await writeBiometricSession(session);
  useSessionStore.getState().setSavedProfile(profile);
  return true;
}

/** Disables biometric sign-in while preserving the current authenticated session. */
export async function disableBiometrics(session: PersistedSession) {
  const profile = useSessionStore.getState().savedProfile ?? (await writeSavedAccessProfile(session, true));
  const updatedProfile = await clearBiometricSession(profile);
  await writePersistedSession(session);
  useSessionStore.getState().setSavedProfile(updatedProfile);
  return updatedProfile;
}

export async function updateCurrentUser(changes: Partial<Pick<PersistedSession['user'], 'name' | 'foto'>>) {
  const state = useSessionStore.getState();
  if (!state.session) return;

  const nextSession = {
    ...state.session,
    user: { ...state.session.user, ...changes },
  } satisfies PersistedSession;
  await writePersistedSession(nextSession);
  const profiles = await updateSavedAccessProfilesUser(nextSession.user.id, changes);
  useSessionStore.getState().setAuthenticated(nextSession);
  useSessionStore.getState().setSavedProfile(
    profiles.find((profile) =>
      profile.user.id === nextSession.user.id &&
      (profile.activeContaId ?? profile.user.contaId) === (nextSession.activeContaId ?? nextSession.user.contaId),
    ) ?? null,
  );
}

async function selectFallbackProfile(current?: SavedAccessProfile | null) {
  if (!current) return null;
  const remaining = await removeSavedAccessProfile(current);
  return remaining[0] ?? null;
}

/** Removes the current saved access. Other saved access cards remain intact. */
export async function clearSession(queryClient?: QueryClient) {
  const currentProfile = useSessionStore.getState().savedProfile;
  await clearPersistedSession();
  const fallbackProfile = await selectFallbackProfile(currentProfile);
  queryClient?.clear();
  useSessionStore.getState().setSavedProfile(fallbackProfile);
  useSessionStore.getState().setAnonymous();
}

/** Locks the app locally while retaining the selected access for the account picker. */
export async function lockSession(queryClient?: QueryClient) {
  const currentSession = useSessionStore.getState().session;
  let savedProfile = useSessionStore.getState().savedProfile;
  if (!savedProfile && currentSession) {
    savedProfile = await writeSavedAccessProfile(currentSession);
  }
  await clearPersistedSession();
  queryClient?.clear();
  useSessionStore.getState().setSavedProfile(savedProfile);
  useSessionStore.getState().setAnonymous();
}

/** Invalidates only the current device credential; the user card remains available for password login. */
export async function expireSession(queryClient?: QueryClient) {
  const currentProfile = useSessionStore.getState().savedProfile;
  await clearPersistedSession();
  const profile = currentProfile ? await clearBiometricSession(currentProfile) : null;
  queryClient?.clear();
  useSessionStore.getState().setSavedProfile(profile);
  useSessionStore.getState().setExpired();
}

export async function clearAllSessions(queryClient?: QueryClient) {
  await clearPersistedSession();
  await clearAllSavedAccessProfiles();
  queryClient?.clear();
  useSessionStore.getState().setSavedProfile(null);
  useSessionStore.getState().setAnonymous();
}

export function requireAccessToken() {
  const token = useSessionStore.getState().session?.accessToken;
  if (!token) throw new ApiError({ code: 'UNAUTHORIZED', message: 'Sessão ausente.' });
  return token;
}
