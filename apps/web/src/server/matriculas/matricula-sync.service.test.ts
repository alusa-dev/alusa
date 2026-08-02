import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AsaasHttpError } from '@alusa/finance';

const {
  deleteSubscriptionMock,
  getPaymentMock,
  deletePaymentMock,
  previewBillingAgreementChangeMock,
  commitBillingAgreementChangeMock,
} = vi.hoisted(() => ({
  deleteSubscriptionMock: vi.fn(),
  getPaymentMock: vi.fn(),
  deletePaymentMock: vi.fn(),
  previewBillingAgreementChangeMock: vi.fn(),
  commitBillingAgreementChangeMock: vi.fn(),
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual<typeof import('@alusa/finance')>('@alusa/finance');
  return {
    ...actual,
    deleteSubscription: deleteSubscriptionMock,
    getPayment: getPaymentMock,
    deletePayment: deletePaymentMock,
    previewBillingAgreementChange: previewBillingAgreementChangeMock,
    commitBillingAgreementChange: commitBillingAgreementChangeMock,
  };
});

import { syncMatriculaStatus } from './matricula-sync.service';

function buildPrisma() {
  const operation = { id: 'op-cancel-1', correlationId: 'corr-cancel-1' };
  const tx = {
    contrato: { updateMany: vi.fn(async () => ({ count: 1 })) },
    matricula: {
      findFirst: vi.fn(async () => ({ id: 'mat-1', alunoId: 'aluno-1', status: 'ATIVA' })),
      update: vi.fn(async () => ({ id: 'mat-1' })),
    },
    subscription: { updateMany: vi.fn(async () => ({ count: 1 })) },
    matriculaOperacao: { update: vi.fn(async () => operation) },
    matriculaLog: { create: vi.fn(async () => ({ id: 'log-1' })) },
  };
  const root = {
    matricula: {
      findFirst: vi.fn(async () => ({
        id: 'mat-1',
        status: 'ATIVA',
        asaasSubscriptionId: 'sub-1',
      })),
    },
    billingAllocation: { findFirst: vi.fn(async () => null) },
    matriculaOperacao: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => operation),
    },
    cobranca: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { prisma: root as unknown as PrismaClient, root, tx, operation };
}

describe('syncMatriculaStatus cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSubscriptionMock.mockResolvedValue({ deleted: true });
  });

  it('persiste operação antes do Asaas e alinha todos os estados no commit local', async () => {
    const { prisma, root, tx } = buildPrisma();

    const result = await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
      motivo: 'Solicitação do responsável',
    });

    expect(root.matriculaOperacao.create.mock.invocationCallOrder[0]).toBeLessThan(
      deleteSubscriptionMock.mock.invocationCallOrder[0]!,
    );
    expect(tx.matricula.update).toHaveBeenCalledWith({
      where: { uq_matricula_conta_id: { contaId: 'conta-1', id: 'mat-1' } },
      data: expect.objectContaining({
        status: 'CANCELADA',
        statusFinanceiro: 'SUSPENSO',
        statusContrato: 'CANCELADO',
        billingProvisionStatus: 'CANCELADO',
        integrationStatus: 'SINCRONIZADO',
      }),
    });
    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', matriculaId: 'mat-1' },
      data: { status: 'DELETED', statusUpdatedAt: expect.any(Date) },
    });
    expect(tx.contrato.updateMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        matriculaId: 'mat-1',
        status: { not: 'CANCELADO' },
      },
      data: { status: 'CANCELADO' },
    });
    expect(tx.matriculaOperacao.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SINCRONIZADO' }) }),
    );
    expect(result.newStatus).toBe('CANCELADA');
  });

  it('conclui retry quando o Asaas informa que a assinatura já não existe', async () => {
    const { prisma, root, tx, operation } = buildPrisma();
    root.matriculaOperacao.findFirst.mockResolvedValue(operation as never);
    deleteSubscriptionMock.mockRejectedValueOnce(new AsaasHttpError('Not found', 404));

    const result = await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    });

    expect(root.matriculaOperacao.create).not.toHaveBeenCalled();
    expect(tx.matricula.update).toHaveBeenCalled();
    expect(result.asaasResponse).toEqual({ deleted: true, alreadyAbsent: true });
  });

  it('mantém a operação pendente quando o remoto foi alterado mas o commit local falha', async () => {
    const { prisma, root } = buildPrisma();
    root.$transaction.mockRejectedValueOnce(new Error('DB_COMMIT_FAILED'));

    await expect(syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    })).rejects.toThrow('DB_COMMIT_FAILED');

    expect(deleteSubscriptionMock).toHaveBeenCalled();
    expect(root.matriculaOperacao.create).toHaveBeenCalled();
  });
});
