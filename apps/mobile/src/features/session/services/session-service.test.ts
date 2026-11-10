import * as SecureStore from 'expo-secure-store';

import { establishSession } from './session-service';
import { useSessionStore } from '../stores/session-store';
import type { PersistedSession, SavedAccessProfile } from '../types/session';

const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;

describe('session service auth context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getItemAsync.mockResolvedValue(null);
    setItemAsync.mockResolvedValue(undefined);
    useSessionStore.getState().setAnonymous();
    useSessionStore.getState().setSavedProfile(null);
  });

  it('preserva o contexto salvo ao reestabelecer sessão sem contexto no retorno da API', async () => {
    const savedProfile: SavedAccessProfile = {
      user: { id: 'u1', email: 'portal@alusa.test' },
      activeContaId: 'c1',
      authContext: 'PORTAL',
      biometricEnabled: false,
    };
    const refreshedSession: PersistedSession = {
      version: 1,
      accessToken: 'refreshed-access',
      refreshToken: 'refreshed-token',
      user: savedProfile.user,
      activeContaId: 'c1',
    };
    useSessionStore.getState().setSavedProfile(savedProfile);

    await establishSession(refreshedSession);

    expect(useSessionStore.getState().session?.authContext).toBe('PORTAL');
    expect(setItemAsync).toHaveBeenCalledWith(
      'alusa.mobile.session.v1',
      expect.stringContaining('"authContext":"PORTAL"'),
      expect.any(Object),
    );
  });
});
