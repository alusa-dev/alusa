import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '@/lib/prisma';
import { previewExternalInstallmentCandidates, previewExternalPaymentCandidates, previewExternalSubscriptionCandidates } from '@alusa/finance';

const suffix = randomUUID().replaceAll('-', '');
const contaA = `origin-a-${suffix}`;
const contaB = `origin-b-${suffix}`;
const originA = `origin-row-a-${suffix}`;
const originB = `origin-row-b-${suffix}`;
const archivedWebhookId = `origin-archive-${suffix}`;
const archivedPaymentWebhookId = `origin-payment-archive-${suffix}`;
const archivedCanonicalPaymentWebhookId = `origin-payment-canonical-archive-${suffix}`;
const archivedInstallmentWebhookId = `origin-installment-archive-${suffix}`;
const roleName = `alusa_rls_origin_${suffix}`;
let ownerRole = '';
let roleCreated = false;
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function runAsTenant<T>(contaId: string | null, callback: (_tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
    await tx.$executeRaw`SELECT set_config('app.current_conta_id', ${contaId ?? ''}, true)`;
    return callback(tx);
  });
}

describe('AsaasResourceOrigin RLS', () => {
  beforeAll(async () => {
    const [connection] = await prisma.$queryRawUnsafe<Array<{ current_user: string }>>('SELECT current_user');
    ownerRole = connection?.current_user ?? '';
    await prisma.conta.createMany({ data: [{ id: contaA, nome: 'Origin RLS A' }, { id: contaB, nome: 'Origin RLS B' }] });
    await prisma.asaasResourceOrigin.createMany({ data: [
      { id: originA, contaId: contaA, resourceType: 'SUBSCRIPTION', asaasId: 'sub-same', origin: 'EXTERNAL', reason: 'Manual tenant A', actorId: 'admin-a' },
      { id: originB, contaId: contaB, resourceType: 'SUBSCRIPTION', asaasId: 'sub-same', origin: 'EXTERNAL', reason: 'Manual tenant B', actorId: 'admin-b' },
    ] });
    await prisma.webhookAsaasArchive.create({ data: {
      id: archivedWebhookId, contaId: contaA, evento: 'PAYMENT_RECEIVED', payload: { payment: { id: 'pay-archived', subscription: 'sub-archived' } },
      asaasSubscriptionId: 'sub-archived', asaasPaymentId: 'pay-archived', recebidoEm: new Date(), status: 'PROCESSADO', tentativas: 1,
    } });
    await prisma.webhookAsaasArchive.create({ data: {
      id: archivedCanonicalPaymentWebhookId, contaId: contaA, evento: 'PAYMENT_RECEIVED', payload: { payment: { id: 'pay-archived-canonical', externalReference: 'event-map-order:order-a' } },
      asaasPaymentId: 'pay-archived-canonical', recebidoEm: new Date(), status: 'PROCESSADO', tentativas: 1,
    } });
    await prisma.webhookAsaasArchive.create({ data: {
      id: archivedPaymentWebhookId, contaId: contaA, evento: 'PAYMENT_RECEIVED', payload: { payment: { id: 'pay-archived-standalone', externalReference: 'school-reference-12' } },
      asaasPaymentId: 'pay-archived-standalone', recebidoEm: new Date(), status: 'PROCESSADO', tentativas: 1,
    } });
    await prisma.webhookAsaasArchive.create({ data: {
      id: archivedInstallmentWebhookId, contaId: contaA, evento: 'PAYMENT_RECEIVED', payload: { payment: { id: 'pay-archived-installment', installment: 'inst-archived', externalReference: 'school-plan-reference' } },
      asaasPaymentId: 'pay-archived-installment', recebidoEm: new Date(), status: 'PROCESSADO', tentativas: 1,
    } });
    await prisma.$executeRawUnsafe(`CREATE ROLE ${quoteIdentifier(roleName)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    roleCreated = true;
    await prisma.$executeRawUnsafe(`GRANT ${quoteIdentifier(roleName)} TO ${quoteIdentifier(ownerRole)}`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public, app_security TO ${quoteIdentifier(roleName)}`);
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION app_security.current_conta_id() TO ${quoteIdentifier(roleName)}`);
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AsaasResourceOrigin" TO ${quoteIdentifier(roleName)}`);
  });

  afterAll(async () => {
    await prisma.asaasResourceOrigin.deleteMany({ where: { id: { in: [originA, originB] } } });
    await prisma.webhookAsaasArchive.deleteMany({ where: { id: archivedWebhookId } });
    await prisma.webhookAsaasArchive.deleteMany({ where: { id: archivedPaymentWebhookId } });
    await prisma.webhookAsaasArchive.deleteMany({ where: { id: archivedCanonicalPaymentWebhookId } });
    await prisma.webhookAsaasArchive.deleteMany({ where: { id: archivedInstallmentWebhookId } });
    await prisma.conta.deleteMany({ where: { id: { in: [contaA, contaB] } } });
    if (roleCreated) {
      await prisma.$executeRawUnsafe(`REVOKE ${quoteIdentifier(roleName)} FROM ${quoteIdentifier(ownerRole)}`);
      await prisma.$executeRawUnsafe(`DROP OWNED BY ${quoteIdentifier(roleName)}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${quoteIdentifier(roleName)}`);
    }
  });

  it('has tenant_isolation and prevents tenant A from reading or writing tenant B rows with matching Asaas IDs', async () => {
    const [policy] = await prisma.$queryRawUnsafe<Array<{ rls_enabled: boolean; policy_exists: boolean }>>(
      `SELECT c.relrowsecurity AS rls_enabled,
        EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='AsaasResourceOrigin' AND p.policyname='tenant_isolation') AS policy_exists
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='AsaasResourceOrigin'`,
    );
    expect(policy).toEqual({ rls_enabled: true, policy_exists: true });
    const visible = await runAsTenant(contaA, (tx) => tx.asaasResourceOrigin.findMany({ where: { asaasId: 'sub-same' }, select: { id: true } }));
    expect(visible).toEqual([{ id: originA }]);
    await expect(runAsTenant(contaA, (tx) => tx.asaasResourceOrigin.create({ data: {
      id: `blocked-${suffix}`, contaId: contaB, resourceType: 'SUBSCRIPTION', asaasId: 'other-sub',
      origin: 'EXTERNAL', reason: 'Cross tenant write attempt', actorId: 'admin-a',
    } }))).rejects.toThrow();
  });

  it('includes a subscription observed only in archived webhook history in the preview', async () => {
    const preview = await previewExternalSubscriptionCandidates({ contaId: contaA });
    expect(preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ subscriptionId: 'sub-archived', relatedPaymentCount: 1, samplePaymentIds: ['pay-archived'] }),
    ]));
  });

  it('includes a standalone payment observed only in archived webhook history in its preview', async () => {
    const preview = await previewExternalPaymentCandidates({ contaId: contaA });
    expect(preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentId: 'pay-archived-standalone', sampleExternalReferences: ['school-reference-12'] }),
      expect.objectContaining({ paymentId: 'pay-archived-canonical', eligible: false, conflict: 'CANONICAL_ALUSA_REFERENCE' }),
    ]));
  });

  it('groups an archived payment by exact installment ID and excludes it from standalone payment preview', async () => {
    const [installments, payments] = await Promise.all([
      previewExternalInstallmentCandidates({ contaId: contaA }),
      previewExternalPaymentCandidates({ contaId: contaA }),
    ]);
    expect(installments.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ installmentId: 'inst-archived', paymentCount: 1, samplePaymentIds: ['pay-archived-installment'] }),
    ]));
    expect(payments.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ paymentId: 'pay-archived-installment' })]));
  });
});
