import { NextResponse } from 'next/server';

export const NO_STORE_HEADERS = {
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache',
} as const;

export const SENSITIVE_RESPONSE_HEADERS = {
  ...NO_STORE_HEADERS,
  'x-robots-tag': 'noindex, nofollow',
} as const;

function mergeHeaders(base: HeadersInit, extra?: HeadersInit): HeadersInit {
  const headers = new Headers(base);
  if (extra) {
    const extraHeaders = new Headers(extra);
    extraHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

export function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: mergeHeaders(NO_STORE_HEADERS, init?.headers),
  });
}

export function jsonSensitive(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: mergeHeaders(SENSITIVE_RESPONSE_HEADERS, init?.headers),
  });
}
