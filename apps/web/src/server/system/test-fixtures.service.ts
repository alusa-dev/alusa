import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { Role } from '@prisma/client';
import { revokeUserSessions } from '@/lib/auth-service';

const TEST_CONTA_ID = 'conta-default';

export async function findDevUserByEmail(email: string) {
  return prisma.usuario.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' } },
    select: { id: true, email: true, nome: true, role: true },
  });
}

export async function setDevUserPassword(input: { email: string; password: string }) {
  const user = await prisma.usuario.findFirst({
    where: { email: { equals: input.email.trim(), mode: 'insensitive' } },
    select: { id: true },
  });
  if (!user) return null;

  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  const pepper = process.env.BCRYPT_PEPPER || '';
  const senhaHash = await bcrypt.hash(input.password + pepper, rounds);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: user.id },
      data: { senhaHash, passwordChangedAt: new Date() },
    });
    await revokeUserSessions(user.id, tx);
  });
  return { id: user.id };
}

export async function createTestInvite(input: { email: string; role: Role }) {
  const email = input.email.toLowerCase();
  const existing = await prisma.invite.findFirst({
    where: { email, status: 'PENDING', contaId: TEST_CONTA_ID },
  });
  if (existing) return existing;

  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  return prisma.$transaction(async (tx) => {
    const conta = await tx.conta.upsert({
      where: { id: TEST_CONTA_ID },
      update: {},
      create: {
        id: TEST_CONTA_ID,
        nome: 'Alusa Demo',
        cpfCnpj: '00000000000191',
        status: 'ATIVO',
        ownerUserId: null,
      },
    });
    const owner = await tx.usuario.upsert({
      where: { email: 'owner+test-invite@example.com' },
      update: { contaId: conta.id },
      create: {
        id: 'owner-test-invite',
        contaId: conta.id,
        nome: 'Owner Test Invite',
        email: 'owner+test-invite@example.com',
        senhaHash: 'x',
        role: 'ADMIN',
        status: 'ATIVO',
      },
    });
    await tx.conta.update({ where: { id: conta.id }, data: { ownerUserId: owner.id } });
    const admin = await tx.usuario.upsert({
      where: { email: 'admin@example.com' },
      update: { contaId: conta.id },
      create: {
        contaId: conta.id,
        nome: 'Admin Test',
        email: 'admin@example.com',
        senhaHash: 'test',
        role: 'ADMIN',
        status: 'ATIVO',
      },
    });

    return tx.invite.create({
      data: {
        email,
        role: input.role,
        token: randomUUID(),
        invitedById: admin.id,
        status: 'PENDING',
        expiresAt,
        contaId: conta.id,
      },
    });
  });
}
