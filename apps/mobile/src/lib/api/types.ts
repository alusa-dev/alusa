export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiRequestOptions<TBody = unknown> = {
  method?: HttpMethod;
  path: string;
  body?: TBody;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
  accessToken?: string | null;
};

export type ApiClientOptions = {
  baseUrl: string;
  defaultTimeoutMs?: number;
  onUnauthorized?: () => void | Promise<void>;
  fetchImpl?: typeof fetch;
};
