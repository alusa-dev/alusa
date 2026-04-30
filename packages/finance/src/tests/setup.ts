import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import path from 'node:path';

const projectDir = path.resolve(__dirname, '..', '..', '..', '..');

if (!process.env.DATABASE_URL?.includes('alusa_test')) {
  throw new Error(
    '❌ ERRO CRÍTICO: DATABASE_URL não está apontando para o banco de teste!\n' +
      'Esperado: URL de banco contendo alusa_test\n' +
      `Atual: ${process.env.DATABASE_URL}\n\n` +
      'Para corrigir:\n' +
      '1. Certifique-se que .env.test existe\n' +
      '2. Execute: pnpm db:migrate:test\n' +
      '3. Execute: pnpm --filter @alusa/finance test:unit\n',
  );
}

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

async function ensureMigrations(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Usuario') AS exists",
    );

    if (!rows[0]?.exists) {
      execSync('pnpm prisma migrate deploy --schema=prisma/schema.prisma', {
        stdio: 'inherit',
        cwd: projectDir,
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      });
      return;
    }

    execSync('pnpm prisma migrate deploy --schema=prisma/schema.prisma', {
      stdio: 'inherit',
      cwd: projectDir,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    });
  } finally {
    await prisma.$disconnect();
  }
}

await ensureMigrations();
