import {
  clearBiometricSession,
  clearPersistedSession,
  clearAllSavedAccessProfiles,
  readBiometricSession,
  readPersistedSession,
  readSavedAccessProfiles,
  removeSavedAccessProfile,
  writeBiometricSession,
  writePersistedSession,
} from './session-storage';
import type { SecureStorage } from '@/lib/storage/secure-storage';
import type { PersistedSession } from '../types/session';

function createStorage(initial: Record<string, string> = {}, validateKey = false): SecureStorage & { data: Record<string, string> } {
  const assertValidKey = (key: string) => {
    if (validateKey && !/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid SecureStore key: ${key}`);
  };
  return {
    data: { ...initial },
    async getItem(key) {
      assertValidKey(key);
      return this.data[key] ?? null;
    },
    async setItem(key, value) {
      assertValidKey(key);
      this.data[key] = value;
    },
    async deleteItem(key) {
      assertValidKey(key);
      delete this.data[key];
    },
  };
}

const session: PersistedSession = {
  version: 1,
  accessToken: 'access',
  authContext: 'OWNER',
  user: { id: 'u1', email: 'user@alusa.test', contaId: 'c1' },
  activeContaId: 'c1',
};

const secondSession: PersistedSession = {
  version: 1,
  accessToken: 'second-access',
  authContext: 'COLLABORATOR',
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

  it('migra contexto ausente em sessão legada pelo papel do usuário e persiste a migração', async () => {
    const legacySession = { ...session, authContext: undefined, user: { ...session.user, role: 'RESPONSAVEL' } };
    const storage = createStorage({ 'alusa.mobile.session.v1': JSON.stringify(legacySession) });

    await expect(readPersistedSession(storage)).resolves.toMatchObject({ authContext: 'PORTAL' });
    expect(JSON.parse(storage.data['alusa.mobile.session.v1']!).authContext).toBe('PORTAL');
  });

  it('prefere o contexto do perfil salvo ao migrar uma sessão sem contexto nem papel', async () => {
    const legacySession = { ...session, authContext: undefined, user: { ...session.user, role: undefined } };
    const storage = createStorage({ 'alusa.mobile.session.v1': JSON.stringify(legacySession) });

    await expect(readPersistedSession(storage, 'COLLABORATOR')).resolves.toMatchObject({ authContext: 'COLLABORATOR' });
  });

  it('persiste o contexto selecionado no perfil salvo', async () => {
    const storage = createStorage();
    await writeBiometricSession(secondSession, storage);

    await expect(readSavedAccessProfiles(storage)).resolves.toEqual([
      expect.objectContaining({ authContext: 'COLLABORATOR', biometricEnabled: true }),
    ]);
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

  it('gera e remove chave biométrica válida no SecureStore com identificadores especiais', async () => {
    const specialSession: PersistedSession = {
      ...session,
      user: { id: 'usuário:1', email: 'user@alusa.test' },
      activeContaId: 'conta.á-1',
    };
    const storage = createStorage({}, true);
    await writeBiometricSession(specialSession, storage);

    const biometricKeys = Object.keys(storage.data).filter((key) => key.startsWith('alusa.mobile.biometric-session.v1.'));
    expect(biometricKeys).toHaveLength(1);
    expect(biometricKeys[0]).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(biometricKeys[0]).not.toContain('%');

    const [profile] = await readSavedAccessProfiles(storage);
    await expect(removeSavedAccessProfile(profile!, storage)).resolves.toEqual([]);
    expect(storage.data[biometricKeys[0]!]).toBeUndefined();
  });

  it('limpa biometria e remove perfis legados mesmo quando a chave antiga é inválida', async () => {
    const legacyProfile = {
      user: { id: 'u1', email: 'user@alusa.test', contaId: 'c1' },
      activeContaId: 'c1',
      biometricEnabled: true,
    };
    const storage = createStorage({
      'alusa.mobile.saved-access-profile.v1': JSON.stringify([legacyProfile]),
    }, true);
    const [profile] = await readSavedAccessProfiles(storage);

    await expect(clearBiometricSession(profile!, storage)).resolves.toMatchObject({ biometricEnabled: false });
    await expect(removeSavedAccessProfile(profile!, storage)).resolves.toEqual([]);
    await expect(clearAllSavedAccessProfiles(storage)).resolves.toBeUndefined();
  });

  it('migra uma credencial biométrica legada para o acesso correspondente', async () => {
    const storage = createStorage({
      'alusa.mobile.biometric-session.v1': JSON.stringify(session),
    });
    const profile = {
      user: session.user,
      activeContaId: session.activeContaId,
      authContext: session.authContext!,
      biometricEnabled: true,
    };

    await expect(readBiometricSession(profile, storage)).resolves.toEqual(session);
    expect(storage.data['alusa.mobile.biometric-session.v1']).toBeUndefined();
    expect(Object.keys(storage.data)).toEqual(expect.arrayContaining([
      'alusa.mobile.biometric-session.v1.u-75-31-3a-63-31',
    ]));
  });

  it('migra perfis salvos legados sem contexto para OWNER', async () => {
    const storage = createStorage({
      'alusa.mobile.saved-access-profile.v1': JSON.stringify([{
        user: { id: 'u1', email: 'user@alusa.test' },
        activeContaId: 'c1',
        biometricEnabled: false,
      }]),
    });

    const profiles = await readSavedAccessProfiles(storage);
    expect(profiles[0]?.authContext).toBe('OWNER');
    expect(JSON.parse(storage.data['alusa.mobile.saved-access-profile.v1']!)[0].authContext).toBe('OWNER');
  });
});
