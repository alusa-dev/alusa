import { describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

describe('GET /api/configuracoes/notafiscal/referencias/[kind]', () => {
  it('retorna 401 sem sessão', async () => {
    const { GET } = await import('@/app/api/configuracoes/notafiscal/referencias/[kind]/route');
    const res = await GET({} as never, {
      params: Promise.resolve({ kind: 'federalServiceCodes' }),
    });
    expect(res.status).toBe(401);
  });

  it('retorna 404 para kind inválido', async () => {
    vi.doMock('next-auth', () => ({
      getServerSession: vi.fn().mockResolvedValue({
        user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
      }),
    }));
    const { GET } = await import('@/app/api/configuracoes/notafiscal/referencias/[kind]/route');
    const res = await GET({} as never, {
      params: Promise.resolve({ kind: 'invalidKind' }),
    });
    expect(res.status).toBe(404);
  });
});
