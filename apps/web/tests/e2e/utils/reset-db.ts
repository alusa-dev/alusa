import { PrismaClient } from '@prisma/client';

export async function resetDb() {
  const prisma = new PrismaClient();
  try {
    const dbNameRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      'SELECT current_database() AS name',
    );
    const currentDb = dbNameRows[0]?.name || '';
    const url = process.env.DATABASE_URL || '';
    const isTestLike = currentDb.includes('test') || url.includes('alusa_test');
    const allow = isTestLike || process.env.ALLOW_E2E_RESET === 'true';
    if (!allow) {
      throw new Error(
        `resetDb bloqueado: banco atual não parece de teste (current_database=${currentDb}). Defina DATABASE_URL de teste.`,
      );
    }

    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations')",
    );
    if (!rows.length) return;
    const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
  } finally {
    await prisma.$disconnect();
  }
}
