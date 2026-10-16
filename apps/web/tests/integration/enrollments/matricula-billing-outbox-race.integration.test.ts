import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

function isSafeLocalTestDatabase(): boolean {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      && (databaseName === 'alusa_test' || databaseName.startsWith('alusa_test_'));
  } catch {
    return false;
  }
}

const safeLocalTestDatabase = isSafeLocalTestDatabase();
const prisma = safeLocalTestDatabase ? new PrismaClient() : null;
let enqueueEnrollmentBillingOutbox: typeof import('@/src/server/enrollments/enrollment-billing-outbox.service').enqueueEnrollmentBillingOutbox | undefined;
let processEnrollmentBillingOutboxEvent: typeof import('@/src/server/enrollments/enrollment-billing-outbox.service').processEnrollmentBillingOutboxEvent | undefined;

describe.skipIf(!safeLocalTestDatabase)('MatriculaBillingOutbox PostgreSQL race integration', () => {
  const db = prisma as PrismaClient;
  const suffix = randomUUID().replaceAll('-', '');
  const contaAId = `matricula_outbox_a_${suffix}`;
  const contaBId = `matricula_outbox_b_${suffix}`;
  const alunoAId = `matricula_outbox_student_a_${suffix}`;
  const alunoBId = `matricula_outbox_student_b_${suffix}`;
  const matriculaAId = `matricula_outbox_enrollment_a_${suffix}`;
  const matriculaBId = `matricula_outbox_enrollment_b_${suffix}`;
  const dedupeKey = `enrollment-billing:${matriculaAId}`;
  const actorUserId = `matricula-outbox-test-${suffix}`;
  let eventAId: string;
  let eventBId: string;

  beforeAll(async () => {
    const service = await import('@/src/server/enrollments/enrollment-billing-outbox.service');
    enqueueEnrollmentBillingOutbox = service.enqueueEnrollmentBillingOutbox;
    processEnrollmentBillingOutboxEvent = service.processEnrollmentBillingOutboxEvent;

    await db.conta.createMany({
      data: [
        { id: contaAId, nome: `Matricula outbox A ${suffix}` },
        { id: contaBId, nome: `Matricula outbox B ${suffix}` },
      ],
    });
    await db.aluno.createMany({
      data: [
        { id: alunoAId, contaId: contaAId, nome: `Aluno A ${suffix}`, dataNasc: new Date('2010-01-01T00:00:00.000Z') },
        { id: alunoBId, contaId: contaBId, nome: `Aluno B ${suffix}`, dataNasc: new Date('2010-01-01T00:00:00.000Z') },
      ],
    });
    await db.matricula.createMany({
      data: [
        {
          id: matriculaAId,
          contaId: contaAId,
          alunoId: alunoAId,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2027-01-01T00:00:00.000Z'),
          taxaMatricula: new Prisma.Decimal(100),
          taxaIsenta: true,
        },
        {
          id: matriculaBId,
          contaId: contaBId,
          alunoId: alunoBId,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2027-01-01T00:00:00.000Z'),
          taxaMatricula: new Prisma.Decimal(100),
          taxaIsenta: true,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await db.matriculaBillingOutbox.deleteMany({
      where: { contaId: { in: [contaAId, contaBId] } },
    });
    await db.matricula.deleteMany({ where: { id: { in: [matriculaAId, matriculaBId] } } });
    await db.aluno.deleteMany({ where: { id: { in: [alunoAId, alunoBId] } } });
    await db.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });
    await db.$disconnect();
  });

  it('deduplicates concurrent enqueue for Conta A and permits only one processor effect while Conta B stays pending', async () => {
    const [firstA, secondA] = await Promise.all([
      enqueueEnrollmentBillingOutbox!({ contaId: contaAId, matriculaId: matriculaAId, actorUserId }),
      enqueueEnrollmentBillingOutbox!({ contaId: contaAId, matriculaId: matriculaAId, actorUserId }),
    ]);

    expect(firstA).not.toBeNull();
    expect(secondA?.id).toBe(firstA?.id);
    expect(firstA).toMatchObject({ contaId: contaAId, matriculaId: matriculaAId, dedupeKey });
    eventAId = firstA!.id;

    const eventB = await db.matriculaBillingOutbox.create({
      data: {
        contaId: contaBId,
        matriculaId: matriculaBId,
        aggregateType: 'MATRICULA',
        aggregateId: matriculaBId,
        eventType: 'PROVISION_ENROLLMENT_BILLING',
        dedupeKey,
        idempotencyKey: dedupeKey,
        correlationId: dedupeKey,
        payload: { matriculaId: matriculaBId, actorUserId },
      },
    });
    eventBId = eventB.id;
    expect(eventB).toMatchObject({ contaId: contaBId, matriculaId: matriculaBId, dedupeKey, status: 'PENDING' });
    expect(eventB.id).not.toBe(eventAId);

    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const bothInitialReads = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
    const outbox = new Proxy(db.matriculaBillingOutbox, {
      get(target, property) {
        if (property === 'findUnique') {
          return async (...args: Parameters<typeof target.findUnique>) => {
            const result = await target.findUnique(...args);
            if (args[0]?.where.id === eventAId && !args[0]?.select) {
              initialReads += 1;
              if (initialReads === 2) releaseInitialReads();
              await bothInitialReads;
            }
            return result;
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const workerPrisma = new Proxy(db, {
      get(target, property) {
        if (property === 'matriculaBillingOutbox') return outbox;
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as PrismaClient;

    let releaseProvision!: () => void;
    let signalProvisionStarted!: () => void;
    const provisionStarted = new Promise<void>((resolve) => { signalProvisionStarted = resolve; });
    const provisionGate = new Promise<void>((resolve) => { releaseProvision = resolve; });
    const provisionEffect = vi.fn(async () => {
      signalProvisionStarted();
      await provisionGate;
      await db.matricula.updateMany({
        where: { id: matriculaAId, contaId: contaAId },
        data: { billingProvisionStatus: 'PROVISIONADO', billingProvisionAt: new Date(), billingProvisionError: null },
      });
      return { success: true } as never;
    });
    const deps = { prisma: workerPrisma, provisionEnrollmentBilling: provisionEffect };

    const firstProcessor = processEnrollmentBillingOutboxEvent!(eventAId, deps);
    const secondProcessorPromise = processEnrollmentBillingOutboxEvent!(eventAId, deps);
    await Promise.race([
      provisionStarted,
      firstProcessor.then((result) => {
        throw new Error(`Worker terminou antes do provisionamento mockado iniciar: ${JSON.stringify(result)}`);
      }),
    ]);
    const secondProcessor = await secondProcessorPromise;
    releaseProvision();
    const firstProcessorResult = await firstProcessor;

    expect(firstProcessorResult).toMatchObject({ status: 'PROCESSED', eventId: eventAId, matriculaId: matriculaAId });
    expect(secondProcessor).toMatchObject({ status: 'SKIPPED', eventId: eventAId });
    expect(provisionEffect).toHaveBeenCalledTimes(1);

    const [finalA, finalB] = await Promise.all([
      db.matriculaBillingOutbox.findUnique({ where: { id: eventAId } }),
      db.matriculaBillingOutbox.findUnique({ where: { id: eventBId } }),
    ]);
    expect(finalA).toMatchObject({ status: 'PROCESSED', attempts: 1, claimToken: null });
    expect(finalB).toMatchObject({ status: 'PENDING', attempts: 0, claimToken: null, contaId: contaBId });
  }, 20_000);
});
