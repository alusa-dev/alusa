import { describe, expect, it, vi } from 'vitest';
import {
  BillingMode,
  MatriculaBillingOutboxStatus,
  MatriculaBillingProvisionStatus,
} from '@prisma/client';

import {
  enqueueEnrollmentBillingOutbox,
  processEnrollmentBillingOutboxEvent,
  resolveEnrollmentMergeEffectivePolicy,
} from './enrollment-billing-outbox.service';

describe('resolveEnrollmentMergeEffectivePolicy', () => {
  it('preserva o ciclo atual ao unificar agora', () => {
    expect(resolveEnrollmentMergeEffectivePolicy({ kind: 'JOIN_EXISTING_CURRENT_CYCLE' }))
      .toBe('CURRENT_CYCLE_FULL');
  });

  it('não altera cobranças atuais ao unificar no próximo ciclo', () => {
    expect(resolveEnrollmentMergeEffectivePolicy({ kind: 'SCHEDULE_NEXT_CYCLE_UNIFICATION' }))
      .toBe('NEXT_CYCLE');
  });
});

describe('enqueueEnrollmentBillingOutbox', () => {
  it('reaproveita evento aberto para a mesma matrícula e conta', async () => {
    const existing = {
      id: 'outbox-1',
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      status: MatriculaBillingOutboxStatus.PENDING,
      dedupeKey: 'enrollment-billing:mat-1',
    };
    const prisma = {
      matriculaBillingOutbox: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    };

    const result = await enqueueEnrollmentBillingOutbox(
      { contaId: 'conta-1', matriculaId: 'mat-1', actorUserId: 'user-1' },
      { prisma: prisma as never },
    );

    expect(result).toBe(existing);
    expect(prisma.matriculaBillingOutbox.findFirst).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        dedupeKey: 'enrollment-billing:mat-1',
        status: {
          in: [
            MatriculaBillingOutboxStatus.PENDING,
            MatriculaBillingOutboxStatus.PROCESSING,
            MatriculaBillingOutboxStatus.FAILED,
            MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          ],
        },
      },
    });
    expect(prisma.matriculaBillingOutbox.create).not.toHaveBeenCalled();
  });

  it('trata corrida de criação pela chave de dedupe', async () => {
    const raced = {
      id: 'outbox-2',
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      status: MatriculaBillingOutboxStatus.PENDING,
      dedupeKey: 'enrollment-billing:mat-1',
    };
    const prisma = {
      matriculaBillingOutbox: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(raced),
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };

    const result = await enqueueEnrollmentBillingOutbox(
      { contaId: 'conta-1', matriculaId: 'mat-1', actorUserId: 'user-1' },
      { prisma: prisma as never },
    );

    expect(result).toBe(raced);
    expect(prisma.matriculaBillingOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contaId: 'conta-1',
          matriculaId: 'mat-1',
          eventType: 'PROVISION_ENROLLMENT_BILLING',
          dedupeKey: 'enrollment-billing:mat-1',
        }),
      }),
    );
  });

  it('reabre evento processado legado para reconciliar matrícula ainda incompleta', async () => {
    const processed = {
      id: 'outbox-legacy',
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      status: MatriculaBillingOutboxStatus.PROCESSED,
      dedupeKey: 'enrollment-billing:mat-1',
    };
    const reopened = {
      ...processed,
      status: MatriculaBillingOutboxStatus.PENDING,
    };
    const prisma = {
      matricula: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mat-1' }),
      },
      matriculaBillingOutbox: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(processed)
          .mockResolvedValueOnce(reopened),
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await enqueueEnrollmentBillingOutbox(
      { contaId: 'conta-1', matriculaId: 'mat-1', actorUserId: 'user-retry' },
      { prisma: prisma as never },
    );

    expect(result).toBe(reopened);
    expect(prisma.matricula.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'mat-1',
        contaId: 'conta-1',
        billingProvisionStatus: {
          in: [
            MatriculaBillingProvisionStatus.PENDENTE,
            MatriculaBillingProvisionStatus.PROCESSANDO,
            MatriculaBillingProvisionStatus.PARCIAL,
            MatriculaBillingProvisionStatus.FALHO,
          ],
        },
      },
      select: { id: true },
    });
    expect(prisma.matriculaBillingOutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'outbox-legacy',
        contaId: 'conta-1',
        status: MatriculaBillingOutboxStatus.PROCESSED,
      },
      data: expect.objectContaining({
        status: MatriculaBillingOutboxStatus.PENDING,
        attempts: 0,
        processedAt: null,
        lastError: 'REABERTO_PARA_RECONCILIAR_PROVISIONAMENTO_INCOMPLETO',
        payload: { matriculaId: 'mat-1', actorUserId: 'user-retry' },
      }),
    });
  });
});

describe('processEnrollmentBillingOutboxEvent', () => {
  it('usa o acordo canônico e cria complemento antes de provisionar unificação em cobrança paga', async () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    const event = {
      id: 'outbox-merge',
      contaId: 'conta-1',
      matriculaId: 'mat-new',
      eventType: 'UPDATE_EXISTING_SUBSCRIPTION_BILLING',
      status: MatriculaBillingOutboxStatus.PENDING,
      attempts: 0,
      payload: {
        matriculaId: 'mat-new',
        actorUserId: 'user-1',
        subscriptionTargetId: 'subscription-1',
        billingStrategy: { kind: 'JOIN_EXISTING_CURRENT_CYCLE', effectiveAt: '2026-07-31T00:00:00.000Z' },
      },
      correlationId: 'correlation-merge',
      availableAt: now,
    };
    const tx = {
      conta: {
        findFirst: vi.fn().mockResolvedValue({ matriculaActivationPolicy: 'IMMEDIATE' }),
      },
      familyFinancialAllocation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      matricula: {
        findFirst: vi.fn().mockResolvedValue({
          status: 'AGUARDANDO_CONFIRMACAO',
          taxaIsenta: true,
          taxaMatricula: 0,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      matriculaLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      matriculaBillingOutbox: {
        findUnique: vi.fn().mockResolvedValue(event),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      subscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'subscription-1',
          matriculaId: 'mat-old',
          asaasSubscriptionId: 'sub-asaas',
          billingAgreement: null,
          matricula: {
            id: 'mat-old',
            dataInicio: new Date('2026-01-01T00:00:00.000Z'),
            dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
            formaPagamento: 'CARTAO_CREDITO',
            vencimentoDia: 5,
            plano: { periodicidade: 'MENSAL' },
            combo: null,
          },
        }),
      },
      matricula: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'mat-new',
          alunoId: 'aluno-new',
          dataInicio: new Date('2026-07-30T00:00:00.000Z'),
          dataFimContrato: new Date('2026-08-04T00:00:00.000Z'),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      familyFinancialAllocation: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'legacy-allocation',
          chargeKind: 'MENSALIDADE',
          amount: 150,
          baseAmount: 150,
          discountAmount: 0,
          competenceStart: new Date('2026-07-30T00:00:00.000Z'),
          competenceEnd: new Date('2026-08-04T00:00:00.000Z'),
          createdAt: now,
        }]),
      },
      cobranca: { findFirst: vi.fn().mockResolvedValue(null) },
      billingChangeOperation: { findFirst: vi.fn().mockResolvedValue(null) },
      billingAdjustment: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: 'adjustment-1' })
          .mockResolvedValue(null),
      },
      billingAllocation: {
        findMany: vi.fn().mockResolvedValue([{ id: 'allocation-new', kind: 'TUITION' }]),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const previewBillingAgreementChange = vi.fn().mockResolvedValue({
      blockers: [],
      warnings: [],
      adjustments: [{ type: 'COMPLEMENT', amountCents: 15_000 }],
      previewHash: 'preview-hash',
      expiresAt: '2026-07-31T13:00:00.000Z',
      sourceVersion: 1,
    });
    const commitBillingAgreementChange = vi.fn().mockResolvedValue({
      status: 'COMPLETED',
      operationId: 'operation-1',
    });
    const processPendingBillingAdjustments = vi.fn().mockResolvedValue({ found: 1, applied: 1, failed: 0 });

    const deps = {
      prisma: prisma as never,
      now,
      getSubscription: vi.fn().mockResolvedValue({ value: 150 }),
      materializeBillingAgreement: vi.fn().mockResolvedValue({ id: 'agreement-1' }),
      previewBillingAgreementChange,
      commitBillingAgreementChange,
      processPendingBillingAdjustments,
      pushEnrollmentFeeToAsaas: vi.fn(),
    };
    const result = await processEnrollmentBillingOutboxEvent('outbox-merge', deps);

    expect(result.status).toBe('PROCESSED');
    expect(previewBillingAgreementChange).toHaveBeenCalledWith(expect.objectContaining({
      agreementId: 'agreement-1',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      allocations: [expect.objectContaining({
        enrollmentId: 'mat-new',
        netAmountCents: 15_000,
        validUntil: '2026-08-05',
      })],
    }));
    expect(processPendingBillingAdjustments).toHaveBeenCalledWith({
      contaId: 'conta-1',
      operationId: 'operation-1',
    });
    expect(tx.matricula.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'mat-new', contaId: 'conta-1' },
      data: expect.objectContaining({ billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO }),
    }));

    // Simula queda depois do commit remoto/canônico e antes da finalização
    // local: o retry recupera a operação e não tenta outro ADD_ALLOCATION.
    prisma.billingChangeOperation.findFirst.mockResolvedValue({ id: 'operation-1' });
    await expect(processEnrollmentBillingOutboxEvent('outbox-merge', deps)).resolves.toEqual(
      expect.objectContaining({ status: 'PROCESSED' }),
    );
    expect(previewBillingAgreementChange).toHaveBeenCalledTimes(1);
    expect(commitBillingAgreementChange).toHaveBeenCalledTimes(1);
  });

  it('agenda retry e não marca como processado quando a materialização termina parcial', async () => {
    const now = new Date('2099-01-01T12:00:00.000Z');
    const event = {
      id: 'outbox-1',
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      eventType: 'PROVISION_ENROLLMENT_BILLING',
      status: MatriculaBillingOutboxStatus.PENDING,
      attempts: 0,
      payload: { matriculaId: 'mat-1', actorUserId: 'user-1' },
      correlationId: 'correlation-1',
      availableAt: now,
    };
    const enrollment = {
      id: 'mat-1',
      contaId: 'conta-1',
      billingMode: BillingMode.INDIVIDUAL,
      billingProvisionStatus: MatriculaBillingProvisionStatus.PENDENTE,
      taxaIsenta: true,
      taxaMatricula: 0,
      asaasSubscriptionId: null,
      cobrancas: [],
      descontos: [],
      plano: { valor: 150 },
      combo: null,
    };
    const transactionOutboxUpdate = vi.fn().mockResolvedValue({});
    const transactionLogCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      matriculaBillingOutbox: {
        findUnique: vi.fn().mockResolvedValue(event),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
      },
      matricula: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(enrollment)
          .mockResolvedValueOnce({
            billingProvisionStatus: MatriculaBillingProvisionStatus.PARCIAL,
            billingProvisionError: 'BILLING_AGREEMENT_MATERIALIZATION_FAILED',
          }),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (callback) =>
        callback({
          matriculaBillingOutbox: { update: transactionOutboxUpdate },
          matriculaLog: { create: transactionLogCreate },
        }),
      ),
    };
    const provisionEnrollmentBilling = vi.fn().mockResolvedValue({});

    const result = await processEnrollmentBillingOutboxEvent('outbox-1', {
      prisma: prisma as never,
      now,
      provisionEnrollmentBilling: provisionEnrollmentBilling as never,
    });

    expect(result).toEqual({
      eventId: 'outbox-1',
      matriculaId: 'mat-1',
      status: 'FAILED',
      error:
        'BILLING_PROVISION_INCOMPLETE:PARCIAL:BILLING_AGREEMENT_MATERIALIZATION_FAILED',
    });
    expect(transactionOutboxUpdate).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: expect.objectContaining({
        status: MatriculaBillingOutboxStatus.FAILED,
        lastError:
          'BILLING_PROVISION_INCOMPLETE:PARCIAL:BILLING_AGREEMENT_MATERIALIZATION_FAILED',
      }),
    });
    expect(transactionLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matriculaId: 'mat-1',
        action: 'BILLING_PROVISION_INCOMPLETE_RETRY_SCHEDULED',
        metadata: expect.objectContaining({ correlationId: 'correlation-1' }),
      }),
    });
    expect(prisma.matriculaBillingOutbox.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MatriculaBillingOutboxStatus.PROCESSED }),
      }),
    );
    expect(prisma.matricula.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'mat-1', contaId: 'conta-1' },
      select: {
        billingProvisionStatus: true,
        billingProvisionError: true,
      },
    });
  });
});
