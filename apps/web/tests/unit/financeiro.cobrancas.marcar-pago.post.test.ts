/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { markChargeAsPaidMock } = vi.hoisted(() => ({
  markChargeAsPaidMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => {
  class KycNotApprovedError extends Error {}
  class AsaasEnvError extends Error {}

  return {
    KycNotApprovedError,
    AsaasEnvError,
    markChargeAsPaid: markChargeAsPaidMock,
  };
});

import { getServerSession } from 'next-auth';
import { KycNotApprovedError, markChargeAsPaid } from '@alusa/finance';
import { POST } from '@/app/api/financeiro/cobrancas/[id]/marcar-pago/route';

const buildPostRequest = (body: unknown): NextRequest =>
  new Request('http://localhost/api/financeiro/cobrancas/cob-1/marcar-pago', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const params = { params: Promise.resolve({ id: 'cob-1' }) };

describe('POST /api/financeiro/cobrancas/[id]/marcar-pago', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
  });

  it('marca cobrança como paga usando o caso de uso canônico', async () => {
    vi.mocked(markChargeAsPaid).mockResolvedValueOnce({
      success: true,
      data: {
        chargeId: 'cob-1',
        entityType: 'Cobranca',
        asaasProcessed: false,
        isOffline: true,
      },
    });

    const res = await POST(
      buildPostRequest({
        dataPagamento: '2026-01-04',
        formaPagamentoManual: 'PIX',
        observacao: 'Recebido no balcão',
        notifyCustomer: true,
      }),
      params,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      message: 'Cobrança marcada como paga (offline)',
      data: { chargeId: 'cob-1', entityType: 'Cobranca', isOffline: true },
    });
    expect(markChargeAsPaid).toHaveBeenCalledWith({
      chargeId: 'cob-1',
      contaId: 'conta-1',
      userId: 'u1',
      dataPagamento: '2026-01-04',
      formaPagamentoManual: 'PIX',
      observacao: 'Recebido no balcão',
      notifyCustomer: true,
    });
  });

  it('retorna 409 quando o status no Asaas não permite recebimento manual', async () => {
    vi.mocked(markChargeAsPaid).mockResolvedValueOnce({
      success: false,
      code: 'ASAAS_STATUS_NOT_RECEIVABLE',
      error: 'Status RECEIVED no Asaas não permite recebimento manual',
    });

    const res = await POST(buildPostRequest({}), params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'ASAAS_STATUS_NOT_RECEIVABLE',
        message: 'Status RECEIVED no Asaas não permite recebimento manual',
      },
    });
  });

  it('retorna 409 quando KYC não está aprovado', async () => {
    vi.mocked(markChargeAsPaid).mockRejectedValueOnce(new KycNotApprovedError('KYC_NAO_APROVADO'));

    const res = await POST(buildPostRequest({}), params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'KYC_NAO_APROVADO',
        message: 'Conta não aprovada para operações financeiras',
      },
    });
  });
});
