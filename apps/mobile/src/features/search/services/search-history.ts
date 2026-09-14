import { secureStorage, type SecureStorage } from '@/lib/storage/secure-storage';

const SEARCH_HISTORY_KEY = 'alusa.mobile.search-history.v1';
const MAX_HISTORY_ITEMS = 10;

function normalizeHistory(items: unknown): string[] {
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const history: string[] = [];

  for (const item of items) {
    if (typeof item !== 'string') continue;

    const term = item.trim();
    const normalized = term.toLocaleLowerCase();
    if (!term || seen.has(normalized)) continue;

    seen.add(normalized);
    history.push(term);
    if (history.length === MAX_HISTORY_ITEMS) break;
  }

  return history;
}

export async function readSearchHistory(storage: SecureStorage = secureStorage): Promise<string[]> {
  const raw = await storage.getItem(SEARCH_HISTORY_KEY);
  if (!raw) return [];

  try {
    return normalizeHistory(JSON.parse(raw));
  } catch {
    await storage.deleteItem(SEARCH_HISTORY_KEY);
    return [];
  }
}

export async function addSearchHistory(term: string, storage: SecureStorage = secureStorage): Promise<string[]> {
  const trimmedTerm = term.trim();
  if (!trimmedTerm) return readSearchHistory(storage);

  const history = await readSearchHistory(storage);
  const normalizedTerm = trimmedTerm.toLocaleLowerCase();
  const nextHistory = [
    trimmedTerm,
    ...history.filter((item) => item.toLocaleLowerCase() !== normalizedTerm),
  ].slice(0, MAX_HISTORY_ITEMS);

  await storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory));
  return nextHistory;
}

export async function removeSearchHistory(term: string, storage: SecureStorage = secureStorage): Promise<string[]> {
  const normalizedTerm = term.trim().toLocaleLowerCase();
  const history = await readSearchHistory(storage);
  const nextHistory = history.filter((item) => item.toLocaleLowerCase() !== normalizedTerm);

  if (nextHistory.length === 0) {
    await storage.deleteItem(SEARCH_HISTORY_KEY);
  } else {
    await storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory));
  }

  return nextHistory;
}

export async function clearSearchHistory(storage: SecureStorage = secureStorage): Promise<void> {
  await storage.deleteItem(SEARCH_HISTORY_KEY);
}
