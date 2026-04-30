import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/auth/verify-email/route';

vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/auth-email-flow', () => ({
  verifyEmailByToken: vi.fn(),
}));

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 400 quando o body está vazio', async () => {
    const request = new Request('http://localhost:3000/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Token inválido.');
  });

  it('retorna 400 quando o JSON está malformado', async () => {
    const request = new Request('http://localhost:3000/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Token inválido.');
  });
});
