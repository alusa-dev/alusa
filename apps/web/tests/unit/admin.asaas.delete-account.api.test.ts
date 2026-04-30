import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => {
  return {
    getServerSession: vi.fn(),
  };
});

vi.mock('@alusa/finance', () => {
  return {
    excluirContaAlusaEAsaas: vi.fn(async () => ({
      success: true,
      status: 'deleted',
      summary: 'Conta excluída com sucesso (Asaas + Alusa).',
      asaasDeleted: true,
      localDeleted: true,
      steps: [],
      debugSafe: { financeProfileId: 'fp1', asaasAccountIdMasked: 'acc_***' },
    })),
  };
});

import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/admin/asaas/delete-account/route';

describe('POST /api/admin/asaas/delete-account', () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'ADMIN' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 quando exclusão é sucesso', async () => {
    const req = {
      json: async () => ({ confirmText: 'DELETAR', removeReason: 'encerramento' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('retorna 400 quando payload é inválido', async () => {
    const req = {
      json: async () => ({ confirmText: 'DELETAR' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('retorna 401 quando não autenticado', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const req = {
      json: async () => ({ confirmText: 'DELETAR', removeReason: 'encerramento' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando sem permissão', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });

    const req = {
      json: async () => ({ confirmText: 'DELETAR', removeReason: 'encerramento' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
