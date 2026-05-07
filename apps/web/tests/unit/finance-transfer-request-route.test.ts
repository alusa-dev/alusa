import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/finance/transfers/request/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/auth-service', () => ({
  verifyCredentialsDetailed: vi.fn(),
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual<typeof import('@alusa/finance')>('@alusa/finance');

  return {
    ...actual,
    mapRequestWithdrawDTOToInput: vi.fn((data, meta) => ({ ...data, ...meta })),
    mapRequestWithdrawOutputToDTO: vi.fn((data) => data),
    requestWithdraw: vi.fn(async () => ({
      success: true,
      data: {
        transferId: 'tr_1',
        asaasTransferId: 'asaas_tr_1',
        externalReference: 'transfer:tr_1',
        status: 'PENDING',
        requestedAt: '2026-05-06T19:00:00.000Z',
        statusUpdatedAt: '2026-05-06T19:00:00.000Z',
      },
    })),
  };
});

describe('POST /api/finance/transfers/request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando a senha atual é inválida', async () => {
    const { getServerSession } = await import('next-auth');
    const { verifyCredentialsDetailed } = await import('@/lib/auth-service');
    const { requestWithdraw } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN', email: 'admin@alusa.test' },
    } as never);
    vi.mocked(verifyCredentialsDetailed).mockResolvedValue({ ok: false, reason: 'INVALID_PASSWORD' } as never);

    const response = await POST(
      new NextRequest('http://localhost:3000/api/finance/transfers/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        body: JSON.stringify({
          amount: '10.00',
          currentPassword: 'errada',
          destination: {
            type: 'PIX',
            pixAddressKey: 'financeiro@alusa.test',
            pixAddressKeyType: 'EMAIL',
          },
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'SENHA_INVALIDA' });
    expect(requestWithdraw).not.toHaveBeenCalled();
  });

  it('valida a senha e encaminha o saque quando a reautenticação confere', async () => {
    const { getServerSession } = await import('next-auth');
    const { verifyCredentialsDetailed } = await import('@/lib/auth-service');
    const { requestWithdraw, mapRequestWithdrawDTOToInput } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'FINANCEIRO', email: 'financeiro@alusa.test' },
    } as never);
    vi.mocked(verifyCredentialsDetailed).mockResolvedValue({
      ok: true,
      user: {
        id: 'u1',
        email: 'financeiro@alusa.test',
        nome: 'Financeiro',
        role: 'FINANCEIRO',
        contaId: 'c1',
        emailVerifiedAt: null,
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost:3000/api/finance/transfers/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'idem-2',
        },
        body: JSON.stringify({
          amount: '10.00',
          currentPassword: 'senha-correta',
          destination: {
            type: 'PIX',
            pixAddressKey: 'financeiro@alusa.test',
            pixAddressKeyType: 'EMAIL',
          },
          description: 'Transferência teste',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(verifyCredentialsDetailed).toHaveBeenCalledWith('financeiro@alusa.test', 'senha-correta', 'c1');
    expect(mapRequestWithdrawDTOToInput).toHaveBeenCalledWith(
      expect.not.objectContaining({ currentPassword: 'senha-correta' }),
      expect.objectContaining({ contaId: 'c1', idempotencyKey: 'idem-2', actorId: 'u1' }),
    );
    expect(requestWithdraw).toHaveBeenCalledTimes(1);
  });

  it('propaga chave Pix não encontrada como 400', async () => {
    const { getServerSession } = await import('next-auth');
    const { verifyCredentialsDetailed } = await import('@/lib/auth-service');
    const { requestWithdraw } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'FINANCEIRO', email: 'financeiro@alusa.test' },
    } as never);
    vi.mocked(verifyCredentialsDetailed).mockResolvedValue({
      ok: true,
      user: {
        id: 'u1',
        email: 'financeiro@alusa.test',
        nome: 'Financeiro',
        role: 'FINANCEIRO',
        contaId: 'c1',
        emailVerifiedAt: null,
      },
    } as never);
    vi.mocked(requestWithdraw).mockResolvedValueOnce({
      success: false,
      error: 'PIX_KEY_NAO_ENCONTRADA',
    } as never);

    const response = await POST(
      new NextRequest('http://localhost:3000/api/finance/transfers/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'idem-3',
        },
        body: JSON.stringify({
          amount: '10.00',
          currentPassword: 'senha-correta',
          destination: {
            type: 'PIX',
            pixAddressKey: 'chave-invalida',
            pixAddressKeyType: 'EMAIL',
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'PIX_KEY_NAO_ENCONTRADA' });
  });
});