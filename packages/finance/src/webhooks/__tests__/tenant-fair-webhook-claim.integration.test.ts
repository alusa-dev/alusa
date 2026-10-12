import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@alusa/database';
import { claimTenantFairAsaasWebhooks } from '../asaas-webhook-handler.server';

describe('claimTenantFairAsaasWebhooks PostgreSQL claim', () => {
  afterAll(async () => prisma.$disconnect());

  it('fills a bounded batch round-robin across tenants and leaves the remainder claimable', async () => {
    const firstBatch = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE "WebhookAsaas" (
          id text PRIMARY KEY,
          "contaId" text NOT NULL,
          "recebidoEm" timestamptz NOT NULL,
          status text NOT NULL,
          tentativas integer NOT NULL DEFAULT 0,
          "nextRetryAt" timestamptz,
          "ultimaTentativaEm" timestamptz
        ) ON COMMIT DROP
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "WebhookAsaas" (id, "contaId", "recebidoEm", status) VALUES
          ('a1', 'tenant-a', NOW() - INTERVAL '6 minutes', 'PENDENTE'),
          ('a2', 'tenant-a', NOW() - INTERVAL '4 minutes', 'PENDENTE'),
          ('a3', 'tenant-a', NOW() - INTERVAL '2 minutes', 'PENDENTE'),
          ('b1', 'tenant-b', NOW() - INTERVAL '5 minutes', 'PENDENTE'),
          ('b2', 'tenant-b', NOW() - INTERVAL '1 minutes', 'PENDENTE')
      `);

      const claimed = await claimTenantFairAsaasWebhooks(tx, {
        statuses: ['PENDENTE'],
        maxAttempts: 8,
        limit: 4,
      });
      const nextClaim = await claimTenantFairAsaasWebhooks(tx, {
        statuses: ['PENDENTE'],
        maxAttempts: 8,
        limit: 4,
      });
      return { first: claimed.map((row) => row.id).sort(), next: nextClaim.map((row) => row.id) };
    });

    expect(firstBatch.first).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(firstBatch.next).toEqual(['a3']);
  });
});
