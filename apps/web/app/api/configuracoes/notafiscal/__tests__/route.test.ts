import { describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

describe('GET /api/configuracoes/notafiscal', () => {
  it('retorna 401 sem sessão', async () => {
    const { GET } = await import('@/app/api/configuracoes/notafiscal/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cobrancas/[id]/nota-fiscal', () => {
  it('retorna 401 sem sessão', async () => {
    const { GET } = await import('@/app/api/cobrancas/[id]/nota-fiscal/route');
    const res = await GET({} as never, { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(401);
  });
});
