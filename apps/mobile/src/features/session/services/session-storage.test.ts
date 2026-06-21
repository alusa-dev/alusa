import {
  clearPersistedSession,
  readPersistedSession,
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
});
