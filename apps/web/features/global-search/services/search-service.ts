import { globalSearchResultDTOSchema } from '../dtos';

export async function fetchGlobalSearch(query: string, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({ q: query.trim() });
  const response = await fetch(`/api/search?${searchParams.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível carregar a busca.';
    throw new Error(message);
  }

  return globalSearchResultDTOSchema.parse(payload);
}