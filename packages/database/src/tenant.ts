import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { prisma } from './client.js';

export type TenantTransactionClient = Prisma.TransactionClient;

const globalForTenantPrisma = globalThis as unknown as {
  alusaRlsPrisma?: PrismaClient;
};

export function normalizeTenantId(contaId: string) {
  const normalized = contaId.trim();
  if (!normalized) {
    throw new Error('contaId is required for tenant-scoped database access');
  }
  return normalized;
}

export function isRlsRuntimeEnabled() {
  return process.env.RLS_RUNTIME_ENABLED === 'true';
}

export function getTenantPrismaClient() {
  if (!isRlsRuntimeEnabled()) return prisma;
  if (!process.env.DATABASE_RLS_URL) {
    throw new Error('DATABASE_RLS_URL is required when RLS_RUNTIME_ENABLED=true');
  }

  if (!globalForTenantPrisma.alusaRlsPrisma) {
    globalForTenantPrisma.alusaRlsPrisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_RLS_URL } },
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return globalForTenantPrisma.alusaRlsPrisma;
}

export async function runWithTenant<T>(
  contaId: string,
  callback: (_tx: TenantTransactionClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  const tenantId = normalizeTenantId(contaId);
  const client = getTenantPrismaClient();
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_conta_id', ${tenantId}, true)`;
    return callback(tx);
  }, options);
}

export async function getTenantRuntimeHealth(contaId: string) {
  const tenantId = normalizeTenantId(contaId);
  const client = getTenantPrismaClient();

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_conta_id', ${tenantId}, true)`;
    const [connection] = await tx.$queryRaw<
      Array<{
        current_user: string;
        current_conta_id: string | null;
        rls_runtime_enabled: boolean;
      }>
    >`
      SELECT
        current_user,
        app_security.current_conta_id() AS current_conta_id,
        ${isRlsRuntimeEnabled()}::boolean AS rls_runtime_enabled
    `;
    const [sample] = await tx.$queryRaw<Array<{ aluno_count: bigint }>>`
      SELECT COUNT(*)::bigint AS aluno_count
      FROM "Aluno"
      WHERE "contaId" = ${tenantId}
    `;
    return {
      currentUser: connection?.current_user ?? null,
      currentContaId: connection?.current_conta_id ?? null,
      rlsRuntimeEnabled: connection?.rls_runtime_enabled ?? false,
      alunoCount: Number(sample?.aluno_count ?? 0),
    };
  });
}
