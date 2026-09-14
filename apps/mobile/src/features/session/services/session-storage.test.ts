import {
  clearBiometricSession,
  clearPersistedSession,
  readBiometricSession,
  readPersistedSession,
  readSavedAccessProfiles,
  writeBiometricSession,
  writePersistedSession,
} from './session-storage';
import type { SecureStorage } from '@/lib/storage/secure-storage';
import type { PersistedSession } from '../types/session';

function createStorage(initial: Record<string, string> = {}): SecureStorage & { data: Record<string, string> } {
  return {
    data: { ...initial },
    async getItem(key) {
      return this.data[key] ?? null;
    },
    async setItem(key, value) {
      this.data[key] = value;
    },
    async deleteItem(key) {
      delete this.data[key];
    },
  };
}

const session: PersistedSession = {
  version: 1,
  accessToken: 'access',
  user: { id: 'u1', email: 'user@alusa.test', contaId: 'c1' },
  activeContaId: 'c1',
};

const secondSession: PersistedSession = {
  version: 1,
  accessToken: 'second-access',
  user: { id: 'u2', email: 'second@alusa.test', contaId: 'c2' },
  activeContaId: 'c2',
};

describe('session storage', () => {
  it('hidrata sem sessão', async () => {
    await expect(readPersistedSession(createStorage())).resolves.toBeNull();
  });

  it('persiste e lê sessão válida', async () => {
    const storage = createStorage();
    await writePersistedSession(session, storage);
    await expect(readPersistedSession(storage)).resolves.toEqual(session);
  });

  it('limpa sessão inválida', async () => {
    const storage = createStorage({ 'alusa.mobile.session.v1': '{bad json' });
    await expect(readPersistedSession(storage)).resolves.toBeNull();
    expect(storage.data).toEqual({});
  });

  it('remove sessão no logout', async () => {
    const storage = createStorage();
    await writePersistedSession(session, storage);
    await clearPersistedSession(storage);
    await expect(readPersistedSession(storage)).resolves.toBeNull();
  });

  it('isola sessões biométricas por acesso salvo', async () => {
    const storage = createStorage();
    await writeBiometricSession(session, storage);
    await writeBiometricSession(secondSession, storage);

    const profiles = await readSavedAccessProfiles(storage);
    const firstProfile = profiles.find((profile) => profile.user.id === 'u1');
    const secondProfile = profiles.find((profile) => profile.user.id === 'u2');

    expect(firstProfile).toMatchObject({ biometricEnabled: true });
    expect(secondProfile).toMatchObject({ biometricEnabled: true });
    await expect(readBiometricSession(firstProfile!, storage)).resolves.toEqual(session);
    await expect(readBiometricSession(secondProfile!, storage)).resolves.toEqual(secondSession);
    await expect(readPersistedSession(storage)).resolves.toBeNull();

    await clearBiometricSession(firstProfile!, storage);
    await expect(readBiometricSession(firstProfile!, storage)).resolves.toBeNull();
    await expect(readBiometricSession(secondProfile!, storage)).resolves.toEqual(secondSession);
    await expect(readSavedAccessProfiles(storage)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ user: expect.objectContaining({ id: 'u1' }), biometricEnabled: false }),
      expect.objectContaining({ user: expect.objectContaining({ id: 'u2' }), biometricEnabled: true }),
    ]));
  });

  it('migra uma credencial biométrica legada para o acesso correspondente', async () => {
    const storage = createStorage({
      'alusa.mobile.biometric-session.v1': JSON.stringify(session),
    });
    const profile = {
      user: session.user,
      activeContaId: session.activeContaId,
      biometricEnabled: true,
    };

    await expect(readBiometricSession(profile, storage)).resolves.toEqual(session);
    expect(storage.data['alusa.mobile.biometric-session.v1']).toBeUndefined();
    expect(Object.keys(storage.data)).toEqual(expect.arrayContaining([
      'alusa.mobile.biometric-session.v1.u1%3Ac1',
    ]));
  });
});
