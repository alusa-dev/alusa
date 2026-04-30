/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: () => mockGetSessionUser(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cobranca: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@alusa/finance', () => {
  class KycNotApprovedError extends Error {}
  class AsaasEnvError extends Error {}

  return {
    KycNotApprovedError,
    AsaasEnvError,
    isAsaasEnabled: vi.fn(() => true),
    readPaymentFullPreflight: vi.fn(async () => ({
      id: 'pay_1',
      status: 'PENDING',
      billingType: 'BOLETO',
      value: 100,
      dueDate: '2026-01-05',
    })),
    updatePayment: vi.fn(async () => {
      throw new KycNotApprovedError('KYC_NAO_APROVADO');
    }),
  };
});

import { prisma } from '@/lib/prisma';
import { PUT } from '@/app/api/cobrancas/[id]/route';

const buildPutRequest = (url: string, body: unknown): NextRequest =>
  new Request(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe('PUT /api/cobrancas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 409 quando KYC não aprovado e não atualiza o banco local', async () => {
    mockGetSessionUser.mockResolvedValue({
      id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1',
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
    } as never);

    const res = await PUT(
      buildPutRequest('http://localhost/api/cobrancas/cob-1', {
        valor: 200,
        vencimento: '2026-01-10',
        descricao: 'Teste',
      }),
      { params: { id: 'cob-1' } },
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: 'KYC_NAO_APROVADO' });

    expect(prisma.cobranca.update).not.toHaveBeenCalled();
  });
});
