import { PrismaClient } from '@prisma/client';

export async function resetDb(prisma?: PrismaClient) {
  const client = prisma || new PrismaClient();
  try {
    const dbNameRows = await client.$queryRawUnsafe<{ name: string }[]>(
      'SELECT current_database() AS name',
    );
    const currentDb = dbNameRows[0]?.name ?? '';
    const isTestDb = currentDb.toLowerCase().includes('test');
    const explicitlyAllowed = process.env.ALLOW_E2E_RESET === 'true';
    if (!isTestDb && !explicitlyAllowed) {
      throw new Error(
        `resetDb bloqueado: banco atual (${currentDb || 'desconhecido'}) não parece ser de teste. Use uma base de teste ou defina ALLOW_E2E_RESET=true explicitamente.`,
      );
    }

    const rows = await client.$queryRawUnsafe<{ tablename: string }[]>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations')",
    );
    if (!rows.length) return;

    const tables = rows
      .map((row) => `"public"."${row.tablename.replace(/"/g, '""')}"`)
      .join(', ');
    await client.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
  } finally {
    if (!prisma) await client.$disconnect();
  }
}
