import { describe, it, expect, vi } from 'vitest';
import { POST as handler } from '@/app/api/colaboradores/route';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
  }),
}));

vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));

vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertPlatformAccessForConta: vi.fn(),
}));

describe('API Colaboradores', () => {
  it('retorna 400 para payload inválido', async () => {
  const req = new NextRequest('http://localhost/api/colaboradores', { method: 'POST', body: JSON.stringify({}) });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });
});
