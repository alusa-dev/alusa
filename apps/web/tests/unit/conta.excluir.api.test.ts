import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => {
  return {
    getServerSession: vi.fn(),
  };
});

vi.mock('@alusa/finance', () => {
  return {
    encerrarContaAlusa: vi.fn(async () => ({
      success: true,
      result: 'DEACTIVATED_INTERNAL',
      message: 'Conta encerrada. Integrações financeiras serão desativadas em seguida.',
      asaasAttempted: false,
      asaasSuccess: false,
    })),
  };
});

import { getServerSession } from 'next-auth';
import { encerrarContaAlusa } from '@alusa/finance';
import { POST } from '@/app/api/conta/excluir/route';

describe('POST /api/conta/excluir', () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'ADMIN' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 quando encerra a conta', async () => {
    const req = {
      json: async () => ({ confirmText: 'DESATIVAR', reason: 'encerramento' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result).toBe('DEACTIVATED_INTERNAL');
  });

  it('retorna 422 quando payload é inválido', async () => {
    const req = {
      json: async () => ({ confirmText: 'DESATIVAR' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('retorna 401 quando não autenticado', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const req = {
      json: async () => ({ confirmText: 'DESATIVAR', reason: 'encerramento' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando sem permissão', async () => {
    (encerrarContaAlusa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      errorCode: 'FORBIDDEN',
      message: 'Acesso negado.',
    });

    const req = {
      json: async () => ({ confirmText: 'DESATIVAR', reason: 'encerramento' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('retorna 409 quando lock está ativo', async () => {
    (encerrarContaAlusa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      errorCode: 'LOCK_NOT_ACQUIRED',
      message: 'Processo já em andamento. Tente novamente em instantes.',
    });

    const req = {
      json: async () => ({ confirmText: 'DESATIVAR', reason: 'encerramento' }),
      headers: new Headers(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(409);
  });
});