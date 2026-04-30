/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cobranca: {
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    matriculaLog: {
      create: vi.fn(),
    },
    matricula: {
      update: vi.fn(),
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
    readPaymentStatusPreflight: vi.fn(async () => ({ status: 'PENDING' })),
    getCurrentBrasiliaDate: vi.fn(() => ({
      dateStr: '2026-01-04',
      dateObj: new Date('2026-01-04T12:00:00.000Z'),
      year: 2026,
      month: 1,
      day: 4,
    })),
    confirmCashPayment: vi.fn(async () => {
      throw new KycNotApprovedError('KYC_NAO_APROVADO');
    }),
    auditLogService: { record: vi.fn() },
    syncPaymentStateFromAsaas: vi.fn(),
  };
});

import { getServerSession } from 'next-auth/next';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/cobrancas/[id]/confirmar-recebimento/route';

const buildPostRequest = (url: string, body: unknown): NextRequest =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe('POST /api/cobrancas/[id]/confirmar-recebimento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 409 quando KYC não aprovado e não faz side effects locais', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      valor: 100,
      asaasPaymentId: 'pay_1',
      matriculaId: 'mat-1',
      matricula: {
        id: 'mat-1',
        statusFinanceiro: 'INADIMPLENTE',
        aluno: { id: 'a1', nome: 'Aluno', contaId: 'conta-1' },
      },
    } as never);

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/cob-1/confirmar-recebimento', {}), {
      params: Promise.resolve({ id: 'cob-1' }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ error: 'KYC_NAO_APROVADO' });

    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.matriculaLog.create).not.toHaveBeenCalled();
    expect(prisma.matricula.update).not.toHaveBeenCalled();
    expect(prisma.cobranca.count).not.toHaveBeenCalled();
  });
});
