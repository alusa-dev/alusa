import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AsaasHttpError, BillingAgreementError } from '@alusa/finance';

const {
  deleteSubscriptionMock,
  getSubscriptionMock,
  getPaymentMock,
  deletePaymentMock,
  listSubscriptionPaymentsMock,
  pauseSubscriptionMock,
  materializeBillingAgreementMock,
  previewBillingAgreementChangeMock,
  commitBillingAgreementChangeMock,
} = vi.hoisted(() => ({
  deleteSubscriptionMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  getPaymentMock: vi.fn(),
  deletePaymentMock: vi.fn(),
  listSubscriptionPaymentsMock: vi.fn(),
  pauseSubscriptionMock: vi.fn(),
  materializeBillingAgreementMock: vi.fn(),
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
    listSubscriptionPayments: listSubscriptionPaymentsMock,
    pauseAssinatura: pauseSubscriptionMock,
    materializeBillingAgreement: materializeBillingAgreementMock,
    previewBillingAgreementChange: previewBillingAgreementChangeMock,
    commitBillingAgreementChange: commitBillingAgreementChangeMock,
  };
});

import {
  listContasWithPendingMatriculaCancellations,
  reconcilePendingMatriculaCancellations,
  syncMatriculaStatus,
} from './enrollment-sync.service';

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
      findMany: vi.fn(async () => []),
    },
    customer: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
    customerPayer: { findUnique: vi.fn(async () => null) },
    subscription: { findFirst: vi.fn(async () => null) },
    billingAllocation: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    billingAgreement: { findFirst: vi.fn(async () => null) },
    matriculaBillingOutbox: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    matriculaOperacao: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => operation),
      update: vi.fn(async () => operation),
    },
    cobranca: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({ id: 'charge-1' })) },
    charge: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (_callback: (_client: typeof tx) => Promise<unknown>) => _callback(tx)),
  };
  return { prisma: root as unknown as PrismaClient, root, tx, operation };
}

describe('syncMatriculaStatus cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSubscriptionMock.mockResolvedValue({ deleted: true });
    getSubscriptionMock.mockResolvedValue({ customer: 'cus-1', nextDueDate: '2026-10-05' });
    listSubscriptionPaymentsMock.mockResolvedValue({ data: [], hasMore: false, totalCount: 0 });
    pauseSubscriptionMock.mockResolvedValue({ id: 'sub-1', status: 'INACTIVE' });
    materializeBillingAgreementMock.mockResolvedValue({ id: 'agreement-1' });
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
    expect(root.matriculaBillingOutbox.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-1', matriculaId: 'mat-1',
        status: { in: ['PENDING', 'FAILED', 'PROCESSING', 'REQUIRES_RECONCILIATION'] },
      }),
      select: { id: true },
    }));
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

  it('cancela cobrança local usando contaId também na escrita por id', async () => {
    const { prisma, root } = buildPrisma();
    root.cobranca.findMany.mockResolvedValue([{
      id: 'charge-1', status: 'PENDENTE', asaasPaymentId: null,
    }] as never);

    await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    });

    expect(root.cobranca.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'charge-1', contaId: 'conta-1' },
    }));
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

  it('pausa assinatura legada compartilhada se outro membro tiver cobrança vencida', async () => {
    const { prisma, root, tx } = buildPrisma();
    listSubscriptionPaymentsMock.mockResolvedValue({
      data: [{ id: 'payment-other-student', status: 'OVERDUE', deleted: false }],
      hasMore: false,
      totalCount: 1,
    });

    const result = await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    });

    expect(result.asaasAction).toBe('SUSPEND');
    expect(pauseSubscriptionMock).toHaveBeenCalledWith({ subscriptionId: 'sub-1', contaId: 'conta-1' });
    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(tx.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'INACTIVE' }),
    }));
    expect(listSubscriptionPaymentsMock).toHaveBeenCalledWith('sub-1', expect.objectContaining({ status: 'OVERDUE' }));
  });

  it('não altera assinatura legada apontada por outra matrícula sem fonte para acordo compartilhado', async () => {
    const { prisma, root, tx } = buildPrisma();
    root.matricula.findMany.mockResolvedValue([{ id: 'mat-other' }] as never);

    await expect(syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LEGACY_SHARED_SUBSCRIPTION_REQUIRES_RECONCILIATION',
    });

    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(pauseSubscriptionMock).not.toHaveBeenCalled();
    expect(tx.matricula.update).not.toHaveBeenCalled();
    expect(root.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'ERRO',
        metadata: expect.objectContaining({ reasonCode: 'LEGACY_SHARED_SUBSCRIPTION_REQUIRES_RECONCILIATION' }),
      }),
    }));
    expect(root.matricula.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-1', asaasSubscriptionId: 'sub-1' }),
      select: { id: true },
    }));
  });

  it('não conclui cancelamento quando o acordo canônico perdeu a alocação da matrícula', async () => {
    const { prisma, root, tx } = buildPrisma();
    root.billingAllocation.findMany.mockResolvedValue([] as never);
    root.billingAgreement.findFirst.mockResolvedValue({ id: 'agreement-canonical' } as never);

    await expect(syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    })).rejects.toMatchObject({ code: 'ALLOCATION_NOT_FOUND', statusCode: 409 });

    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(tx.matricula.update).not.toHaveBeenCalled();
    expect(root.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ERRO', metadata: expect.objectContaining({ reasonCode: 'ALLOCATION_NOT_FOUND' }) }),
    }));
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
    const allocation = {
      id: 'allocation-1',
      agreementId: 'agreement-1',
      validUntil: null,
      agreement: { version: 3, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
    };
    root.billingAllocation.findMany.mockResolvedValue([allocation] as never);
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

    expect(root.billingAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-1',
        status: { in: ['ACTIVE', 'SCHEDULED'] },
        OR: [{ validUntil: null }, { validUntil: { gte: expect.any(Date) } }],
      }),
    }));

    expect(commitBillingAgreementChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      uiRequestId: expect.stringMatching(
        /^status:mat-1:CANCELADA:\d{4}-\d{2}-\d{2}:preview-hash-0123456$/,
      ),
    }));

  });

  it('usa uma justificativa determinística quando o cancelamento não informa motivo', async () => {
    const { prisma, root } = buildPrisma();
    const allocation = {
      id: 'allocation-1',
      agreementId: 'agreement-1',
      validUntil: null,
      agreement: { version: 1, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
    };
    root.billingAllocation.findMany.mockResolvedValue([allocation] as never);
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
    const allocation = {
      id: 'allocation-1',
      agreementId: 'agreement-historical',
      validUntil: null,
      agreement: {
        version: 4,
        nextDueDate: new Date('2026-10-05T00:00:00.000Z'),
        payerType: 'RESPONSAVEL',
        payerId: 'responsavel-1',
      },
    };
    root.billingAllocation.findMany.mockResolvedValue([allocation] as never);
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

  it('isola cancelamento de acordo compartilhado entre Conta A e Conta B', async () => {
    const { prisma, root, tx } = buildPrisma();
    root.matricula.findFirst.mockResolvedValue({
      id: 'mat-a',
      status: 'ATIVA',
      asaasSubscriptionId: 'sub-a',
      aluno: { id: 'aluno-a', dataNasc: new Date('1990-01-01T00:00:00.000Z'), asaasCustomerId: 'cus-a' },
      responsavelFinanceiroId: null,
      responsavelFinanceiro: null,
    } as never);
    const allocationRows = [
      {
        contaId: 'conta-a', matriculaId: 'mat-a', id: 'allocation-a', agreementId: 'agreement-a', validUntil: null,
        agreement: { version: 1, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
      },
      {
        contaId: 'conta-b', matriculaId: 'mat-b', id: 'allocation-b', agreementId: 'agreement-b', validUntil: null,
        agreement: { version: 1, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
      },
    ];
    (root.billingAllocation.findMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (args: {
      where: { contaId?: string; matriculaId?: string };
    }) => allocationRows.filter((row) =>
      row.contaId === args.where.contaId && row.matriculaId === args.where.matriculaId,
    ));
    (root.cobranca.findMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (args: {
      where: { contaId?: string; matriculaId?: string };
    }) => {
      const tenantRows = [{ contaId: 'conta-b', matriculaId: 'mat-b', id: 'charge-b' }];
      return tenantRows.filter((row) => row.contaId === args.where.contaId && row.matriculaId === args.where.matriculaId);
    });
    root.customerPayer.findUnique.mockResolvedValue({ customer: { id: 'customer-a', asaasCustomerId: 'cus-a' } } as never);
    previewBillingAgreementChangeMock.mockResolvedValue({
      previewHash: 'preview-tenant-isolation-a', expiresAt: '2026-09-07T03:00:00.000Z', plans: [], blockers: [],
    });
    commitBillingAgreementChangeMock.mockResolvedValue({ operationId: 'billing-op-a', status: 'COMPLETED' });

    await syncMatriculaStatus({
      prisma,
      contaId: 'conta-a',
      matriculaId: 'mat-a',
      targetStatus: 'CANCELADA',
      actorId: 'user-a',
    });

    expect(commitBillingAgreementChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', agreementId: 'agreement-a', allocationIds: ['allocation-a'],
    }));
    expect(root.billingAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', matriculaId: 'mat-a' }),
    }));
    expect(root.cobranca.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', matriculaId: 'mat-a' }),
    }));
    expect(tx.matricula.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_matricula_conta_id: { contaId: 'conta-a', id: 'mat-a' } },
    }));
    expect(tx.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'op-cancel-1', contaId: 'conta-a' },
    }));
    expect(root.charge.updateMany).not.toHaveBeenCalled();
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
    const allocation = {
      id: 'allocation-1',
      agreementId: 'agreement-other-payer',
      validUntil: null,
      agreement: {
        version: 1,
        nextDueDate: new Date('2026-10-05T00:00:00.000Z'),
        payerType: 'RESPONSAVEL',
        payerId: 'responsavel-other',
      },
    };
    root.billingAllocation.findMany.mockResolvedValue([allocation] as never);

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

  it('audita e interrompe cancelamento canônico quando falta a alocação', async () => {
    const { prisma, root } = buildPrisma();
    (root.billingAgreement.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agreement-1' });

    await expect(syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALLOCATION_NOT_FOUND',
    });

    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(root.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'ERRO',
        metadata: expect.objectContaining({ retryable: false, reasonCode: 'ALLOCATION_NOT_FOUND' }),
      }),
    }));
    expect(root.matricula.findFirst).toHaveBeenCalled();
  });

  it('interrompe antes de efeitos remotos quando a matrícula aparece em acordos ativos distintos', async () => {
    const { prisma, root, tx } = buildPrisma();
    root.billingAllocation.findMany.mockResolvedValue([
      {
        id: 'allocation-tuition', agreementId: 'agreement-tuition', validUntil: null,
        agreement: { version: 1, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
      },
      {
        id: 'allocation-fee', agreementId: 'agreement-enrollment-fee', validUntil: null,
        agreement: { version: 2, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
      },
    ] as never);

    await expect(syncMatriculaStatus({
      prisma, contaId: 'conta-1', matriculaId: 'mat-1', targetStatus: 'CANCELADA', actorId: 'user-1',
    })).rejects.toMatchObject({ code: 'MULTIPLE_AGREEMENTS_REQUIRE_RECONCILIATION', statusCode: 409 });

    expect(commitBillingAgreementChangeMock).not.toHaveBeenCalled();
    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(tx.matricula.update).not.toHaveBeenCalled();
    expect(root.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ERRO', metadata: expect.objectContaining({ retryable: false }) }),
    }));
  });

  it('reconstrói alocação individual a partir da assinatura legada antes de recalcular', async () => {
    const { prisma, root } = buildPrisma();
    root.subscription.findFirst.mockResolvedValue({ id: 'subscription-legacy-1' } as never);
    root.billingAllocation.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{
        id: 'allocation-rebuilt', agreementId: 'agreement-1', validUntil: null,
        agreement: { version: 2, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
      }] as never)
      .mockResolvedValueOnce([{
        id: 'allocation-rebuilt', agreementId: 'agreement-1', validUntil: null,
      }] as never);
    getSubscriptionMock.mockResolvedValue({
      customer: 'cus-1', value: 30, billingType: 'PIX', cycle: 'MONTHLY',
      nextDueDate: '2026-10-05', endDate: undefined, deleted: false,
    });
    previewBillingAgreementChangeMock.mockResolvedValue({
      previewHash: 'preview-rebuilt-allocation', expiresAt: '2026-09-07T03:00:00.000Z', plans: [], blockers: [],
    });
    commitBillingAgreementChangeMock.mockResolvedValue({
      operationId: 'billing-op-rebuilt', status: 'COMPLETED', remoteProgress: [],
    });

    await syncMatriculaStatus({
      prisma, contaId: 'conta-1', matriculaId: 'mat-1', targetStatus: 'CANCELADA', actorId: 'user-1',
    });

    expect(materializeBillingAgreementMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'INDIVIDUAL', subscriptionId: 'subscription-legacy-1', value: 30, cycle: 'MONTHLY',
    }));
    expect(commitBillingAgreementChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      agreementId: 'agreement-1', allocationIds: ['allocation-rebuilt'],
    }));
    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
  });

  it('informa dívida vencida do acordo compartilhado sem expor outro aluno', async () => {
    const { prisma, root, tx } = buildPrisma();
    const allocation = {
      id: 'allocation-1', agreementId: 'agreement-1', validUntil: null,
      agreement: { version: 3, nextDueDate: new Date('2026-10-05T00:00:00.000Z'), payerType: null, payerId: null },
    };
    root.billingAllocation.findMany
      .mockResolvedValueOnce([allocation] as never)
      .mockResolvedValueOnce([{
      id: 'allocation-1', agreementId: 'agreement-1', validUntil: null,
      }] as never);
    previewBillingAgreementChangeMock.mockResolvedValue({
      previewHash: 'preview-last-allocation-overdue',
      expiresAt: '2026-09-07T03:00:00.000Z',
      plans: [],
      blockers: [],
    });
    commitBillingAgreementChangeMock.mockResolvedValue({
      operationId: 'billing-op-overdue',
      status: 'COMPLETED',
      remoteProgress: [{ agreementId: 'agreement-1', action: 'PAUSE_SUBSCRIPTION' }],
    });

    const result = await syncMatriculaStatus({
      prisma,
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      targetStatus: 'CANCELADA',
      actorId: 'user-1',
      deferTerminalOnWarnings: true,
    });

    expect(result.newStatus).toBe('CANCELADA');
    expect(result.deferred).not.toBe(true);
    const warning = result.paymentSync.warnings.join(' ');
    expect(warning).toContain('cobranças vencidas já emitidas no acordo permanecem em aberto');
    expect(warning).not.toContain('student-two');
    expect(deletePaymentMock).not.toHaveBeenCalled();
    expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    expect(tx.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'INACTIVE' }),
    }));
    expect(tx.matricula.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELADA' }),
    }));
    expect(tx.matriculaOperacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SINCRONIZADO' }),
    }));
  });
});

describe('pending matrícula cancellation retry selection', () => {
  it('does not requeue deterministic ERRO operations', async () => {
    const findMany = vi.fn(async (_args: { where: { status: { in: string[] } } }) => []);
    const prisma = { matriculaOperacao: { findMany } } as unknown as PrismaClient;

    await reconcilePendingMatriculaCancellations({ prisma, contaId: 'conta-1' });
    await listContasWithPendingMatriculaCancellations({ prisma, maxAccounts: 10 });

    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [args] of findMany.mock.calls) {
      expect(args.where.status.in).toEqual(['PENDENTE_SINCRONISMO', 'DIVERGENTE']);
      expect(args.where.status.in).not.toContain('ERRO');
    }
  });
});
