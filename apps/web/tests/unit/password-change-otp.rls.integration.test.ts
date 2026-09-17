import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '@/lib/prisma';

const suffix = randomUUID().replaceAll('-', '');
const contaAId = `rls-otp-conta-a-${suffix}`;
const contaBId = `rls-otp-conta-b-${suffix}`;
const userAId = `rls-otp-user-a-${suffix}`;
const userBId = `rls-otp-user-b-${suffix}`;
const otpAId = `rls-otp-a-${suffix}`;
const otpBId = `rls-otp-b-${suffix}`;
const otpCreatedByAId = `rls-otp-created-a-${suffix}`;
const otpRejectedByPolicyId = `rls-otp-invalid-${suffix}`;
const roleName = `alusa_rls_otp_${suffix}`;

let ownerRole = '';
let roleCreated = false;

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function otpData(input: { id: string; userId: string; contaId: string }) {
  const now = new Date();
  return {
    id: input.id,
    userId: input.userId,
    contaId: input.contaId,
    channel: 'EMAIL' as const,
    codeHash: `hash-${input.id}`,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    resendAvailableAt: now,
  };
}

async function runAsRuntimeRole<T>(
  contaId: string | null,
  callback: (_tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (_tx) => {
    await _tx.$executeRawUnsafe(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
    await _tx.$executeRaw`SELECT set_config('app.current_conta_id', ${contaId ?? ''}, true)`;
    return callback(_tx);
  });
}

describe('PasswordChangeOtp RLS', () => {
  beforeAll(async () => {
    const [connection] = await prisma.$queryRawUnsafe<Array<{ current_user: string }>>(
      'SELECT current_user',
    );
    ownerRole = connection?.current_user ?? '';
    if (!ownerRole) throw new Error('Não foi possível identificar a role proprietária do banco de teste.');

    await prisma.conta.createMany({
      data: [
        { id: contaAId, nome: 'RLS OTP Conta A' },
        { id: contaBId, nome: 'RLS OTP Conta B' },
      ],
    });
    await prisma.usuario.createMany({
      data: [
        {
          id: userAId,
          contaId: contaAId,
          nome: 'RLS OTP User A',
          email: `rls-otp-a-${suffix}@example.test`,
          senhaHash: 'hash',
          role: 'ADMIN',
        },
        {
          id: userBId,
          contaId: contaBId,
          nome: 'RLS OTP User B',
          email: `rls-otp-b-${suffix}@example.test`,
          senhaHash: 'hash',
          role: 'ADMIN',
        },
      ],
    });
    await prisma.passwordChangeOtp.createMany({
      data: [
        otpData({ id: otpAId, userId: userAId, contaId: contaAId }),
        otpData({ id: otpBId, userId: userBId, contaId: contaBId }),
      ],
    });

    const role = quoteIdentifier(roleName);
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    roleCreated = true;
    await prisma.$executeRawUnsafe(`GRANT ${role} TO ${quoteIdentifier(ownerRole)}`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public, app_security TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION app_security.current_conta_id() TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PasswordChangeOtp" TO ${role}`);
  });

  afterAll(async () => {
    await prisma.passwordChangeOtp.deleteMany({
      where: { id: { in: [otpAId, otpBId, otpCreatedByAId, otpRejectedByPolicyId] } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });

    if (roleCreated) {
      const role = quoteIdentifier(roleName);
      await prisma.$executeRawUnsafe(`REVOKE ${role} FROM ${quoteIdentifier(ownerRole)}`);
      await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });

  it('habilita a policy tenant_isolation no banco', async () => {
    const [policy] = await prisma.$queryRawUnsafe<
      Array<{ rls_enabled: boolean; policy_exists: boolean }>
    >(
      `SELECT
        c.relrowsecurity AS rls_enabled,
        EXISTS (
          SELECT 1
          FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename = 'PasswordChangeOtp'
            AND p.policyname = 'tenant_isolation'
        ) AS policy_exists
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'PasswordChangeOtp'`,
    );

    expect(policy).toEqual({ rls_enabled: true, policy_exists: true });
  });

  it('falha fechada sem contexto e isola leituras e escritas por conta', async () => {
    const withoutTenant = await runAsRuntimeRole(null, (tx) =>
      tx.passwordChangeOtp.findMany({
        where: { id: { in: [otpAId, otpBId] } },
        select: { id: true },
      }),
    );
    expect(withoutTenant).toEqual([]);

    const visibleToContaA = await runAsRuntimeRole(contaAId, (tx) =>
      tx.passwordChangeOtp.findMany({
        where: { id: { in: [otpAId, otpBId] } },
        select: { id: true, contaId: true },
      }),
    );
    expect(visibleToContaA).toEqual([{ id: otpAId, contaId: contaAId }]);

    const createdByContaA = await runAsRuntimeRole(contaAId, (tx) =>
      tx.passwordChangeOtp.create({
        data: otpData({ id: otpCreatedByAId, userId: userAId, contaId: contaAId }),
        select: { id: true, contaId: true },
      }),
    );
    expect(createdByContaA).toEqual({ id: otpCreatedByAId, contaId: contaAId });

    const crossTenantUpdate = await runAsRuntimeRole(contaAId, (tx) =>
      tx.passwordChangeOtp.updateMany({
        where: { id: otpBId },
        data: { attempts: 1 },
      }),
    );
    expect(crossTenantUpdate.count).toBe(0);

    await expect(
      runAsRuntimeRole(contaAId, (tx) =>
        tx.passwordChangeOtp.create({
          data: otpData({ id: otpRejectedByPolicyId, userId: userBId, contaId: contaBId }),
        }),
      ),
    ).rejects.toThrow();

    const tenantBRecord = await prisma.passwordChangeOtp.findUnique({
      where: { id: otpBId },
      select: { attempts: true },
    });
    expect(tenantBRecord).toEqual({ attempts: 0 });
  });
});
