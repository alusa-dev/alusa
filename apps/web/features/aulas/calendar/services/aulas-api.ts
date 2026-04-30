export function buildQueryString(params: Record<string, unknown>) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;

    if (Array.isArray(value)) {
      if (!value.length) return;
      searchParams.set(key, value.join(','));
      return;
    }

    searchParams.set(key, String(value));
  });

  return searchParams.toString();
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { detail?: string } | null)?.detail ??
      (json as { error?: string } | null)?.error ??
      'Não foi possível concluir a operação.';
    throw new Error(message);
  }

  return json as T;
}
