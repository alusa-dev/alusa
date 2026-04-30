import '@testing-library/jest-dom';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ⚠️ CRITICAL: Testes DEVEM ser executados com .env.test carregado via dotenv-cli
// Comando correto: pnpm test:unit (já configurado no package.json)
// Isso garante que TODOS os testes usem o banco de teste, NUNCA o de desenvolvimento

const projectDir = path.resolve(__dirname, '..', '..', '..');
const migrationState = globalThis as typeof globalThis & {
  __ALUSA_TEST_MIGRATIONS__?: Promise<void>;
};

// ⚠️ VALIDAÇÃO: Garante que está usando banco de teste
if (!process.env.DATABASE_URL?.includes('alusa_test')) {
  throw new Error(
    '❌ ERRO CRÍTICO: DATABASE_URL não está apontando para o banco de teste!\n' +
      'Esperado: URL de banco contendo alusa_test\n' +
      `Atual: ${process.env.DATABASE_URL}\n\n` +
      'Para corrigir:\n' +
      '1. Certifique-se que .env.test existe\n' +
      '2. Execute: pnpm db:migrate:test\n' +
      '3. Execute: pnpm test:unit\n',
  );
}

console.log('✅ Usando banco de teste:', process.env.DATABASE_URL?.replace(/:[^:]*@/, ':***@'));

// Alguns testes dependem de criptografia (AES-256-GCM) via ENCRYPTION_KEY.
// Mantém compatível com .env.test, mas fornece fallback para não quebrar a suite local/CI.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

// Silencia logs de pacotes externos ruidosos durante testes
const noisy = ['DATABASE_URL não definido'];
const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
  if (noisy.some((n) => msg.includes(n))) return;
  origWarn(...(args as []));
};

// Garante que as migrações foram aplicadas antes dos testes que tocam o banco.
async function runMigrationsOnce() {
  const prisma = new PrismaClient();
  try {
    console.log('🔍 Verificando migrações no banco de teste...');
    const latestLocalMigration = fs
      .readdirSync(path.join(projectDir, 'prisma', 'migrations'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .at(-1);

    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Usuario') AS exists`,
    );

    if (!rows[0]?.exists) {
      console.log('⚠️  Tabelas não encontradas. Aplicando migrações...');
    } else if (!latestLocalMigration) {
      console.log('✅ Nenhuma migration local encontrada. Pulando migrate deploy.');
      return;
    } else {
      const latestApplied = await prisma.$queryRawUnsafe<Array<{ migration_name: string | null }>>(
        `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST, migration_name DESC LIMIT 1`,
      );

      if (latestApplied[0]?.migration_name === latestLocalMigration) {
        console.log('✅ Banco de teste já está na última migration. Pulando migrate deploy.');
        return;
      }

      console.log('✅ Estrutura base encontrada. Aplicando migrações pendentes...');
    }

    execSync('pnpm prisma migrate deploy --schema=prisma/schema.prisma', {
      stdio: 'inherit',
      cwd: projectDir,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    });
    console.log('✅ Migrações sincronizadas com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao verificar/aplicar migrações:', error);
    try {
      console.log('🔄 Tentando aplicar migrações novamente...');
      execSync('pnpm prisma migrate deploy --schema=prisma/schema.prisma', {
        stdio: 'inherit',
        cwd: projectDir,
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      });
      console.log('✅ Migrações aplicadas!');
    } catch (retryError) {
      console.error('❌ Falha ao aplicar migrações:', retryError);
      throw retryError;
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureMigrations() {
  if (!migrationState.__ALUSA_TEST_MIGRATIONS__) {
    migrationState.__ALUSA_TEST_MIGRATIONS__ = runMigrationsOnce();
  }

  await migrationState.__ALUSA_TEST_MIGRATIONS__;
}

// Aplica migrações antes de iniciar os testes
await ensureMigrations();
