import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => {
  return {
    getServerSession: vi.fn(),
  };
});

vi.mock('@alusa/finance', () => {
  return {
    testarConexaoAsaas: vi.fn(async () => ({
      success: true,
      summary: 'Conexão com o Asaas validada com sucesso.',
      checks: { env: 'ok', auth: 'ok', account: 'ok', webhook: 'skipped' },
    })),
  };
});

import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/admin/teste-asaas/route';

describe('POST /api/admin/teste-asaas', () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { contaId: 'conta-1', role: 'ADMIN' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 quando teste é sucesso', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('retorna 401 quando não autenticado', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando sem permissão', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { contaId: 'conta-1', role: 'PROFESSOR' },
    });
    const res = await POST();
    expect(res.status).toBe(403);
  });
});
