import { describe, expect, it, vi } from 'vitest';
import {
  BillingMode,
  MatriculaBillingOutboxStatus,
  MatriculaBillingProvisionStatus,
} from '@prisma/client';

import {
  isDeferredEnrollmentBillingResult,
  enqueueEnrollmentBillingOutbox,
  processEnrollmentBillingOutboxEvent,
  resolveEnrollmentMergeEffectivePolicy,
} from './enrollment-billing-outbox.service';

describe('isDeferredEnrollmentBillingResult', () => {
  it('trata outbox ainda não vigente como agendamento válido', () => {
    expect(isDeferredEnrollmentBillingResult({ status: 'SKIPPED', error: 'NOT_YET_EFFECTIVE' })).toBe(true);
    expect(isDeferredEnrollmentBillingResult({ status: 'SKIPPED', error: 'CLAIMED_BY_OTHER_WORKER' })).toBe(false);
    expect(isDeferredEnrollmentBillingResult({ status: 'REQUIRES_RECONCILIATION' })).toBe(false);
  });
});

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
      matricula: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mat-1' }),
      },
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
      matricula: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mat-1' }),
      },
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
  it('cancels a claimed recurring sibling when terminal intent propagation was interrupted', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    let eventState: Record<string, unknown> = {
      id: 'recurring-outbox', contaId: 'conta-a', matriculaId: 'mat-1',
      eventType: 'PROVISION_ENROLLMENT_BILLING', status: MatriculaBillingOutboxStatus.PENDING,
      attempts: 0, availableAt: now, payload: { matriculaId: 'mat-1', actorUserId: 'user-1' },
    };
    const outboxUpdateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      eventState = {
        ...eventState,
        ...data,
        attempts: data.attempts ? Number(eventState.attempts) + 1 : eventState.attempts,
      };
      return { count: 1 };
    });
    const provisionEnrollmentBilling = vi.fn();
    const db = {
      matriculaBillingOutbox: {
        findUnique: vi.fn(async () => ({ ...eventState })),
        findFirst: vi.fn().mockResolvedValue({
          id: 'fee-outbox', terminalIntent: 'CANCELADA',
          terminalIntentReason: 'Cancelada durante fase de taxa', terminalIntentActorId: 'user-1',
        }),
        updateMany: outboxUpdateMany,
      },
      matricula: { findFirst: vi.fn(), updateMany: vi.fn() },
    };

    await expect(processEnrollmentBillingOutboxEvent('recurring-outbox', {
      prisma: db as never,
      now,
      provisionEnrollmentBilling: provisionEnrollmentBilling as never,
    })).resolves.toEqual({
      eventId: 'recurring-outbox', matriculaId: 'mat-1', status: 'CANCELLED',
    });

    expect(db.matriculaBillingOutbox.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', matriculaId: 'mat-1', terminalIntent: { not: null } }),
    }));
    expect(eventState).toMatchObject({ status: MatriculaBillingOutboxStatus.CANCELLED, terminalIntent: 'CANCELADA' });
    expect(provisionEnrollmentBilling).not.toHaveBeenCalled();
  });
});

describe('processEnrollmentBillingOutboxEvent', () => {
  it('converte retry direto já esgotado em reconciliação auditável sem novo claim', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const outboxUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      matriculaBillingOutbox: { updateMany: outboxUpdate },
      matricula: { updateMany },
      matriculaLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      matriculaBillingOutbox: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'capped-event', contaId: 'conta-1', matriculaId: 'mat-1',
          status: MatriculaBillingOutboxStatus.FAILED, attempts: 8,
          availableAt: now, leaseExpiresAt: null, payload: { matriculaId: 'mat-1' },
        }),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const result = await processEnrollmentBillingOutboxEvent('capped-event', { prisma: prisma as never, now });
    expect(result.status).toBe('REQUIRES_RECONCILIATION');
    expect(outboxUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ attempts: { gte: 8 } }),
      data: expect.objectContaining({ status: MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION }),
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ billingProvisionStatus: MatriculaBillingProvisionStatus.RESULTADO_INCERTO }),
    }));
  });

  it('não permite que o processamento direto execute um evento antes de availableAt', async () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    const prisma = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      matriculaBillingOutbox: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'scheduled-1',
          contaId: 'conta-1',
          matriculaId: 'mat-1',
          status: MatriculaBillingOutboxStatus.PENDING,
          availableAt: new Date('2026-10-01T12:00:01.000Z'),
          payload: { matriculaId: 'mat-1' },
        }),
        updateMany: vi.fn(),
      },
    };

    await expect(processEnrollmentBillingOutboxEvent('scheduled-1', {
      prisma: prisma as never,
      now,
    })).resolves.toMatchObject({
      status: 'SKIPPED',
      eventId: 'scheduled-1',
      error: 'NOT_YET_EFFECTIVE',
    });
    expect(prisma.matriculaBillingOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('sinaliza como diferida assinatura compartilhada futura sem taxa', async () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    const prisma = {
      matriculaBillingOutbox: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'shared-scheduled',
          contaId: 'conta-1',
          matriculaId: 'mat-1',
          eventType: 'UPDATE_EXISTING_SUBSCRIPTION_BILLING',
          status: MatriculaBillingOutboxStatus.PENDING,
          availableAt: new Date('2026-10-05T04:00:00.000Z'),
          payload: {
            matriculaId: 'mat-1',
            billingStrategy: { kind: 'SCHEDULE_NEXT_CYCLE_UNIFICATION', effectiveAt: '2026-10-05T04:00:00.000Z' },
            billingPhase: 'SUBSCRIPTION_ONLY',
            createRecurringBilling: true,
          },
        }),
        updateMany: vi.fn(),
      },
    };

    const result = await processEnrollmentBillingOutboxEvent('shared-scheduled', {
      prisma: prisma as never,
      now,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', error: 'NOT_YET_EFFECTIVE' });
    expect(isDeferredEnrollmentBillingResult(result)).toBe(true);
    expect(prisma.matriculaBillingOutbox.updateMany).not.toHaveBeenCalled();
  });
});

describe('processEnrollmentBillingOutboxEvent', () => {
  it('serializa comandos da mesma assinatura por BillingAgreement e deixa o evento posterior na fila', async () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    const event = {
      id: 'financial-newer', contaId: 'conta-1', matriculaId: 'mat-new',
      eventType: 'APPLY_ENROLLMENT_FINANCIAL_COMMAND', status: MatriculaBillingOutboxStatus.PENDING,
      attempts: 0, availableAt: now,
      payload: { matriculaId: 'mat-new', targetSubscriptionId: 'asaas-sub-1' },
    };
    const updateMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'agreement-1', asaasSubscriptionId: 'asaas-sub-1' }]),
      subscription: {
        findMany: vi.fn().mockResolvedValue([{ id: 'subscription-internal-1' }]),
      },
      matriculaBillingOutbox: {
        findMany: vi.fn().mockResolvedValue([{ id: 'financial-older' }, { id: 'financial-newer' }]),
        updateMany,
      },
    };
    const prisma = {
      matriculaBillingOutbox: {
        findUnique: vi.fn().mockResolvedValue(event),
        updateMany,
      },
      $transaction: vi.fn(async (callback: (transaction: never) => unknown) => callback(tx as never)),
    };

    const result = await processEnrollmentBillingOutboxEvent('financial-newer', { prisma: prisma as never, now });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.matriculaBillingOutbox.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        eventType: { in: ['APPLY_ENROLLMENT_FINANCIAL_COMMAND', 'UPDATE_EXISTING_SUBSCRIPTION_BILLING'] },
        contaId: 'conta-1',
        OR: expect.arrayContaining([
          { payload: { path: ['targetSubscriptionId'], equals: 'asaas-sub-1' } },
          { payload: { path: ['subscriptionTargetId'], equals: 'asaas-sub-1' } },
        ]),
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));
    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'SKIPPED', eventId: 'financial-newer' });
  });

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
    let outboxState = { ...event };
    const updateOutboxMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      outboxState = { ...outboxState, ...data };
      return { count: 1 };
    });
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ billingAgreementId: 'agreement-1' }])
        .mockResolvedValueOnce([{ id: 'agreement-1', asaasSubscriptionId: 'sub-asaas' }]),
      subscription: {
        findMany: vi.fn().mockResolvedValue([{ id: 'subscription-1' }]),
      },
      billingAgreement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      matriculaBillingOutbox: {
        findMany: vi.fn().mockResolvedValue([{ id: 'outbox-merge' }]),
        updateMany: updateOutboxMany,
      },
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
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      matriculaBillingOutbox: {
        findUnique: vi.fn(async () => ({ ...outboxState })),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: updateOutboxMany,
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
        findFirst: vi.fn(async ({ where }: { where: { status?: unknown } }) =>
          where.status
            ? null
            : {
                id: 'mat-new',
                alunoId: 'aluno-new',
                dataInicio: new Date('2026-07-30T00:00:00.000Z'),
                dataFimContrato: new Date('2026-08-04T00:00:00.000Z'),
              },
        ),
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
      billingAgreement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
      where: expect.objectContaining({ id: 'mat-new', contaId: 'conta-1' }),
      data: expect.objectContaining({ billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO }),
    }));

    // A outbox concluída não deve ser reivindicada de novo pelo worker.
    prisma.billingChangeOperation.findFirst.mockResolvedValue({ id: 'operation-1' });
    await expect(processEnrollmentBillingOutboxEvent('outbox-merge', deps)).resolves.toEqual(
      expect.objectContaining({ status: 'SKIPPED' }),
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
      payload: {
        matriculaId: 'mat-1',
        actorUserId: 'user-1',
        billingPhase: 'SUBSCRIPTION_ONLY',
      },
      correlationId: 'correlation-1',
      availableAt: now,
    };
    const enrollment = {
      id: 'mat-1',
      contaId: 'conta-1',
      billingMode: BillingMode.INDIVIDUAL,
      billingProvisionStatus: MatriculaBillingProvisionStatus.PENDENTE,
      taxaIsenta: false,
      taxaMatricula: 100,
      asaasSubscriptionId: null,
      cobrancas: [],
      descontos: [],
      plano: { valor: 150 },
      combo: null,
    };
    const transactionOutboxUpdateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      outboxState = { ...outboxState, ...data };
      return { count: 1 };
    });
    const transactionLogCreate = vi.fn().mockResolvedValue({});
    let outboxState = { ...event };
    const prisma = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      matriculaBillingOutbox: {
        findUnique: vi.fn(async () => ({ ...outboxState })),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          outboxState = { ...outboxState, ...data };
          return { count: 1 };
        }),
        update: vi.fn(),
      },
      matricula: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ status: 'AGUARDANDO_CONFIRMACAO' })
          .mockResolvedValueOnce(enrollment)
          .mockResolvedValueOnce({
            billingProvisionStatus: MatriculaBillingProvisionStatus.PARCIAL,
            billingProvisionError: 'BILLING_AGREEMENT_MATERIALIZATION_FAILED',
          }),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (callback) =>
        callback({
          matriculaBillingOutbox: { updateMany: transactionOutboxUpdateMany },
          matricula: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
    expect(provisionEnrollmentBilling).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        requireEnrollmentFeePayment: true,
        gerarCobrancaTaxa: false,
      }),
      cobrancas: expect.objectContaining({ taxa: null }),
    }));
    expect(transactionOutboxUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'outbox-1', claimToken: expect.any(String) }),
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
