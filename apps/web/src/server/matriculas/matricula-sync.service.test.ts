import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AsaasHttpError, BillingAgreementError } from '@alusa/finance';

const {
  deleteSubscriptionMock,
  getSubscriptionMock,
  getPaymentMock,
  deletePaymentMock,
  previewBillingAgreementChangeMock,
  commitBillingAgreementChangeMock,
} = vi.hoisted(() => ({
  deleteSubscriptionMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
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
    getSubscription: getSubscriptionMock,
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
        aluno: {
          id: 'aluno-1',
          dataNasc: new Date('1990-01-01T00:00:00.000Z'),
          asaasCustomerId: 'cus-1',
        },
        responsavelFinanceiroId: null,
        responsavelFinanceiro: null,
      })),
    },
    customer: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
    customerPayer: { findUnique: vi.fn(async () => null) },
    billingAllocation: { findFirst: vi.fn(async () => null) },
    matriculaOperacao: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => operation),
      update: vi.fn(async () => operation),
    },
    cobranca: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (_callback: (_client: typeof tx) => Promise<unknown>) => _callback(tx)),
  };
  return { prisma: root as unknown as PrismaClient, root, tx, operation };
}

describe('syncMatriculaStatus cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSubscriptionMock.mockResolvedValue({ deleted: true });
    getSubscriptionMock.mockResolvedValue({ customer: 'cus-1', nextDueDate: '2026-10-05' });
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

  it('reconcilia operação parcialmente concluída sem repetir a exclusão remota', async () => {
    const { prisma, root, tx, operation } = buildPrisma();
    root.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      status: 'CANCELADA',
      asaasSubscriptionId: 'sub-1',
      aluno: {
        id: 'aluno-1',
        dataNasc: new Date('1990-01-01T00:00:00.000Z'),
        asaasCustomerId: 'cus-1',
      },
      responsavelFinanceiroId: null,
      responsavelFinanceiro: null,
    } as never);
    root.matriculaOperacao.findFirst.mockResolvedValue(operation as never);

    const result = await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    });

    expect(root.matriculaOperacao.create).not.toHaveBeenCalled();
    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(tx.matricula.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_matricula_conta_id: { contaId: 'conta-1', id: 'mat-1' } },
    }));
    expect(result.newStatus).toBe('CANCELADA');
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

  it('separa tentativas quando o preview financeiro muda e preserva o erro de idempotência', async () => {
    const { prisma, root } = buildPrisma();
    root.billingAllocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      agreementId: 'agreement-1',
      agreement: { version: 3, nextDueDate: new Date('2026-10-05T00:00:00.000Z') },
    } as never);
    previewBillingAgreementChangeMock.mockResolvedValue({
      previewHash: 'preview-hash-01234567890123456789',
      expiresAt: '2026-09-07T03:00:00.000Z',
      plans: [],
      blockers: [],
    });
    commitBillingAgreementChangeMock.mockRejectedValue(
      new BillingAgreementError('IDEMPOTENCY_CONFLICT', 'Conflito de idempotência financeira.'),
    );

    await expect(syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });

    expect(commitBillingAgreementChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      uiRequestId: expect.stringMatching(
        /^status:mat-1:CANCELADA:\d{4}-\d{2}-\d{2}:preview-hash-0123456$/,
      ),
    }));
  });

  it('usa uma justificativa determinística quando o cancelamento não informa motivo', async () => {
    const { prisma, root } = buildPrisma();
    root.billingAllocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      agreementId: 'agreement-1',
      agreement: { version: 1, nextDueDate: new Date('2026-10-05T00:00:00.000Z') },
    } as never);
    previewBillingAgreementChangeMock.mockResolvedValue({
      previewHash: 'preview-hash-default-reason',
      expiresAt: '2026-09-07T03:00:00.000Z',
      plans: [],
      blockers: [],
    });
    commitBillingAgreementChangeMock.mockResolvedValue({
      operationId: 'billing-op-1',
      status: 'COMPLETED',
    });

    await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    });

    expect(previewBillingAgreementChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'Cancelamento manual da matrícula',
    }));
    expect(root.matriculaOperacao.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        observacao: 'Cancelamento manual da matrícula',
      }),
    }));
  });

  it('aceita aluno e responsável como aliases da identidade financeira canônica', async () => {
    const { prisma, root, tx } = buildPrisma();
    root.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      status: 'ATIVA',
      asaasSubscriptionId: 'sub-shared',
      aluno: {
        id: 'aluno-1',
        dataNasc: new Date('1990-01-01T00:00:00.000Z'),
        asaasCustomerId: 'cus-shared',
      },
      responsavelFinanceiroId: null,
      responsavelFinanceiro: null,
    } as never);
    root.customerPayer.findUnique
      .mockResolvedValueOnce({ customer: { id: 'customer-canonical', asaasCustomerId: 'cus-shared' } } as never)
      .mockResolvedValueOnce({ customer: { id: 'customer-canonical' } } as never);
    root.billingAllocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      agreementId: 'agreement-historical',
      agreement: {
        version: 4,
        nextDueDate: new Date('2026-10-05T00:00:00.000Z'),
        payerType: 'RESPONSAVEL',
        payerId: 'responsavel-1',
      },
    } as never);
    previewBillingAgreementChangeMock.mockResolvedValue({
      previewHash: 'preview-shared',
      expiresAt: '2026-09-07T03:00:00.000Z',
      plans: [],
      blockers: [],
    });
    commitBillingAgreementChangeMock.mockResolvedValue({
      operationId: 'billing-op-shared',
      status: 'COMPLETED',
    });

    const result = await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    });

    expect(commitBillingAgreementChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      agreementId: 'agreement-historical',
      allocationIds: ['allocation-1'],
    }));
    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(tx.matricula.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELADA', integrationStatus: 'SINCRONIZADO' }),
    }));
    expect(tx.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SINCRONIZADO' }),
    }));
    expect(result.newStatus).toBe('CANCELADA');
  });

  it('bloqueia customer remoto de outra identidade antes de remover assinatura legada', async () => {
    const { prisma, root } = buildPrisma();
    root.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      status: 'ATIVA',
      asaasSubscriptionId: 'sub-wrong-customer',
      aluno: {
        id: 'aluno-1',
        dataNasc: new Date('1990-01-01T00:00:00.000Z'),
        asaasCustomerId: 'cus-expected',
      },
      responsavelFinanceiroId: null,
      responsavelFinanceiro: null,
    } as never);
    root.customerPayer.findUnique.mockResolvedValue({
      customer: { id: 'customer-student', asaasCustomerId: 'cus-expected' },
    } as never);
    getSubscriptionMock.mockResolvedValue({ customer: 'cus-other', nextDueDate: '2026-10-05' });

    await expect(syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    })).rejects.toMatchObject({ code: 'FINANCE_IDENTITY_CONFLICT' });

    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(root.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ERRO' }),
    }));
  });

  it('bloqueia acordo de outro papel quando não existe alias legítimo', async () => {
    const { prisma, root } = buildPrisma();
    root.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      status: 'ATIVA',
      asaasSubscriptionId: 'sub-no-alias',
      aluno: {
        id: 'aluno-1',
        dataNasc: new Date('1990-01-01T00:00:00.000Z'),
        asaasCustomerId: 'cus-student',
      },
      responsavelFinanceiroId: null,
      responsavelFinanceiro: null,
    } as never);
    root.customerPayer.findUnique
      .mockResolvedValueOnce({ customer: { id: 'customer-student', asaasCustomerId: 'cus-student' } } as never)
      .mockResolvedValueOnce(null);
    root.billingAllocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      agreementId: 'agreement-other-payer',
      agreement: {
        version: 1,
        nextDueDate: new Date('2026-10-05T00:00:00.000Z'),
        payerType: 'RESPONSAVEL',
        payerId: 'responsavel-other',
      },
    } as never);

    await expect(syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    })).rejects.toMatchObject({ code: 'FINANCE_IDENTITY_CONFLICT' });

    expect(commitBillingAgreementChangeMock).not.toHaveBeenCalled();
    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
  });
});
