import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTenantSession: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({
  resolveTenantSession: mocks.resolveTenantSession,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveTenantSession.mockResolvedValue({ ok: false, reason: 'UNAUTHENTICATED' });
});

describe('GET /api/configuracoes/notafiscal/referencias/[kind]', () => {
  it('retorna 401 sem sessão', async () => {
    const { GET } = await import('@/app/api/configuracoes/notafiscal/referencias/[kind]/route');
    const res = await GET({} as never, {
      params: Promise.resolve({ kind: 'federalServiceCodes' }),
    });
    expect(res.status).toBe(401);
  });

  it('retorna 404 para kind inválido', async () => {
    const { GET } = await import('@/app/api/configuracoes/notafiscal/referencias/[kind]/route');
    const res = await GET({} as never, {
      params: Promise.resolve({ kind: 'invalidKind' }),
    });
    expect(res.status).toBe(404);
  });
});
