import { PrismaClient } from '@prisma/client';

// Reset rápido: TRUNCATE das tabelas de domínio, preservando _prisma_migrations
export async function resetDb(prisma?: PrismaClient) {
  // Permitimos em e2e também (Playwright roda normalmente com NODE_ENV=development)
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'development') {
    // Fallback: se variável PLAYWRIGHT_TEST está presente, permitimos
    if (!process.env.PLAYWRIGHT_TEST) {
      throw new Error('resetDb só em test/e2e');
    }
  }
  const client = prisma || new PrismaClient();
  // Segurança adicional: só permite truncar se o database atual for de teste
  const dbNameRows = await client.$queryRawUnsafe<{ name: string }[]>(
    'SELECT current_database() AS name',
  );
  const currentDb = dbNameRows[0]?.name || '';
  const url = process.env.DATABASE_URL || '';
  const isTestDb = currentDb.includes('test') || url.includes('alusa_test');
  if (!isTestDb) {
    await client.$disconnect();
    throw new Error(
      `resetDb bloqueado: banco atual não parece de teste (current_database=${currentDb}). Defina DATABASE_URL para um schema de teste (ex.: alusa_test).`,
    );
  }
  // Descobre tabelas de usuário (public) exceto migrations
  const rows = await client.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations')",
  );
  if (!rows.length) return;
  const tables = rows.map((r) => '"' + r.tablename + '"').join(', ');
  // Desabilita constraints referencial para velocidade, executa truncate em cascata e restaura
  await client.$executeRawUnsafe('SET session_replication_role = replica;');
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
  await client.$executeRawUnsafe('SET session_replication_role = DEFAULT;');
  if (!prisma) await client.$disconnect();
}
