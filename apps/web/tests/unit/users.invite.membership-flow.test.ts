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
    sendInviteEmail: vi.fn().mockResolvedValue({ delivery: 'logged', emailId: null }),
    sendEmailVerificationForUser: vi.fn(),
  };
});

import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/auth-password';
import { createInvite, deleteInviteById } from '@alusa/lib/server/services/invite-user-service';
import { acceptInvite } from '@alusa/lib/server/services/invite-user-service';
import { POST as invitePost } from '@/app/api/users/invite/route';
import { POST as acceptPost } from '@/app/api/users/accept/route';

describe('convite multi-tenant por identidade global', () => {
  const fixtureContaIds = [
    'invite-flow-origin', 'invite-flow-existing', 'invite-flow-accept',
    'invite-flow-school-a', 'invite-flow-school-b', 'invite-flow-duplicate',
    'invite-flow-delete', 'invite-flow-delete-other', 'invite-flow-no-membership',
    'invite-flow-reactivate-a', 'invite-flow-reactivate-b', 'invite-flow-race',
  ];
  const fixtureEmails = [
    'invite-flow-admin-origin@example.com', 'invite-flow-owner-existing@example.com',
    'invite-flow-admin-accept@example.com', 'invite-flow-new-colleague@example.com',
    'invite-flow-admin-a@example.com', 'invite-flow-admin-b@example.com',
    'invite-flow-collaborator@example.com', 'invite-flow-admin-duplicate@example.com',
    'invite-flow-duplicate-target@example.com', 'invite-flow-orphan-admin@example.com',
    'invite-flow-reactivate-admin@example.com', 'invite-flow-reactivate-user@example.com',
    'invite-flow-race-admin@example.com', 'invite-flow-race-target@example.com',
  ];

  async function cleanupFixtures() {
    await prisma.invite.deleteMany({ where: { contaId: { in: fixtureContaIds } } });
    await prisma.usuarioConta.deleteMany({ where: { contaId: { in: fixtureContaIds } } });
    await prisma.conta.updateMany({ where: { id: { in: fixtureContaIds } }, data: { ownerUserId: null } });
    await prisma.usuario.deleteMany({ where: { email: { in: fixtureEmails } } });
  }

  async function ensureConta(id: string, nome: string) {
    return prisma.conta.upsert({
      where: { id },
      update: { nome, status: 'ATIVO', ownerUserId: null },
      create: { id, nome, status: 'ATIVO' },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupFixtures();
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  it('convida um email já cadastrado sem duplicar a identidade e cria o vínculo após autenticação', async () => {
    const password = 'Abcdef1!';
    const contaOrigemId = 'invite-flow-origin';
    const contaExistenteId = 'invite-flow-existing';
    const adminEmail = 'invite-flow-admin-origin@example.com';
    const existingOwnerEmail = 'invite-flow-owner-existing@example.com';
    await Promise.all([
      ensureConta(contaOrigemId, 'Escola Origem'),
      ensureConta(contaExistenteId, 'Escola Existente'),
    ]);

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
    const token = inviteJson.invite.token as string;

    await expect(
      prisma.usuario.count({ where: { email: existingOwnerEmail } }),
    ).resolves.toBe(1);

    await expect(
      prisma.usuarioConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: existingOwner.id, contaId: contaOrigemId } },
        select: { id: true },
      }),
    ).resolves.toBeNull();

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: existingOwner.id, email: existingOwnerEmail, role: 'ADMIN', contaId: contaExistenteId },
    } as never);
    const acceptResponse = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }));
    expect(acceptResponse.status).toBe(200);
    await expect(prisma.usuario.count({ where: { email: existingOwnerEmail } })).resolves.toBe(1);
    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: existingOwner.id, contaId: contaOrigemId } },
    })).resolves.toMatchObject({ role: Role.FINANCEIRO, status: 'ATIVO' });
  });

  it('cria a conta e o vínculo da escola ao aceitar um convite novo sem sessão', async () => {
    const contaId = 'invite-flow-accept';
    const adminEmail = 'invite-flow-admin-accept@example.com';
    const inviteEmail = 'invite-flow-new-colleague@example.com';
    await ensureConta(contaId, 'Escola teste de aceite');
    const admin = await prisma.usuario.create({
      data: {
        contaId,
        nome: 'Admin teste',
        email: adminEmail,
        senhaHash: await hashPassword('Abcdef1!'),
        role: Role.ADMIN,
        status: 'ATIVO',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.usuarioConta.create({
      data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' },
    });
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: admin.id, role: 'ADMIN', contaId, name: admin.nome },
    } as never);

    const inviteResponse = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: 'RECEPCAO' }),
    }));
    expect(inviteResponse.status).toBe(201);
    const inviteJson = await inviteResponse.json();
    const token = inviteJson.invite.token as string;

    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const acceptResponse = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        name: 'Bia Alencar',
        email: inviteEmail,
        password: 'Aa!23456',
      }),
    }));
    const acceptJson = await acceptResponse.json();

    expect(acceptResponse.status, JSON.stringify(acceptJson)).toBe(200);
    expect(acceptJson.user).toMatchObject({ email: inviteEmail, role: 'RECEPCAO', contaId });
    await expect(prisma.usuarioConta.findFirst({
      where: { contaId, usuario: { email: inviteEmail } },
      select: { role: true, status: true },
    })).resolves.toMatchObject({ role: Role.RECEPCAO, status: 'ATIVO' });
    await expect(prisma.invite.findUnique({ where: { token }, select: { status: true } }))
      .resolves.toMatchObject({ status: 'ACCEPTED' });
  });

  it('permite convites pendentes simultâneos para o mesmo usuário em escolas distintas', async () => {
    const accountIds = ['invite-flow-school-a', 'invite-flow-school-b'];
    const emails = ['invite-flow-admin-a@example.com', 'invite-flow-admin-b@example.com'];
    const targetEmail = 'invite-flow-collaborator@example.com';
    await Promise.all(accountIds.map((id) => ensureConta(id, id)));
    const hashedPassword = await hashPassword('Abcdef1!');
    const admins = await Promise.all(accountIds.map((contaId, index) => prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: emails[index], senhaHash: hashedPassword, role: Role.ADMIN },
    })));
    await Promise.all(admins.map((admin, index) => prisma.usuarioConta.create({
      data: { usuarioId: admin.id, contaId: accountIds[index], role: Role.ADMIN, status: 'ATIVO' },
    })));

    const results = [];
    for (let index = 0; index < admins.length; index += 1) {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: admins[index].id, role: 'ADMIN', contaId: accountIds[index] } } as never);
      results.push(await invitePost(new Request('http://x/api/users/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, role: 'FINANCEIRO' }),
      })));
    }
    expect(results.map((result) => result.status)).toEqual([201, 201]);
  });

  it('recusa criar convite quando a identidade do convidador não tem membership ativa na escola', async () => {
    const contaId = 'invite-flow-no-membership';
    const adminEmail = 'invite-flow-orphan-admin@example.com';
    await ensureConta(contaId, 'Escola sem membership do convidador');
    const admin = await prisma.usuario.create({
      data: {
        contaId, nome: 'Admin sem vínculo', email: adminEmail,
        senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO',
      },
    });
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: admin.id, role: 'ADMIN', contaId },
    } as never);

    const response = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'target-without-inviter@example.test', role: 'RECEPCAO' }),
    }));

    expect(response.status).toBe(403);
    await expect(prisma.invite.count({ where: { contaId } })).resolves.toBe(0);
  });

  it('reinvita e reativa membership inativa em A sem alterar vínculo, papel ou histórico de B', async () => {
    const contaA = 'invite-flow-reactivate-a';
    const contaB = 'invite-flow-reactivate-b';
    await Promise.all([ensureConta(contaA, contaA), ensureConta(contaB, contaB)]);
    const admin = await prisma.usuario.create({
      data: { contaId: contaA, nome: 'Admin A', email: 'invite-flow-reactivate-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    const target = await prisma.usuario.create({
      data: { contaId: contaA, nome: 'Usuário', email: 'invite-flow-reactivate-user@example.com', senhaHash: 'test', role: Role.PROFESSOR, status: 'ATIVO' },
    });
    await prisma.usuarioConta.createMany({ data: [
      { usuarioId: admin.id, contaId: contaA, role: Role.ADMIN, status: 'ATIVO' },
      { usuarioId: target.id, contaId: contaA, role: Role.PROFESSOR, status: 'INATIVO', createdAt: new Date('2020-01-02T00:00:00.000Z') },
      { usuarioId: target.id, contaId: contaB, role: Role.FINANCEIRO, status: 'ATIVO', createdAt: new Date('2021-02-03T00:00:00.000Z') },
    ] });
    await prisma.auditLog.create({
      data: { contaId: contaA, actorType: 'USER', actorId: admin.id, action: 'USER_TENANT_ACCESS_SUSPENDED', entityType: 'UsuarioConta', entityId: `${target.id}:${contaA}` },
    });
    const schoolBBefore = await prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: target.id, contaId: contaB } },
      select: { role: true, status: true, createdAt: true, updatedAt: true, invitedById: true, inviteId: true },
    });

    const invite = await createInvite('invite-flow-reactivate-user@example.com', Role.RECEPCAO, admin.id, contaA);
    await acceptInvite(invite.token, 'Usuário reativado', 'test', invite.email, target.id);

    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: target.id, contaId: contaA } },
      select: { role: true, status: true, createdAt: true },
    })).resolves.toMatchObject({ role: Role.RECEPCAO, status: 'ATIVO', createdAt: new Date('2020-01-02T00:00:00.000Z') });
    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: target.id, contaId: contaB } },
      select: { role: true, status: true, createdAt: true, updatedAt: true, invitedById: true, inviteId: true },
    })).resolves.toEqual(schoolBBefore);
    await expect(prisma.auditLog.findFirst({
      where: { contaId: contaA, action: 'USER_TENANT_ACCESS_SUSPENDED', entityId: `${target.id}:${contaA}` },
      select: { id: true },
    })).resolves.toBeTruthy();
  });

  it('serializa convites simultâneos para mesma conta e e-mail', async () => {
    const contaId = 'invite-flow-race';
    await ensureConta(contaId, contaId);
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin Race', email: 'invite-flow-race-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });

    const results = await Promise.allSettled([
      createInvite('invite-flow-race-target@example.com', Role.FINANCEIRO, admin.id, contaId),
      createInvite('INVITE-FLOW-RACE-TARGET@example.com', Role.FINANCEIRO, admin.id, contaId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(prisma.invite.count({ where: { contaId, email: { equals: 'invite-flow-race-target@example.com', mode: 'insensitive' }, status: 'PENDING' } })).resolves.toBe(1);
  });

  it('mapeia convite pendente duplicado para 409 mesmo com capitalização diferente', async () => {
    const contaId = 'invite-flow-duplicate';
    const adminEmail = 'invite-flow-admin-duplicate@example.com';
    const inviteEmail = 'invite-flow-duplicate-target@example.com';
    await ensureConta(contaId, 'Escola Convite Duplicado');
    const admin = await prisma.usuario.create({
      data: {
        contaId,
        nome: 'Admin Convite',
        email: adminEmail,
        senhaHash: await hashPassword('Abcdef1!'),
        role: Role.ADMIN,
        status: 'ATIVO',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.conta.update({ where: { id: contaId }, data: { ownerUserId: admin.id } });
    await prisma.usuarioConta.create({
      data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' },
    });

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: admin.id, role: 'ADMIN', contaId, name: admin.nome },
    } as never);

    const first = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: 'FINANCEIRO' }),
    }));
    expect(first.status).toBe(201);

    const duplicate = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.toUpperCase(), role: 'FINANCEIRO' }),
    }));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: 'Já existe um convite pendente para este e-mail nesta escola.',
    });

    const originalInvite = await prisma.invite.findFirst({
      where: { contaId, email: inviteEmail, status: 'PENDING' },
      select: { id: true },
    });
    await prisma.invite.update({ where: { id: originalInvite!.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const renewed = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: 'FINANCEIRO' }),
    }));
    expect(renewed.status).toBe(201);
    await expect(prisma.invite.count({ where: { contaId, email: inviteEmail, status: 'EXPIRED' } })).resolves.toBe(1);
  });

  it('apaga fisicamente somente o convite dentro da conta solicitada', async () => {
    const contaId = 'invite-flow-delete';
    const outraContaId = 'invite-flow-delete-other';
    await Promise.all([
      ensureConta(contaId, 'Conta com convite'),
      ensureConta(outraContaId, 'Outra conta'),
    ]);

    const invite = await prisma.invite.create({
      data: {
        contaId,
        email: 'invite-flow-delete-target@example.com',
        role: Role.RECEPCAO,
        token: randomUUID(),
        invitedById: 'admin-teste',
        status: 'REVOKED',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(deleteInviteById(invite.id, outraContaId)).resolves.toBe(false);
    await expect(prisma.invite.findUnique({ where: { id: invite.id } })).resolves.not.toBeNull();

    await expect(deleteInviteById(invite.id, contaId)).resolves.toBe(true);
    await expect(prisma.invite.findUnique({ where: { id: invite.id } })).resolves.toBeNull();
  });
});
