import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import prisma from '@/lib/prisma';

const fixtureContaIds = [
  'membership-backfill-missing',
  'membership-backfill-existing',
  'membership-backfill-suspended',
  'membership-backfill-legacy-removed',
];
const fixtureUsers = [
  { id: 'membership-backfill-user-missing', email: 'membership-backfill-missing@example.test', contaId: fixtureContaIds[0] },
  { id: 'membership-backfill-user-existing', email: 'membership-backfill-existing@example.test', contaId: fixtureContaIds[1] },
  { id: 'membership-backfill-user-suspended', email: 'membership-backfill-suspended@example.test', contaId: fixtureContaIds[2] },
  { id: 'membership-backfill-user-legacy-removed', email: 'membership-backfill-legacy-removed@example.test', contaId: fixtureContaIds[3] },
];
const migrationSql = readFileSync(
  resolve(process.cwd(), '../../prisma/migrations/20261103120000_backfill_usuario_conta_memberships/migration.sql'),
  'utf8',
);
const legacyCreatedAt = new Date('2021-04-05T06:07:08.000Z');

async function cleanupFixtures() {
  await prisma.usuarioConta.deleteMany({ where: { contaId: { in: fixtureContaIds } } });
  await prisma.auditLog.deleteMany({ where: { contaId: { in: fixtureContaIds } } });
  await prisma.conta.updateMany({ where: { id: { in: fixtureContaIds } }, data: { ownerUserId: null } });
  await prisma.usuario.deleteMany({ where: { id: { in: fixtureUsers.map((user) => user.id) } } });
}

describe('UsuarioConta legacy backfill migration', () => {
  afterEach(cleanupFixtures);

  beforeEach(async () => {
    await cleanupFixtures();
    await Promise.all(fixtureContaIds.map((id) => prisma.conta.upsert({
      where: { id },
      update: { status: 'ATIVO' },
      create: { id, nome: id, status: 'ATIVO' },
    })));
    await prisma.usuario.createMany({
      data: [
        { ...fixtureUsers[0], nome: 'Legacy Missing', senhaHash: 'test', role: Role.PROFESSOR, status: 'INATIVO', createdAt: legacyCreatedAt },
        { ...fixtureUsers[1], nome: 'Existing Membership', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
        { ...fixtureUsers[2], nome: 'Explicitly Removed', senhaHash: 'test', role: Role.RECEPCAO, status: 'ATIVO' },
        { ...fixtureUsers[3], nome: 'Legacy Removed', senhaHash: 'test', role: Role.FINANCEIRO, status: 'ATIVO' },
      ],
    });
    await prisma.usuarioConta.create({
      data: {
        usuarioId: fixtureUsers[1].id,
        contaId: fixtureContaIds[1],
        role: Role.FINANCEIRO,
        status: 'INATIVO',
      },
    });
    await prisma.auditLog.create({
      data: {
        contaId: fixtureContaIds[2],
        actorType: 'USER',
        action: 'USER_TENANT_ACCESS_SUSPENDED',
        entityType: 'UsuarioConta',
        entityId: `${fixtureUsers[2].id}:${fixtureContaIds[2]}`,
      },
    });
    await prisma.auditLog.create({
      data: {
        contaId: fixtureContaIds[3],
        actorType: 'USER',
        action: 'USER_TENANT_ACCESS_REMOVED',
        entityType: 'UsuarioConta',
        entityId: fixtureUsers[3].id,
      },
    });
    // A legacy removal audit in another school must not suppress the default
    // membership being backfilled for this user's own tenant.
    await prisma.auditLog.create({
      data: {
        contaId: fixtureContaIds[1],
        actorType: 'USER',
        action: 'USER_TENANT_ACCESS_REMOVED',
        entityType: 'UsuarioConta',
        entityId: fixtureUsers[0].id,
      },
    });
  });

  it('backfills missing pairs once, preserves memberships and dates, and excludes both suspension audit formats', async () => {
    const inserted = await prisma.$executeRawUnsafe(migrationSql);
    expect(inserted).toBeGreaterThanOrEqual(1);

    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: fixtureUsers[0].id, contaId: fixtureContaIds[0] } },
      select: { role: true, status: true, createdAt: true, updatedAt: true },
    })).resolves.toMatchObject({ role: Role.PROFESSOR, status: 'INATIVO', createdAt: legacyCreatedAt });
    const backfilledMembership = await prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: fixtureUsers[0].id, contaId: fixtureContaIds[0] } },
      select: { createdAt: true, updatedAt: true },
    });
    expect(backfilledMembership?.updatedAt.getTime()).toBeGreaterThanOrEqual(legacyCreatedAt.getTime());

    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: fixtureUsers[1].id, contaId: fixtureContaIds[1] } },
      select: { role: true, status: true },
    })).resolves.toEqual({ role: Role.FINANCEIRO, status: 'INATIVO' });

    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: fixtureUsers[2].id, contaId: fixtureContaIds[2] } },
    })).resolves.toBeNull();
    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: fixtureUsers[3].id, contaId: fixtureContaIds[3] } },
    })).resolves.toBeNull();

    await expect(prisma.$executeRawUnsafe(migrationSql)).resolves.toBe(0);
  });
});
