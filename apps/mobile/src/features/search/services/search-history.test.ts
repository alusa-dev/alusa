import type { SecureStorage } from '@/lib/storage/secure-storage';

import {
  addSearchHistory,
  clearSearchHistory,
  readSearchHistory,
  removeSearchHistory,
} from './search-history';

function createStorage(initial: Record<string, string> = {}): SecureStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    async getItem(key) {
      return data[key] ?? null;
    },
    async setItem(key, value) {
      data[key] = value;
    },
    async deleteItem(key) {
      delete data[key];
    },
  };
}

describe('search history', () => {
  it('keeps the newest term first and removes case-insensitive duplicates', async () => {
    const storage = createStorage();

    await addSearchHistory('  Alunos  ', storage);
    await addSearchHistory('cobranças', storage);
    const history = await addSearchHistory('ALUNOS', storage);

    expect(history).toEqual(['ALUNOS', 'cobranças']);
  });

  it('removes one term and clears the storage when the history is empty', async () => {
    const storage = createStorage();
    await addSearchHistory('Alunos', storage);
    await addSearchHistory('Cobranças', storage);

    await removeSearchHistory('alunos', storage);
    expect(await readSearchHistory(storage)).toEqual(['Cobranças']);

    await removeSearchHistory('cobranças', storage);
    expect(await readSearchHistory(storage)).toEqual([]);
    expect(storage.data).toEqual({});
  });

  it('clears all terms', async () => {
    const storage = createStorage();
    await addSearchHistory('Alunos', storage);

    await clearSearchHistory(storage);

    expect(await readSearchHistory(storage)).toEqual([]);
  });
});
