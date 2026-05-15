/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  conta: { findMany: vi.fn(), count: vi.fn() },
  usuario: { findMany: vi.fn(), count: vi.fn() },
  aluno: { findMany: vi.fn(), count: vi.fn() },
  responsavel: { findMany: vi.fn() },
  matricula: { findMany: vi.fn(), count: vi.fn() },
  chargeReadModel: { findMany: vi.fn(), count: vi.fn() },
  subscription: { findMany: vi.fn() },
  standaloneSubscription: { findMany: vi.fn() },
  installmentPlan: { findMany: vi.fn() },
  standaloneInstallmentPlan: { findMany: vi.fn() },
  transferRequest: { findMany: vi.fn() },
  rematriculaOperacao: { findMany: vi.fn() },
  webhookAsaas: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

import { searchSupport } from '@/features/support/queries/support-dashboard';

describe('support search query', () => {
  beforeEach(() => {
    Object.values(prismaMock).forEach((model) => {
      Object.values(model).forEach((fn) => fn.mockReset());
    });
  });

  it('não consulta o banco para termos curtos', async () => {
    const results = await searchSupport('a');

    expect(results).toEqual([]);
    expect(prismaMock.conta.findMany).not.toHaveBeenCalled();
  });

  it('retorna resultados profundos com links para entidade e conta', async () => {
    prismaMock.conta.findMany.mockResolvedValue([
      { id: 'conta-1', nome: 'Escola Alpha', status: 'ATIVO', financeStatus: 'OK' },
    ]);
    prismaMock.usuario.findMany.mockResolvedValue([
      {
        id: 'user-1',
        contaId: 'conta-1',
        nome: 'Maria',
        email: 'maria@teste.com',
        role: 'ADMIN',
        status: 'ATIVO',
      },
    ]);
    prismaMock.aluno.findMany.mockResolvedValue([]);
    prismaMock.responsavel.findMany.mockResolvedValue([]);
    prismaMock.matricula.findMany.mockResolvedValue([]);
    prismaMock.chargeReadModel.findMany.mockResolvedValue([
      {
        id: 'charge-1',
        contaId: 'conta-1',
        payerName: 'Maria',
        status: 'PENDING',
        value: 100,
        asaasPaymentId: 'pay_123',
      },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([]);
    prismaMock.standaloneSubscription.findMany.mockResolvedValue([]);
    prismaMock.installmentPlan.findMany.mockResolvedValue([]);
    prismaMock.standaloneInstallmentPlan.findMany.mockResolvedValue([]);
    prismaMock.transferRequest.findMany.mockResolvedValue([
      {
        id: 'transfer-1',
        contaId: 'conta-1',
        status: 'REQUESTED',
        externalReference: 'transfer-ext',
        asaasTransferId: 'tr_123',
        value: 10,
      },
    ]);
    prismaMock.rematriculaOperacao.findMany.mockResolvedValue([]);
    prismaMock.webhookAsaas.findMany.mockResolvedValue([
      {
        id: 'webhook-1',
        contaId: 'conta-1',
        evento: 'PAYMENT_RECEIVED',
        status: 'PROCESSADO',
        eventId: 'evt_123',
      },
    ]);

    const results = await searchSupport('pay_123');

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'Conta', href: '/developer/contas/conta-1' }),
        expect.objectContaining({ type: 'Usuário', href: '/developer/contas/conta-1/usuarios/user-1' }),
        expect.objectContaining({
          type: 'Cobrança',
          href: '/developer/contas/conta-1/financeiro/cobrancas/charge-1',
        }),
        expect.objectContaining({ type: 'Transferência', href: '/developer/contas/conta-1/financeiro' }),
        expect.objectContaining({ type: 'Webhook', href: '/developer/contas/conta-1/webhooks/webhook-1' }),
      ]),
    );
  });
});
