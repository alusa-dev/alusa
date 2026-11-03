import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import prisma from '@/lib/prisma';
import { resolveSessionAccess } from '@/lib/auth-service';

const fixtureContaIds = ['user-relation-school-a', 'user-relation-school-b'];
const userId = 'user-relation-multitenant';
const userEmail = 'user-relation-multitenant@example.test';
const identityWithoutContaId = { id: 'user-relation-no-default-conta', email: 'user-relation-no-default-conta@example.test' };
const identityWithoutMembership = { id: 'user-relation-no-membership', email: 'user-relation-no-membership@example.test' };
const collaboratorIds = ['user-relation-collaborator-a', 'user-relation-collaborator-b'];

async function cleanup() {
  await prisma.colaborador.deleteMany({ where: { id: { in: collaboratorIds } } });
  await prisma.usuarioConta.deleteMany({ where: { usuarioId: userId } });
  await prisma.usuario.deleteMany({ where: { id: { in: [userId, identityWithoutContaId.id, identityWithoutMembership.id] } } });
}

describe('Usuario tenant relation migration', () => {
  beforeEach(async () => {
    await cleanup();
    await Promise.all(fixtureContaIds.map((id) => prisma.conta.upsert({
      where: { id },
      update: { status: 'ATIVO' },
      create: { id, nome: id, status: 'ATIVO' },
    })));
  });

  afterEach(cleanup);

  it('preserves identities and allows one collaborator link per tenant', async () => {
    const createdAt = new Date('2022-03-04T05:06:07.000Z');
    await prisma.usuario.create({
      data: {
        id: userId,
        contaId: null,
        nome: 'Multi tenant employee',
        email: userEmail,
        senhaHash: 'test',
        role: Role.PROFESSOR,
        status: 'ATIVO',
        createdAt,
      },
    });
    await prisma.usuarioConta.createMany({ data: fixtureContaIds.map((contaId) => ({
      usuarioId: userId, contaId, role: Role.PROFESSOR, status: 'ATIVO',
    })) });

    await prisma.colaborador.createMany({ data: fixtureContaIds.map((contaId, index) => ({
      id: collaboratorIds[index],
      contaId,
      usuarioId: userId,
      nome: `Employee ${index + 1}`,
      cargo: 'ADMINISTRATIVO' as const,
    })) });

    await expect(prisma.usuario.findUnique({
      where: { id: userId },
      select: { id: true, contaId: true, createdAt: true },
    })).resolves.toEqual({ id: userId, contaId: null, createdAt });
    await expect(prisma.colaborador.count({ where: { usuarioId: userId } })).resolves.toBe(2);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: userId, status: 'ATIVO' } })).resolves.toBe(2);
    await expect(resolveSessionAccess({ userId, contaId: fixtureContaIds[0], sessionVersion: 0 }))
      .resolves.toMatchObject({ ok: true, contaId: fixtureContaIds[0], role: Role.PROFESSOR });
  });

  it('rejects a duplicate collaborator link and a link into a tenant without membership', async () => {
    await prisma.usuario.create({
      data: { id: userId, contaId: null, nome: 'Employee', email: userEmail, senhaHash: 'test', status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({
      data: { usuarioId: userId, contaId: fixtureContaIds[0], role: Role.PROFESSOR, status: 'ATIVO' },
    });
    const profile = {
      id: collaboratorIds[0], contaId: fixtureContaIds[0], usuarioId: userId,
      nome: 'Employee A', cargo: 'ADMINISTRATIVO' as const,
    };
    await prisma.colaborador.create({ data: profile });
    await expect(prisma.colaborador.create({
      data: { ...profile, id: collaboratorIds[1], nome: 'Duplicate A' },
    })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.colaborador.count({ where: { contaId: fixtureContaIds[0], usuarioId: userId } })).resolves.toBe(1);
    await expect(prisma.colaborador.create({
      data: { ...profile, id: 'user-relation-collaborator-no-membership', contaId: fixtureContaIds[1], nome: 'No Membership B' },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.colaborador.count({ where: { usuarioId: userId } })).resolves.toBe(1);
  });

  it('denies membership-less identities even when contaId is null', async () => {
    await prisma.usuario.create({
      data: {
        ...identityWithoutMembership, contaId: null, nome: 'No membership', senhaHash: 'test',
        status: 'ATIVO', sessionVersion: 0,
      },
    });
    await expect(resolveSessionAccess({
      userId: identityWithoutMembership.id, contaId: fixtureContaIds[0], sessionVersion: 0,
    })).resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
  });

  it('makes the legacy account optional and preserves the Conta FK with SET NULL', async () => {
    const [column, foreignKey, uniqueIndex] = await Promise.all([
      prisma.$queryRaw<Array<{ is_nullable: string }>>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Usuario' AND column_name = 'contaId'
      `,
      prisma.$queryRaw<Array<{ delete_action: string }>>`
        SELECT CASE confdeltype WHEN 'n' THEN 'SET NULL' ELSE confdeltype::text END AS delete_action
        FROM pg_constraint WHERE conname = 'Usuario_contaId_fkey'
      `,
      prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'
          AND indexname = 'Colaborador_contaId_usuarioId_key'
      `,
    ]);

    expect(column[0]?.is_nullable).toBe('YES');
    expect(foreignKey[0]?.delete_action).toBe('SET NULL');
    expect(uniqueIndex[0]?.indexdef).toContain('("contaId", "usuarioId")');

    const disconnectedIdentity = await prisma.usuario.create({
      data: {
        ...identityWithoutContaId,
        contaId: null,
        nome: 'Identity without default school',
        senhaHash: 'test',
      },
      select: { id: true, contaId: true },
    });
    expect(disconnectedIdentity).toEqual({ id: identityWithoutContaId.id, contaId: null });
  });

  it('preserves identity and membership when the historical coverage contract rejects hard Conta deletion', async () => {
    await prisma.usuario.create({
      data: {
        ...identityWithoutContaId, contaId: fixtureContaIds[0], nome: 'Identity to preserve', senhaHash: 'test',
      },
    });
    await prisma.usuarioConta.create({
      data: { usuarioId: identityWithoutContaId.id, contaId: fixtureContaIds[0], role: Role.RESPONSAVEL, status: 'ATIVO' },
    });

    await expect(prisma.conta.delete({ where: { id: fixtureContaIds[0] } })).rejects.toThrow();
    await expect(prisma.usuario.findUnique({
      where: { id: identityWithoutContaId.id }, select: { id: true, contaId: true },
    })).resolves.toEqual({ id: identityWithoutContaId.id, contaId: fixtureContaIds[0] });
    await expect(prisma.usuarioConta.count({
      where: { usuarioId: identityWithoutContaId.id, contaId: fixtureContaIds[0] },
    })).resolves.toBe(1);
  });
});
