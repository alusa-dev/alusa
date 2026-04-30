import { PrismaClient } from '@prisma/client';
import { prisma as shared } from '@alusa/lib';

// Reset DB truncando tabelas (exceto migrations)
export async function resetDb(prisma?: PrismaClient) {
  const env = process.env.NODE_ENV;
  if (env !== 'test') throw new Error('resetDb apenas em NODE_ENV=test');
  const client = prisma || (shared as PrismaClient);
  const rows = await client.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations')",
  );
  if (rows.length) {
    const tables = rows.map((r) => '"' + r.tablename + '"').join(', ');
    // Use um lock advisory para evitar deadlocks em execuções paralelas
    await client.$executeRawUnsafe('SELECT pg_advisory_lock(424242)');
    try {
      await client.$executeRawUnsafe('SET session_replication_role = replica;');
      // Retry simples em caso de deadlock 40P01
      for (let i = 0; i < 3; i++) {
        try {
          await client.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
          break;
        } catch (e: unknown) {
          const code =
            typeof e === 'object' && e && 'code' in e ? (e as { code?: string }).code : undefined;
          if (code === '40P01' && i < 2) {
            await new Promise((r) => setTimeout(r, 100 * (i + 1)));
            continue;
          }
          throw e;
        }
      }
    } finally {
      await client.$executeRawUnsafe('SET session_replication_role = DEFAULT;');
      await client.$executeRawUnsafe('SELECT pg_advisory_unlock(424242)');
    }
  }
  // Singleton não deve ser desconectado aqui
  if (prisma && prisma !== (shared as PrismaClient)) await client.$disconnect();
}
