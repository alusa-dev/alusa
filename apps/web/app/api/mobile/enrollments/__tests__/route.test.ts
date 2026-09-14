import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../route';

const { verifyMobileAccessToken, listMobileEnrollmentClasses } = vi.hoisted(() => ({
  verifyMobileAccessToken: vi.fn(),
  listMobileEnrollmentClasses: vi.fn(),
}));

vi.mock('@/lib/mobile-auth-service', () => ({ verifyMobileAccessToken }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/features/enrollments/server/mobile-enrollments.service', () => ({
  listMobileEnrollmentClasses,
  MobileEnrollmentUnauthorizedError: class MobileEnrollmentUnauthorizedError extends Error {},
}));

function request(token?: string) {
  return new NextRequest('http://localhost:3000/api/mobile/enrollments', {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe('GET /api/mobile/enrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recusa a consulta sem um token mobile válido', async () => {
    verifyMobileAccessToken.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(listMobileEnrollmentClasses).not.toHaveBeenCalled();
  });

  it('consulta a conta assinada no token e retorna as turmas', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', contaId: 'conta-1' });
    listMobileEnrollmentClasses.mockResolvedValue({ classes: [] });

    const response = await GET(request('access-token'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ classes: [] });
    expect(listMobileEnrollmentClasses).toHaveBeenCalledWith({ userId: 'user-1', contaId: 'conta-1' });
  });
});
