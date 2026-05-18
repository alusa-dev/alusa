import { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type TenantTransactionClient = Prisma.TransactionClient;

const globalForTenantPrisma = globalThis as unknown as {
  alusaRlsPrisma?: PrismaClient;
};

function normalizeTenantId(contaId: string) {
  const normalized = contaId.trim();
  if (!normalized) {
    throw new Error('contaId is required for tenant-scoped database access');
  }
  return normalized;
}

function shouldUseRlsRuntime() {
  return process.env.RLS_RUNTIME_ENABLED === 'true' && Boolean(process.env.DATABASE_RLS_URL);
}

function getRlsPrismaClient() {
  if (!process.env.DATABASE_RLS_URL) {
    throw new Error('DATABASE_RLS_URL is required when RLS_RUNTIME_ENABLED=true');
  }

  if (!globalForTenantPrisma.alusaRlsPrisma) {
    globalForTenantPrisma.alusaRlsPrisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_RLS_URL,
        },
      },
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }

  return globalForTenantPrisma.alusaRlsPrisma;
}

export function isRlsRuntimeEnabled() {
  return shouldUseRlsRuntime();
}

export async function runWithTenant<T>(
  contaId: string,
  callback: (_tx: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  const tenantId = normalizeTenantId(contaId);
  const client = shouldUseRlsRuntime() ? getRlsPrismaClient() : prisma;

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_conta_id', ${tenantId}, true)`;
    return callback(tx);
  });
}

export async function getTenantRuntimeHealth(contaId: string) {
  const tenantId = normalizeTenantId(contaId);
  const client = shouldUseRlsRuntime() ? getRlsPrismaClient() : prisma;

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
        ${shouldUseRlsRuntime()}::boolean AS rls_runtime_enabled
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
