/**
 * Cria ou atualiza um utilizador da central de suporte (SupportUser).
 *
 * Produção (Neon alusa_prod, etc.):
 *   SUPPORT_UPSERT_CONFIRM=YES pnpm exec dotenv -e ./.env.production.local -- tsx scripts/support-upsert-admin-user.ts alusa 'senha-forte'
 *
 * Local:
 *   pnpm exec dotenv -e ./.env.local -- tsx scripts/support-upsert-admin-user.ts alusa 'senha-local'
 */

import process from 'node:process';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

function looksProductionDatabase(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('alusa_prod') || u.includes('_prod');
}

function fail(message: string): never {
  console.error(`\n[support-upsert] ${message}\n`);
  process.exit(1);
}

const [, , usernameArg, passwordArg] = process.argv;
const username = (usernameArg ?? '').trim();
const password = passwordArg ?? '';

if (!username || !password) {
  fail('Uso: tsx scripts/support-upsert-admin-user.ts <username> <password>');
}

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) {
  fail('DATABASE_URL não definida. Use dotenv -e <ficheiro> antes do comando.');
}

if (looksProductionDatabase(databaseUrl) && process.env.SUPPORT_UPSERT_CONFIRM !== 'YES') {
  fail(
    'Ambiente de produção detetado. Para confirmar: SUPPORT_UPSERT_CONFIRM=YES antes do comando.',
  );
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);

  const row = await prisma.supportUser.upsert({
    where: { username },
    create: {
      username,
      passwordHash,
      role: 'SUPPORT_ADMIN',
      status: 'ACTIVE',
    },
    update: {
      passwordHash,
      role: 'SUPPORT_ADMIN',
      status: 'ACTIVE',
    },
    select: { id: true, username: true, role: true, status: true },
  });

  console.log('[support-upsert] OK:', row);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
