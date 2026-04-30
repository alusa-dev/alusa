import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/auth-email-flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-email-flow')>();
  return {
    ...actual,
    sendInviteEmail: vi.fn(),
    sendEmailVerificationForUser: vi.fn(),
  };
});

import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/auth-password';
import { POST as invitePost } from '@/app/api/users/invite/route';
import { POST as acceptPost } from '@/app/api/users/accept/route';

describe('convite multi-tenant com identidade existente', () => {
  const createdContaIds: string[] = [];
  const createdEmails: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await prisma.invite.deleteMany({ where: { contaId: { in: createdContaIds } } });
    await prisma.usuarioConta.deleteMany({ where: { contaId: { in: createdContaIds } } });
    await prisma.usuario.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.conta.deleteMany({ where: { id: { in: createdContaIds } } });
    createdContaIds.length = 0;
    createdEmails.length = 0;
  });

  it('permite convidar email que ja existe como dono de outra escola e cria apenas novo vinculo', async () => {
    const password = 'Abcdef1!';
    const suffix = randomUUID();
    const contaOrigemId = `conta-origem-${suffix}`;
    const contaExistenteId = `conta-existente-${suffix}`;
    const adminEmail = `admin-${suffix}@example.com`;
    const existingOwnerEmail = `owner-${suffix}@example.com`;
    createdContaIds.push(contaOrigemId, contaExistenteId);
    createdEmails.push(adminEmail, existingOwnerEmail);

    await prisma.conta.createMany({
      data: [
        { id: contaOrigemId, nome: 'Escola Origem', status: 'ATIVO' },
        { id: contaExistenteId, nome: 'Escola Existente', status: 'ATIVO' },
      ],
    });

    const [admin, existingOwner] = await Promise.all([
      prisma.usuario.create({
        data: {
          contaId: contaOrigemId,
          nome: 'Admin Origem',
          email: adminEmail,
          senhaHash: await hashPassword(password),
          role: Role.ADMIN,
          status: 'ATIVO',
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.usuario.create({
        data: {
          contaId: contaExistenteId,
          nome: 'Owner Existente',
          email: existingOwnerEmail,
          senhaHash: await hashPassword(password),
          role: Role.ADMIN,
          status: 'ATIVO',
          emailVerifiedAt: new Date(),
        },
      }),
    ]);

    await Promise.all([
      prisma.conta.update({ where: { id: contaOrigemId }, data: { ownerUserId: admin.id } }),
      prisma.conta.update({ where: { id: contaExistenteId }, data: { ownerUserId: existingOwner.id } }),
      prisma.usuarioConta.create({
        data: { usuarioId: admin.id, contaId: contaOrigemId, role: Role.ADMIN, status: 'ATIVO' },
      }),
      prisma.usuarioConta.create({
        data: { usuarioId: existingOwner.id, contaId: contaExistenteId, role: Role.ADMIN, status: 'ATIVO' },
      }),
    ]);

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: admin.id, role: 'ADMIN', contaId: contaOrigemId, name: 'Admin Origem' },
    } as never);

    const inviteResponse = await invitePost(
      new Request('http://x/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: existingOwnerEmail, role: 'FINANCEIRO' }),
      }),
    );
    const inviteJson = await inviteResponse.json();

    expect(inviteResponse.status).toBe(201);
    expect(inviteJson.invite.email).toBe(existingOwnerEmail);

    const acceptResponse = await acceptPost(
      new Request('http://x/api/users/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: inviteJson.invite.token,
          name: 'Owner Existente',
          password,
          email: existingOwnerEmail,
        }),
      }),
    );
    const acceptJson = await acceptResponse.json();

    expect(acceptResponse.status).toBe(200);
    expect(acceptJson.user).toMatchObject({
      id: existingOwner.id,
      email: existingOwnerEmail,
      role: 'FINANCEIRO',
      contaId: contaOrigemId,
    });

    await expect(
      prisma.usuario.count({ where: { email: existingOwnerEmail } }),
    ).resolves.toBe(1);

    await expect(
      prisma.usuarioConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: existingOwner.id, contaId: contaOrigemId } },
        select: { role: true, status: true },
      }),
    ).resolves.toMatchObject({ role: 'FINANCEIRO', status: 'ATIVO' });
  });
});
