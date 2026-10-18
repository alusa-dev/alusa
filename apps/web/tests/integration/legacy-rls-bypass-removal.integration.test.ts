import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '@/lib/prisma';

const suffix = randomUUID().replaceAll('-', '');
const contaA = `legacy-rls-a-${suffix}`;
const contaB = `legacy-rls-b-${suffix}`;
const webhookA = `legacy-rls-webhook-a-${suffix}`;
const webhookB = `legacy-rls-webhook-b-${suffix}`;
const roleName = `alusa_rls_bypass_${suffix}`;
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

let ownerRole = '';
let roleCreated = false;

async function runWithForgedLegacyContext<T>(callback: (_tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${contaA}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_conta_id', ${`invalid-${suffix}`}, true)`;
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return callback(tx);
  });
}

describe('legacy RLS bypass policy removal', () => {
  beforeAll(async () => {
    const [connection] = await prisma.$queryRawUnsafe<Array<{ current_user: string }>>('SELECT current_user');
    ownerRole = connection?.current_user ?? '';
    if (!ownerRole) throw new Error('Não foi possível identificar a role proprietária do banco de teste.');

    await prisma.conta.createMany({
      data: [
        { id: contaA, nome: `Legacy RLS A ${suffix}` },
        { id: contaB, nome: `Legacy RLS B ${suffix}` },
      ],
    });
    await prisma.webhookAsaas.createMany({
      data: [
        { id: webhookA, contaId: contaA, evento: 'PAYMENT_RECEIVED', payload: { payment: { id: 'tenant-a' } } },
        { id: webhookB, contaId: contaB, evento: 'PAYMENT_RECEIVED', payload: { payment: { id: 'tenant-b' } } },
      ],
    });

    const role = quoteIdentifier(roleName);
    await prisma.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    roleCreated = true;
    await prisma.$executeRawUnsafe(`GRANT ${role} TO ${quoteIdentifier(ownerRole)}`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public, app_security TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION app_security.current_conta_id() TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."WebhookAsaas" TO ${role}`);
  });

  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe('DROP POLICY IF EXISTS legacy_bypass_fixture ON public."WebhookAsaas"');
      await prisma.webhookAsaas.deleteMany({ where: { id: { in: [webhookA, webhookB] } } });
    } finally {
      try {
        await prisma.conta.deleteMany({ where: { id: { in: [contaA, contaB] } } });
      } finally {
        if (roleCreated) {
          const role = quoteIdentifier(roleName);
          await prisma.$executeRawUnsafe(`REVOKE ${role} FROM ${quoteIdentifier(ownerRole)}`);
          await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`);
          await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
        }
      }
    }
  });

  it('removes an installed legacy policy by executing the migration and verifies both canonical predicates', async () => {
    const legacyPredicate = `current_setting('app.current_tenant', true) = "contaId"
      OR current_setting('app.bypass_rls', true) = 'on'`;
    await prisma.$executeRawUnsafe('DROP POLICY IF EXISTS legacy_bypass_fixture ON public."WebhookAsaas"');
    await prisma.$executeRawUnsafe(
      `CREATE POLICY legacy_bypass_fixture ON public."WebhookAsaas"
       USING (${legacyPredicate}) WITH CHECK (${legacyPredicate})`,
    );

    try {
      const beforeMigration = await runWithForgedLegacyContext((tx) =>
        tx.webhookAsaas.findMany({ where: { id: { in: [webhookA, webhookB] } }, select: { id: true }, orderBy: { id: 'asc' } }),
      );
      expect(beforeMigration).toEqual([{ id: webhookA }, { id: webhookB }]);

      const migrationPath = resolve(process.cwd(), '../../prisma/migrations/20261015110000_remove_legacy_rls_bypass_policies/migration.sql');
      await prisma.$executeRawUnsafe(await readFile(migrationPath, 'utf8'));
    } finally {
      await prisma.$executeRawUnsafe('DROP POLICY IF EXISTS legacy_bypass_fixture ON public."WebhookAsaas"');
    }

    const [bypassPolicies, canonicalPolicy] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ tablename: string; policyname: string }>>(
        `SELECT tablename, policyname FROM pg_policies
         WHERE schemaname = 'public'
           AND (coalesce(qual, '') ILIKE '%app.bypass_rls%' OR coalesce(with_check, '') ILIKE '%app.bypass_rls%')`,
      ),
      prisma.$queryRawUnsafe<Array<{ rls_enabled: boolean; qual: string | null; with_check: string | null }>>(
        `SELECT c.relrowsecurity AS rls_enabled, p.qual, p.with_check
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname AND p.policyname='tenant_isolation'
         WHERE n.nspname='public' AND c.relname='WebhookAsaas'`,
      ),
    ]);

    expect(bypassPolicies).toEqual([]);
    expect(canonicalPolicy).toHaveLength(1);
    expect(canonicalPolicy[0]?.rls_enabled).toBe(true);
    expect(canonicalPolicy[0]?.qual).toBe('("contaId" = app_security.current_conta_id())');
    expect(canonicalPolicy[0]?.with_check).toBe('("contaId" = app_security.current_conta_id())');
  });

  it('does not widen reads or writes when a non-BYPASSRLS role forges the legacy settings', async () => {
    const [role] = await prisma.$queryRawUnsafe<Array<{ rolbypassrls: boolean }>>(
      'SELECT rolbypassrls FROM pg_roles WHERE rolname = $1',
      roleName,
    );
    expect(role?.rolbypassrls).toBe(false);

    const visibleRows = await runWithForgedLegacyContext((tx) =>
      tx.webhookAsaas.findMany({ where: { id: { in: [webhookA, webhookB] } }, select: { id: true } }),
    );
    expect(visibleRows).toEqual([]);

    const updateResult = await runWithForgedLegacyContext((tx) =>
      tx.webhookAsaas.updateMany({ where: { id: webhookB }, data: { ultimoErro: 'forged update' } }),
    );
    expect(updateResult.count).toBe(0);

    const deleteResult = await runWithForgedLegacyContext((tx) =>
      tx.webhookAsaas.deleteMany({ where: { id: webhookB } }),
    );
    expect(deleteResult.count).toBe(0);

    await expect(
      runWithForgedLegacyContext((tx) =>
        tx.webhookAsaas.create({
          data: {
            id: `legacy-rls-forged-write-${suffix}`,
            contaId: contaB,
            evento: 'PAYMENT_RECEIVED',
            payload: { payment: { id: 'forged' } },
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(prisma.webhookAsaas.findUnique({ where: { id: `legacy-rls-forged-write-${suffix}` } })).resolves.toBeNull();
    await expect(prisma.webhookAsaas.findUnique({ where: { id: webhookB } })).resolves.toMatchObject({
      id: webhookB,
      ultimoErro: null,
    });
  });
});
