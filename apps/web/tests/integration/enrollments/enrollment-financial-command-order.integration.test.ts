import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { resetDb } from '../../utils/reset-db';
import { claimEnrollmentFinancialCommand } from '@alusa/finance';
import { processEnrollmentBillingOutboxEvent } from '@/src/server/enrollments/enrollment-billing-outbox.service';

const hasDb = Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
const describeIf = hasDb ? describe : describe.skip;

describeIf('enrollment financial command subscription ordering', () => {
  const db = new PrismaClient();
  const now = new Date();
  const subscriptionId = 'asaas-sub-financial-command-order';
  let contaId: string;
  let matriculaId: string;
  let legacySubscriptionId: string;

  beforeAll(async () => {
    await resetDb(db);
    const conta = await db.conta.create({ data: { nome: 'Conta financial command ordering' } });
    contaId = conta.id;
    const actor = await db.usuario.create({
      data: {
        contaId,
        nome: 'Actor financial command ordering',
        email: 'financial-command-order@example.test',
        senhaHash: 'test-only-hash',
      },
    });
    const student = await db.aluno.create({
      data: { contaId, nome: 'Student financial command ordering', dataNasc: new Date('2010-01-01T00:00:00.000Z') },
    });
    const enrollment = await db.matricula.create({
      data: {
        contaId,
        alunoId: student.id,
        dataInicio: new Date('2026-01-01T00:00:00.000Z'),
        dataFimContrato: new Date('2027-01-01T00:00:00.000Z'),
        taxaMatricula: new Prisma.Decimal(0),
        taxaIsenta: true,
      },
    });
    matriculaId = enrollment.id;

    const agreement = await db.billingAgreement.create({
      data: {
        contaId,
        payerType: 'ALUNO',
        payerId: student.id,
        externalReference: `financial-command-order:${contaId}`,
        idempotencyKey: `financial-command-order:${contaId}`,
        billingType: 'PIX',
        cycle: 'MONTHLY',
        validFrom: now,
        desiredValue: new Prisma.Decimal(100),
        confirmedValue: new Prisma.Decimal(100),
        asaasSubscriptionId: subscriptionId,
        status: 'ACTIVE',
      },
    });
    const subscription = await db.subscription.create({
      data: {
        contaId,
        matriculaId,
        externalReference: `financial-command-order-subscription:${contaId}`,
        asaasSubscriptionId: subscriptionId,
        billingAgreementId: agreement.id,
        status: 'ACTIVE',
      },
    });
    legacySubscriptionId = subscription.id;
    await db.billingAllocation.create({
      data: {
        contaId,
        agreementId: agreement.id,
        matriculaId,
        alunoId: student.id,
        kind: 'TUITION',
        status: 'ACTIVE',
        recurring: true,
        baseAmount: new Prisma.Decimal(100),
        netAmount: new Prisma.Decimal(100),
        validFrom: now,
      },
    });

    for (const [index, value] of [101, 102].entries()) {
      const createdAt = new Date(now.getTime() + index * 1_000);
      await db.matriculaBillingOutbox.create({
        data: {
          id: `financial-command-order-${index + 1}`,
          contaId,
          matriculaId,
          aggregateType: 'MATRICULA',
          aggregateId: matriculaId,
          eventType: index === 0 ? 'APPLY_ENROLLMENT_FINANCIAL_COMMAND' : 'UPDATE_EXISTING_SUBSCRIPTION_BILLING',
          dedupeKey: `financial-command-order:${index + 1}`,
          correlationId: `financial-command-order-correlation:${index + 1}`,
          createdAt,
          availableAt: now,
          payload: index === 0
            ? {
                version: 1,
                commandId: `financial-command-order-command:${index + 1}`,
                actorId: actor.id,
                matriculaId,
                targetSubscriptionId: subscriptionId,
                affectedMatriculaIds: [matriculaId],
                remotePatch: { value },
                localPatch: { vencimentoDia: 10 },
              }
            : {
              matriculaId,
              actorUserId: actor.id,
              subscriptionTargetId: subscription.id,
                billingStrategy: { kind: 'JOIN_EXISTING_CURRENT_CYCLE' },
              },
        },
      });
    }
  }, 30_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('holds the later command until the claimed earlier command releases its remote barrier', async () => {
    let releaseFirstRead!: () => void;
    let signalFirstRead!: () => void;
    const firstReadEntered = new Promise<void>((resolve) => { signalFirstRead = resolve; });
    const firstReadBarrier = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    let remoteValue = 100;
    let getCalls = 0;
    const update = async (_id: string, patch: { value?: number }) => {
      if (patch.value !== undefined) remoteValue = patch.value;
      return {} as never;
    };
    const get = async (_id: string) => {
      getCalls += 1;
      if (getCalls === 1) {
        signalFirstRead();
        await firstReadBarrier;
      }
      return { id: subscriptionId, value: remoteValue, cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: null, status: 'ACTIVE' } as never;
    };
    const deps = { prisma: db, now, financialCommandRemote: { get: get as never, update: update as never } };

    const firstProcessing = processEnrollmentBillingOutboxEvent('financial-command-order-1', deps);
    await firstReadEntered;
    const secondWhileFirstIsInRemoteIo = await processEnrollmentBillingOutboxEvent('financial-command-order-2', deps);

    expect(secondWhileFirstIsInRemoteIo.status).toBe('SKIPPED');
    expect(getCalls).toBe(1);
    expect(await db.matriculaBillingOutbox.findUniqueOrThrow({ where: { id: 'financial-command-order-1' } }))
      .toMatchObject({ status: 'PROCESSING', attempts: 1, claimToken: expect.any(String), leaseExpiresAt: expect.any(Date) });
    expect(await db.matriculaBillingOutbox.findUniqueOrThrow({ where: { id: 'financial-command-order-2' } }))
      .toMatchObject({ status: 'PENDING', attempts: 0 });

    releaseFirstRead();
    await expect(firstProcessing).resolves.toMatchObject({ status: 'PROCESSED' });
    const laterEvent = await db.matriculaBillingOutbox.findUniqueOrThrow({ where: { id: 'financial-command-order-2' } });
    const laterClaim = await claimEnrollmentFinancialCommand({
      db,
      event: { id: laterEvent.id, contaId: laterEvent.contaId, status: laterEvent.status },
      target: { kind: 'SUBSCRIPTION', id: legacySubscriptionId },
      now,
      claimToken: 'heterogeneous-update-claim',
      leaseExpiresAt: new Date(now.getTime() + 10 * 60_000),
    });
    expect(laterClaim.count).toBe(1);

    expect(remoteValue).toBe(101);
    expect(getCalls).toBe(2);
    expect(await db.matriculaBillingOutbox.findMany({
      where: { contaId, eventType: { in: ['APPLY_ENROLLMENT_FINANCIAL_COMMAND', 'UPDATE_EXISTING_SUBSCRIPTION_BILLING'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true, attempts: true },
    })).toEqual([
      { id: 'financial-command-order-1', status: 'PROCESSED', attempts: 1 },
      { id: 'financial-command-order-2', status: 'PROCESSING', attempts: 1 },
    ]);
  });
});
