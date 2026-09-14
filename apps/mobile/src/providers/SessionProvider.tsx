import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';

import { hydrateSession, lockSession } from '@/features/session/services/session-service';
import { authService } from '@/features/auth/services/auth-service';
import { useSessionStore } from '@/features/session/stores/session-store';

const REAUTHENTICATION_TIMEOUT_MS = 30_000;

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    hydrateSession((refreshToken, session) =>
      authService.refresh(refreshToken, session.activeContaId),
    ).catch(() => {
      if (active) queryClient.clear();
    });
    return () => {
      active = false;
    };
  }, [queryClient]);

  useEffect(() => {
    let appWasActive = AppState.currentState === 'active';
    let locking = false;
    let backgroundedAt: number | null = null;
    let lockTimer: ReturnType<typeof setTimeout> | null = null;
    let lockPromise: Promise<void> | null = null;
    let shouldUnlockOnResume = false;

    function clearLockTimer() {
      if (lockTimer) {
        clearTimeout(lockTimer);
        lockTimer = null;
      }
    }

    function lockForResume() {
      if (locking) return;
      const profile = useSessionStore.getState().savedProfile;
      // A sessão só pode ser bloqueada para retorno quando houver uma
      // credencial local capaz de desbloqueá-la sem pedir a senha da conta.
      if (!profile?.biometricEnabled) return;

      locking = true;
      shouldUnlockOnResume = true;
      lockPromise = lockSession(queryClient).finally(() => {
        locking = false;
      });
    }

    function redirectAfterLock() {
      const profile = useSessionStore.getState().savedProfile;
      if (profile?.biometricEnabled) {
        router.replace({ pathname: '/(public)/unlock', params: { reason: 'app-resume' } });
      }
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        appWasActive = true;
        const elapsed = backgroundedAt ? Date.now() - backgroundedAt : 0;
        const mustReauthenticate = shouldUnlockOnResume || elapsed >= REAUTHENTICATION_TIMEOUT_MS;
        backgroundedAt = null;
        clearLockTimer();

        if (!mustReauthenticate) return;

        if (!shouldUnlockOnResume) {
          lockForResume();
        }

        if (lockPromise) {
          shouldUnlockOnResume = false;
          void lockPromise.then(redirectAfterLock);
        }
        return;
      }
      if (nextState !== 'background' || !appWasActive || locking) return;

      const { status } = useSessionStore.getState();
      if (status !== 'authenticated') return;

      appWasActive = false;
      backgroundedAt = Date.now();
      clearLockTimer();
      lockTimer = setTimeout(() => {
        if (backgroundedAt) lockForResume();
      }, REAUTHENTICATION_TIMEOUT_MS);
    });

    return () => {
      clearLockTimer();
      subscription.remove();
    };
  }, [queryClient]);

  return children;
}
