import { randomUUID } from 'node:crypto';
import { EnrollmentCreationOperationStatus, Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const originalRlsRuntimeEnabled = process.env.RLS_RUNTIME_ENABLED;
const originalDatabaseRlsUrl = process.env.DATABASE_RLS_URL;

function isSafeLocalTestDatabase() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      && databaseName === 'alusa_test'
      && !originalDatabaseRlsUrl;
  } catch {
    return false;
  }
}

const safeLocalTestDatabase = isSafeLocalTestDatabase();
const suffix = randomUUID().replaceAll('-', '');
const contaAId = `enrollment_reconcile_a_${suffix}`;
const contaBId = `enrollment_reconcile_b_${suffix}`;
const alunoAId = `enrollment_reconcile_student_a_${suffix}`;
const alunoBId = `enrollment_reconcile_student_b_${suffix}`;
const matriculaAId = `enrollment_reconcile_matricula_a_${suffix}`;
const matriculaBId = `enrollment_reconcile_matricula_b_${suffix}`;
const operationAId = `enrollment_reconcile_operation_a_${suffix}`;
const operationBId = `enrollment_reconcile_operation_b_${suffix}`;
const sharedRequestId = `enrollment_reconcile_request_${suffix}`;
const subscriptionAId = `sub_reconcile_a_${suffix}`;
const subscriptionBId = `sub_reconcile_b_${suffix}`;

describe.skipIf(!safeLocalTestDatabase)('enrollment creation reconciler local PostgreSQL RLS integration', () => {
  let adminPrisma: PrismaClient | undefined;
  let schedulerPrisma: PrismaClient | undefined;
  let rlsPrisma: PrismaClient | undefined;
  let roleName: string | undefined;
  let roleCreated = false;
  let reconcileEnrollmentCreationOperations: typeof import('../reconcile-enrollment-creation-operations.js').reconcileEnrollmentCreationOperations;
  let runWithTenant: typeof import('@alusa/database').runWithTenant;

  beforeAll(async () => {
    if (!isSafeLocalTestDatabase()) {
      throw new Error('Integration target must be localhost/alusa_test with DATABASE_RLS_URL initially unset');
    }

    const adminUrl = new URL(process.env.DATABASE_URL!);
    adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    roleName = `reconcile_rls_${suffix}`;
    const rolePassword = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const databaseName = decodeURIComponent(adminUrl.pathname.replace(/^\/+/, ''));
    const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
    const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

    await adminPrisma.$executeRawUnsafe(
      `CREATE ROLE ${quoteIdentifier(roleName)} LOGIN PASSWORD ${quoteLiteral(rolePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    roleCreated = true;
    await adminPrisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(roleName)}`);
    await adminPrisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public, app_security TO ${quoteIdentifier(roleName)}`);
    await adminPrisma.$executeRawUnsafe(
      `GRANT SELECT ("id", "contaId", "uiRequestId", "asaasSubscriptionId") ON TABLE "Matricula" TO ${quoteIdentifier(roleName)}`,
    );
    await adminPrisma.$executeRawUnsafe(
      `GRANT SELECT ON TABLE "EnrollmentCreationOperation" TO ${quoteIdentifier(roleName)}`,
    );
    await adminPrisma.$executeRawUnsafe(
      `GRANT UPDATE ON TABLE "EnrollmentCreationOperation" TO ${quoteIdentifier(roleName)}`,
    );
    await adminPrisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION app_security.current_conta_id() TO ${quoteIdentifier(roleName)}`,
    );

    adminUrl.username = roleName;
    adminUrl.password = rolePassword;
    adminUrl.searchParams.set('connection_limit', '1');
    process.env.RLS_RUNTIME_ENABLED = 'true';
    process.env.DATABASE_RLS_URL = adminUrl.toString();

    const database = await import('@alusa/database');
    schedulerPrisma = database.prisma;
    ({ runWithTenant } = database);
    const tenantRuntime = await import('@alusa/database/tenant');
    rlsPrisma = tenantRuntime.getTenantPrismaClient();
    ({ reconcileEnrollmentCreationOperations } = await import('../reconcile-enrollment-creation-operations.js'));

    const [runtimeIdentity] = await rlsPrisma.$queryRaw<Array<{ current_user: string; rolbypassrls: boolean }>>`
      SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(runtimeIdentity).toEqual({ current_user: roleName, rolbypassrls: false });

    await adminPrisma.conta.createMany({
      data: [
        { id: contaAId, nome: `Reconcile tenant A ${suffix}` },
        { id: contaBId, nome: `Reconcile tenant B ${suffix}` },
      ],
    });
    await adminPrisma.aluno.createMany({
      data: [
        { id: alunoAId, contaId: contaAId, nome: `Reconcile student A ${suffix}`, dataNasc: new Date('2010-01-01T00:00:00.000Z') },
        { id: alunoBId, contaId: contaBId, nome: `Reconcile student B ${suffix}`, dataNasc: new Date('2010-01-01T00:00:00.000Z') },
      ],
    });
    await adminPrisma.matricula.createMany({
      data: [
        {
          id: matriculaAId,
          contaId: contaAId,
          alunoId: alunoAId,
          uiRequestId: sharedRequestId,
          asaasSubscriptionId: subscriptionAId,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2027-01-01T00:00:00.000Z'),
          taxaMatricula: new Prisma.Decimal(100),
          taxaIsenta: true,
        },
        {
          id: matriculaBId,
          contaId: contaBId,
          alunoId: alunoBId,
          uiRequestId: sharedRequestId,
          asaasSubscriptionId: subscriptionBId,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2027-01-01T00:00:00.000Z'),
          taxaMatricula: new Prisma.Decimal(100),
          taxaIsenta: true,
        },
      ],
    });

    const updatedAt = new Date(Date.now() - 10 * 60_000);
    await adminPrisma.enrollmentCreationOperation.createMany({
      data: [
        {
          id: operationAId,
          contaId: contaAId,
          alunoId: alunoAId,
          uiRequestId: sharedRequestId,
          requestFingerprint: `fingerprint-a-${suffix}`,
          externalReference: `enrollment-op:${suffix}:shared`,
          correlationId: `correlation-a-${suffix}`,
          status: EnrollmentCreationOperationStatus.PROCESSING,
          requestSnapshot: { taxaIsenta: true },
          asaasSubscriptionId: subscriptionAId,
          updatedAt,
        },
        {
          id: operationBId,
          contaId: contaBId,
          alunoId: alunoBId,
          uiRequestId: sharedRequestId,
          requestFingerprint: `fingerprint-b-${suffix}`,
          externalReference: `enrollment-op:${suffix}:shared`,
          correlationId: `correlation-b-${suffix}`,
          status: EnrollmentCreationOperationStatus.PROCESSING,
          requestSnapshot: { taxaIsenta: true },
          asaasSubscriptionId: subscriptionBId,
          updatedAt,
        },
      ],
    });
  });

  afterAll(async () => {
    try {
      if (adminPrisma) {
        await adminPrisma.enrollmentCreationOperation.deleteMany({ where: { id: { in: [operationAId, operationBId] } } });
        await adminPrisma.matricula.deleteMany({ where: { id: { in: [matriculaAId, matriculaBId] } } });
        await adminPrisma.aluno.deleteMany({ where: { id: { in: [alunoAId, alunoBId] } } });
        await adminPrisma.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });
      }
    } finally {
      try {
        await rlsPrisma?.$disconnect();
      } finally {
        try {
          if (roleCreated && roleName && adminPrisma) {
            const role = `"${roleName}"`;
            await adminPrisma.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "alusa_test" FROM ${role}`);
            await adminPrisma.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public, app_security FROM ${role}`);
            await adminPrisma.$executeRawUnsafe(
              `REVOKE SELECT ("id", "contaId", "uiRequestId", "asaasSubscriptionId") ON TABLE "Matricula" FROM ${role}`,
            );
            await adminPrisma.$executeRawUnsafe(`REVOKE SELECT, UPDATE ON TABLE "EnrollmentCreationOperation" FROM ${role}`);
            await adminPrisma.$executeRawUnsafe(
              `REVOKE EXECUTE ON FUNCTION app_security.current_conta_id() FROM ${role}`,
            );
            await adminPrisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName}"`);
            const remainingRole = await adminPrisma.$queryRaw<Array<{ exists: boolean }>>`
              SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${roleName}) AS exists
            `;
            if (remainingRole[0]?.exists) throw new Error('Temporary RLS test role was not removed');
          }
        } finally {
          await schedulerPrisma?.$disconnect();
          await adminPrisma?.$disconnect();
          if (originalRlsRuntimeEnabled === undefined) delete process.env.RLS_RUNTIME_ENABLED;
          else process.env.RLS_RUNTIME_ENABLED = originalRlsRuntimeEnabled;
          if (originalDatabaseRlsUrl === undefined) delete process.env.DATABASE_RLS_URL;
          else process.env.DATABASE_RLS_URL = originalDatabaseRlsUrl;
        }
      }
    }
  });

  it('enforces real RLS per tenant and reconciles same-reference operations without crossing tenants', async () => {
    const readTenantContext = async (contaId: string) => runWithTenant(contaId, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ current_user: string; conta_id: string | null; bypass: boolean; backend_pid: number }>>`
        SELECT current_user, app_security.current_conta_id() AS conta_id,
               pg_backend_pid() AS backend_pid,
               (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass
      `;
      return row;
    });

    const contextA = await readTenantContext(contaAId);
    const contextB = await readTenantContext(contaBId);
    expect(contextA).toMatchObject({ current_user: roleName, conta_id: contaAId, bypass: false });
    expect(contextB).toMatchObject({ current_user: roleName, conta_id: contaBId, bypass: false });
    expect(contextB.backend_pid).toBe(contextA.backend_pid);

    const visibleForTenant = async (contaId: string) => runWithTenant(contaId, async (tx) => {
      const operations = await tx.enrollmentCreationOperation.findMany({
        where: { id: { in: [operationAId, operationBId] } },
        select: { id: true, contaId: true },
      });
      const matriculas = await tx.matricula.findMany({
        where: { id: { in: [matriculaAId, matriculaBId] } },
        select: { id: true, contaId: true },
      });
      return { operations, matriculas };
    });
    expect(await visibleForTenant(contaAId)).toEqual({
      operations: [{ id: operationAId, contaId: contaAId }],
      matriculas: [{ id: matriculaAId, contaId: contaAId }],
    });
    expect(await visibleForTenant(contaBId)).toEqual({
      operations: [{ id: operationBId, contaId: contaBId }],
      matriculas: [{ id: matriculaBId, contaId: contaBId }],
    });

    const [contextAfterTransaction] = await rlsPrisma!.$queryRaw<Array<{ tenant_id: string; current_conta_id: string | null; backend_pid: number }>>`
      SELECT current_setting('app.current_conta_id', true) AS tenant_id,
             pg_backend_pid() AS backend_pid,
             app_security.current_conta_id() AS current_conta_id
    `;
    expect(contextAfterTransaction).toMatchObject({
      tenant_id: '',
      current_conta_id: null,
      backend_pid: contextA.backend_pid,
    });

    const summary = await reconcileEnrollmentCreationOperations({ limit: 20, olderThanSeconds: 300 });
    expect(summary).toMatchObject({ inspected: 2, committed: 2, compensated: 0, attention: 0 });

    const operations = await adminPrisma!.enrollmentCreationOperation.findMany({
      where: { id: { in: [operationAId, operationBId] } },
      orderBy: { id: 'asc' },
      select: { id: true, contaId: true, status: true, matriculaId: true },
    });
    expect(operations).toHaveLength(2);
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: operationAId, contaId: contaAId, status: EnrollmentCreationOperationStatus.COMMITTED, matriculaId: matriculaAId }),
      expect.objectContaining({ id: operationBId, contaId: contaBId, status: EnrollmentCreationOperationStatus.COMMITTED, matriculaId: matriculaBId }),
    ]));
  });
});
