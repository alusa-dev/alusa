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

export class AulasApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(params: { message: string; status: number; code?: string; details?: unknown }) {
    super(params.message);
    this.name = 'AulasApiRequestError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
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
    const body = json as { detail?: string; error?: string; details?: unknown } | null;
    const message =
      body?.detail ??
      body?.error ??
      'Não foi possível concluir a operação.';
    throw new AulasApiRequestError({
      message,
      status: response.status,
      code: body?.error,
      details: body?.details,
    });
  }

  return json as T;
}
