import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  ADMIN_PERMISSIONS,
  adminRoleFromSupportRole,
} from '../../packages/admin-auth/src/roles.ts';

const prisma = new PrismaClient();

const BREAK_GLASS_PERMISSIONS = [...ADMIN_PERMISSIONS];

function looksLikeProductionDatabase(url: string) {
  const normalized = url.toLowerCase();
  return normalized.includes('alusa_prod') || normalized.includes('_prod');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL não definida.');
  if (looksLikeProductionDatabase(databaseUrl) && process.env.ADMIN_BACKFILL_CONFIRM !== 'YES') {
    throw new Error('Banco de produção detectado. Use ADMIN_BACKFILL_CONFIRM=YES para confirmar.');
  }

  const supportUsers = await prisma.supportUser.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      breakGlassExpiresAt: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let created = 0;
  let existing = 0;
  let elevations = 0;

  for (const supportUser of supportUsers) {
    const existingAdminUser = await prisma.adminUser.findUnique({
      where: { legacySupportUserId: supportUser.id },
      select: { id: true },
    });
    const adminUser = await prisma.adminUser.upsert({
      where: { legacySupportUserId: supportUser.id },
      update: {
        legacySupportRole: supportUser.role,
      },
      create: {
        id: randomUUID(),
        username: supportUser.username,
        email: supportUser.email,
        passwordHash: supportUser.passwordHash,
        role: adminRoleFromSupportRole(supportUser.role),
        status: supportUser.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED',
        legacySupportUserId: supportUser.id,
        legacySupportRole: supportUser.role,
        lastLoginAt: supportUser.lastLoginAt,
        createdAt: supportUser.createdAt,
        updatedAt: supportUser.updatedAt,
      },
    });

    if (existingAdminUser) existing += 1;
    else created += 1;

    if (supportUser.role === 'BREAK_GLASS' && supportUser.breakGlassExpiresAt) {
      await prisma.temporaryElevation.upsert({
        where: { sourceSupportUserId: supportUser.id },
        update: {
          adminUserId: adminUser.id,
          expiresAt: supportUser.breakGlassExpiresAt,
          revokedAt: supportUser.breakGlassExpiresAt.getTime() <= Date.now() ? new Date() : null,
        },
        create: {
          id: randomUUID(),
          adminUserId: adminUser.id,
          sourceSupportUserId: supportUser.id,
          reason: 'Migração do acesso BREAK_GLASS legado para elevação temporária.',
          permissions: BREAK_GLASS_PERMISSIONS,
          expiresAt: supportUser.breakGlassExpiresAt,
          revokedAt: supportUser.breakGlassExpiresAt.getTime() <= Date.now() ? new Date() : null,
        },
      });
      elevations += 1;
    }
  }

  console.log('[admin-backfill] concluído', { total: supportUsers.length, created, existing, elevations });
}

main()
  .catch((error) => {
    console.error('[admin-backfill] falhou', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
