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
  };
});

import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/auth-password';
import { sendInviteEmail } from '@/lib/auth-email-flow';
import { completeInviteResend, createInvite, reserveInviteResend, revokeInviteById } from '@alusa/lib/server/services/invite-user-service';
import { acceptInvite, ExpiredInviteError, GuardianProfileConflictError, InviteStateConflictError, InvalidInviteError, InvalidInviteTargetError } from '@alusa/lib/server/services/invite-user-service';
import { removeManagedUserAccess } from '@/features/users/managed-user-access';
import { GET as inviteGet, POST as invitePost } from '@/app/api/users/invite/route';
import { DELETE as inviteDelete, POST as inviteResend } from '@/app/api/users/invite/[id]/route';
import { POST as acceptPost } from '@/app/api/users/accept/route';

function inviteTokenFromUrl(value: string) {
  const token = new URL(value).searchParams.get('token');
  if (!token) throw new Error('Resposta não contém um token no link autenticado de criação.');
  return token;
}

describe('convite multi-tenant por identidade global', () => {
  const fixtureContaIds = [
    'invite-flow-origin', 'invite-flow-existing', 'invite-flow-accept',
    'invite-flow-school-a', 'invite-flow-school-b', 'invite-flow-duplicate',
    'invite-flow-delete', 'invite-flow-delete-other', 'invite-flow-no-membership',
    'invite-flow-reactivate-a', 'invite-flow-reactivate-b', 'invite-flow-race',
    'invite-flow-list',
    'invite-flow-record-foreign', 'invite-flow-responsible-target', 'invite-flow-inactive-target',
    'invite-flow-responsible-foreign',
    'invite-flow-resend-a', 'invite-flow-resend-b',
    'invite-flow-identity-race',
  ];
  const fixtureEmails = [
    'invite-flow-admin-origin@example.com', 'invite-flow-owner-existing@example.com',
    'invite-flow-admin-accept@example.com', 'invite-flow-new-colleague@example.com',
    'invite-flow-admin-a@example.com', 'invite-flow-admin-b@example.com',
    'invite-flow-collaborator@example.com', 'invite-flow-admin-duplicate@example.com',
    'invite-flow-duplicate-target@example.com', 'invite-flow-orphan-admin@example.com',
    'invite-flow-reactivate-admin@example.com', 'invite-flow-reactivate-user@example.com',
    'invite-flow-race-admin@example.com', 'invite-flow-race-target@example.com',
    'invite-flow-list-admin@example.com',
    'invite-flow-inactive-target@example.com', 'invite-flow-inactive-admin@example.com',
    'invite-flow-responsible-admin@example.com',
    'guardian.identity@example.com',
    'guardian.foreign@example.com',
    'invite-flow-delete-admin@example.com',
    'invite-flow-resend-admin-a@example.com', 'invite-flow-resend-admin-b@example.com',
    'resend-failure@example.com', 'resend-revoked@example.com', 'resend-accepted@example.com', 'resend-stale@example.com', 'resend-recovery@example.com',
    'invite-flow-identity-race-admin@example.com', 'invite-flow-identity-race-target@example.com',
    'guardian.new-identity@example.com',
  ];
  const fixtureColaboradorIds = ['invite-flow-existing-record-collaborator', 'invite-flow-active-collaborator', 'invite-flow-foreign-collaborator', 'invite-flow-inactive-collaborator'];
  const fixtureResponsavelIds = ['invite-flow-responsavel-record', 'invite-flow-responsavel-foreign-record'];
  const fixtureStudentIds = ['invite-flow-responsavel-student', 'invite-flow-responsavel-foreign-student'];

  async function cleanupFixtures() {
    await prisma.inviteResendRequest.deleteMany({ where: { contaId: { in: fixtureContaIds } } });
    await prisma.invite.deleteMany({ where: { contaId: { in: fixtureContaIds } } });
    await prisma.colaborador.deleteMany({ where: { id: { in: fixtureColaboradorIds } } });
    await prisma.alunoResponsavel.deleteMany({ where: { contaId: { in: fixtureContaIds } } });
    await prisma.responsavel.deleteMany({ where: { id: { in: fixtureResponsavelIds } } });
    await prisma.aluno.deleteMany({ where: { id: { in: fixtureStudentIds } } });
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

  async function acceptWithVerifiedContext(token: string, email: string, userId: string) {
    const invite = await prisma.invite.findUniqueOrThrow({ where: { token }, select: { role: true } });
    const context = invite.role === Role.RESPONSAVEL ? 'PORTAL' : 'COLLABORATOR';
    await prisma.authCredential.upsert({
      where: { uq_auth_credential_context_user: { context, userId } },
      create: {
        context,
        normalizedEmail: email.trim().toLowerCase(),
        userId,
        passwordHash: 'not-used-by-service-test',
        emailVerifiedAt: new Date(),
      },
      update: { emailVerifiedAt: new Date() },
    });
    return acceptInvite(token, email, userId);
  }

  async function createStaleGuardianInviteFixture(previousMembershipStatus?: 'ATIVO' | 'INATIVO') {
    const contaId = 'invite-flow-responsible-target';
    await ensureConta(contaId, 'Conta alvo responsável');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-responsible-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const previousIdentity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Identidade anterior', email: 'guardian.identity@example.com', senhaHash: 'test', role: Role.RESPONSAVEL, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    const replacementIdentity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Nova identidade', email: 'guardian.new-identity@example.com', senhaHash: 'test', role: Role.RESPONSAVEL, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    const student = await prisma.aluno.create({
      data: { id: fixtureStudentIds[0], contaId, nome: 'Aluno preservado', dataNasc: new Date('2015-01-01T00:00:00.000Z') },
    });
    const guardian = await prisma.responsavel.create({
      data: { id: fixtureResponsavelIds[0], contaId, nome: 'Responsável preservado', cpf: '52998224725', email: 'guardian-profile@example.test', telefone: '11999999999', usuarioId: previousIdentity.id },
    });
    await prisma.alunoResponsavel.create({
      data: { contaId, alunoId: student.id, responsavelId: guardian.id, tipoVinculo: 'RESPONSAVEL' },
    });
    const invite = await createInvite(replacementIdentity.email, Role.RESPONSAVEL, admin.id, contaId, {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: guardian.id },
      alunosIds: [student.id],
    });
    if (previousMembershipStatus) {
      await prisma.usuarioConta.create({
        data: { usuarioId: previousIdentity.id, contaId, role: Role.RESPONSAVEL, status: previousMembershipStatus },
      });
    }
    return { contaId, guardian, student, previousIdentity, replacementIdentity, invite };
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
    await prisma.authCredential.create({
      data: {
        context: 'OWNER', normalizedEmail: existingOwnerEmail, userId: existingOwner.id,
        passwordHash: await hashPassword(password), emailVerifiedAt: new Date(),
      },
    });

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
    expect(inviteJson.invite).not.toHaveProperty('token');
    expect(inviteJson.invite).not.toHaveProperty('metadata');
    const token = inviteTokenFromUrl(inviteJson.invite.inviteUrl);

    await expect(
      prisma.usuario.count({ where: { email: existingOwnerEmail } }),
    ).resolves.toBe(1);

    await expect(
      prisma.usuarioConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: existingOwner.id, contaId: contaOrigemId } },
        select: { id: true },
      }),
    ).resolves.toBeNull();

    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const acceptResponse = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email: existingOwnerEmail, name: 'Owner Existente', password: 'Bb!98765' }),
    }));
    expect(acceptResponse.status).toBe(200);
    await expect(prisma.usuario.count({ where: { email: existingOwnerEmail } })).resolves.toBe(1);
    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: existingOwner.id, contaId: contaOrigemId } },
    })).resolves.toMatchObject({ role: Role.FINANCEIRO, status: 'ATIVO' });
  });

  it('aceita o convite pelo link sem etapa separada de confirmação do e-mail', async () => {
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
    const token = inviteTokenFromUrl(inviteJson.invite.inviteUrl);

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
    expect(acceptJson).toMatchObject({ verificationEmailSent: false, verificationRequired: false, user: { email: inviteEmail, role: 'RECEPCAO', contaId, emailVerified: true } });
    const acceptedUser = await prisma.usuario.findUniqueOrThrow({ where: { email: inviteEmail } });
    expect(acceptedUser.contaId).toBeNull();
    expect(acceptedUser.emailVerifiedAt).toBeNull();
    await expect(prisma.authCredential.findUnique({
      where: { uq_auth_credential_context_user: { context: 'COLLABORATOR', userId: acceptedUser.id } },
      select: { emailVerifiedAt: true },
    })).resolves.toMatchObject({ emailVerifiedAt: expect.any(Date) });
    await expect(prisma.usuarioConta.findFirst({
      where: { contaId, usuario: { email: inviteEmail } },
      select: { role: true, status: true },
    })).resolves.toMatchObject({ role: Role.RECEPCAO, status: 'ATIVO' });
    await expect(prisma.invite.findUnique({ where: { token }, select: { status: true } }))
      .resolves.toMatchObject({ status: 'ACCEPTED' });
  });

  it('conclui submissões concorrentes do mesmo convite sem duplicar identidade ou vínculo', async () => {
    const contaId = 'invite-flow-identity-race';
    const adminEmail = 'invite-flow-identity-race-admin@example.com';
    const targetEmail = 'invite-flow-identity-race-target@example.com';
    await ensureConta(contaId, 'Corrida de identidade de convite');
    const admin = await prisma.usuario.create({
      data: {
        contaId, nome: 'Admin race de identidade', email: adminEmail,
        senhaHash: await hashPassword('Abcdef1!'), role: Role.ADMIN, status: 'ATIVO', emailVerifiedAt: new Date(),
      },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const invite = await createInvite(targetEmail, Role.RECEPCAO, admin.id, contaId);
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const payload = { token: invite.token, email: targetEmail, name: 'Identidade de teste', password: 'Aa!23456' };

    const [first, second] = await Promise.all([
      acceptPost(new Request('http://x/api/users/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })),
      acceptPost(new Request('http://x/api/users/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })),
    ]);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect([first.status, second.status], JSON.stringify([firstBody, secondBody])).toEqual([200, 200]);
    expect(firstBody).toMatchObject({ verificationEmailSent: false, verificationRequired: false, user: { email: targetEmail, contaId, emailVerified: true } });
    expect(secondBody).toMatchObject({ verificationEmailSent: false, verificationRequired: false, user: { email: targetEmail, contaId, emailVerified: true } });

    const identity = await prisma.usuario.findUniqueOrThrow({ where: { email: targetEmail } });
    expect(identity).toMatchObject({ nome: 'Identidade de teste', contaId: null, status: 'ATIVO', emailVerifiedAt: null });
    await expect(prisma.usuario.count({ where: { email: targetEmail } })).resolves.toBe(1);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id } })).resolves.toBe(1);
    await expect(prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true } })).resolves.toEqual({ status: 'ACCEPTED' });
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
      data: { contaId: contaA, nome: 'Usuário', email: 'invite-flow-reactivate-user@example.com', senhaHash: 'test', role: Role.PROFESSOR, status: 'ATIVO', emailVerifiedAt: new Date() },
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
    await acceptWithVerifiedContext(invite.token, invite.email!, target.id);

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

  it('aceita concorrência como uma única concessão e torna o retry do mesmo user idempotente', async () => {
    const contaId = 'invite-flow-race';
    await ensureConta(contaId, contaId);
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin Race', email: 'invite-flow-race-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    const target = await prisma.usuario.create({
      data: { contaId: null, nome: 'Target', email: 'invite-flow-race-target@example.com', senhaHash: 'test', role: Role.RESPONSAVEL, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const invite = await createInvite(target.email, Role.FINANCEIRO, admin.id, contaId);
    await prisma.authCredential.create({
      data: {
        context: 'COLLABORATOR', normalizedEmail: target.email.toLowerCase(), userId: target.id,
        passwordHash: 'not-used-by-service-test', emailVerifiedAt: new Date(),
      },
    });

    const results = await Promise.allSettled([
      acceptInvite(invite.token, target.email, target.id),
      acceptInvite(invite.token, target.email, target.id),
    ]);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(rejected.every((result) => result.reason instanceof InviteStateConflictError)).toBe(true);
    await expect(acceptInvite(invite.token, target.email, target.id)).resolves.toMatchObject({ id: target.id, contaId, role: Role.FINANCEIRO });
    await expect(prisma.usuarioConta.count({ where: { usuarioId: target.id, contaId } })).resolves.toBe(1);
    await expect(prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true, acceptedByUserId: true } }))
      .resolves.toEqual({ status: 'ACCEPTED', acceptedByUserId: target.id });
  });

  it('rejeita aceite se a membership do convidador foi suspensa, sem conceder ou linkar acesso', async () => {
    const contaId = 'invite-flow-accept';
    const targetEmail = 'invite-flow-new-colleague@example.com';
    await ensureConta(contaId, 'Conta de aceite');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-admin-accept@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    const identity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Colaborador', email: targetEmail, senhaHash: 'test', role: Role.RECEPCAO, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    await prisma.colaborador.create({
      data: { id: fixtureColaboradorIds[0], contaId, nome: 'Colaborador', email: targetEmail, cargo: 'RECEPCAO', status: 'ATIVO' },
    });
    const invite = await createInvite(targetEmail, Role.RECEPCAO, admin.id, contaId, {
      target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[0] },
    });
    await prisma.usuarioConta.update({ where: { usuarioId_contaId: { usuarioId: admin.id, contaId } }, data: { status: 'INATIVO' } });

    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const response = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invite.token, email: targetEmail, password: 'Aa!23456' }),
    }));
    expect(response.status).toBe(404);
    await expect(acceptWithVerifiedContext(invite.token, targetEmail, identity.id)).rejects.toBeInstanceOf(InvalidInviteError);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id, contaId } })).resolves.toBe(0);
    await expect(prisma.colaborador.findUnique({ where: { id: fixtureColaboradorIds[0] }, select: { usuarioId: true, temAcesso: true } }))
      .resolves.toEqual({ usuarioId: null, temAcesso: false });
    await expect(prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true } })).resolves.toEqual({ status: 'PENDING' });
  });

  it('rejeita aceite se Usuario do convidador está INATIVO mesmo com membership ATIVO', async () => {
    const contaId = 'invite-flow-accept';
    const targetEmail = 'invite-flow-new-colleague@example.com';
    await ensureConta(contaId, 'Conta de aceite');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-admin-accept@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    const identity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Colaborador', email: targetEmail, senhaHash: 'test', role: Role.RECEPCAO, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    await prisma.colaborador.create({
      data: { id: fixtureColaboradorIds[0], contaId, nome: 'Colaborador', email: targetEmail, cargo: 'RECEPCAO', status: 'ATIVO' },
    });
    const invite = await createInvite(targetEmail, Role.RECEPCAO, admin.id, contaId, {
      target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[0] },
    });
    await prisma.usuario.update({ where: { id: admin.id }, data: { status: 'INATIVO' } });

    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const response = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invite.token, email: targetEmail, password: 'Aa!23456' }),
    }));
    expect(response.status).toBe(404);
    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: admin.id, contaId } }, select: { status: true },
    })).resolves.toEqual({ status: 'ATIVO' });
    await expect(acceptWithVerifiedContext(invite.token, targetEmail, identity.id)).rejects.toBeInstanceOf(InvalidInviteError);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id, contaId } })).resolves.toBe(0);
    await expect(prisma.colaborador.findUnique({ where: { id: fixtureColaboradorIds[0] }, select: { usuarioId: true, temAcesso: true } }))
      .resolves.toEqual({ usuarioId: null, temAcesso: false });
    await expect(prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true } })).resolves.toEqual({ status: 'PENDING' });
  });

  it('rejeita aceite se a Conta foi desativada, sem conceder nem linkar acesso', async () => {
    const contaId = 'invite-flow-accept';
    const targetEmail = 'invite-flow-new-colleague@example.com';
    await ensureConta(contaId, 'Conta de aceite');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-admin-accept@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    const identity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Colaborador', email: targetEmail, senhaHash: 'test', role: Role.RECEPCAO, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    await prisma.colaborador.create({
      data: { id: fixtureColaboradorIds[0], contaId, nome: 'Colaborador', email: targetEmail, cargo: 'RECEPCAO', status: 'ATIVO' },
    });
    const invite = await createInvite(targetEmail, Role.RECEPCAO, admin.id, contaId, {
      target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[0] },
    });
    await prisma.conta.update({ where: { id: contaId }, data: { status: 'INATIVO' } });

    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const response = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invite.token, email: targetEmail, password: 'Aa!23456' }),
    }));
    expect(response.status).toBe(404);
    await expect(acceptWithVerifiedContext(invite.token, targetEmail, identity.id)).rejects.toBeInstanceOf(InvalidInviteError);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id, contaId } })).resolves.toBe(0);
    await expect(prisma.colaborador.findUnique({ where: { id: fixtureColaboradorIds[0] }, select: { usuarioId: true, temAcesso: true } }))
      .resolves.toEqual({ usuarioId: null, temAcesso: false });
    await expect(prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true } })).resolves.toEqual({ status: 'PENDING' });
  });

  it('expira token vencido sem membership e rejeita token revogado sem outras mutações', async () => {
    const contaId = 'invite-flow-accept';
    const targetEmail = 'invite-flow-new-colleague@example.com';
    await ensureConta(contaId, 'Conta de aceite');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-admin-accept@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    const identity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Colaborador', email: targetEmail, senhaHash: 'test', role: Role.RECEPCAO, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    await prisma.colaborador.create({
      data: { id: fixtureColaboradorIds[0], contaId, nome: 'Colaborador', email: targetEmail, cargo: 'RECEPCAO', status: 'ATIVO' },
    });
    const expired = await createInvite(targetEmail, Role.RECEPCAO, admin.id, contaId, {
      target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[0] },
    });
    await prisma.invite.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const expiredResponse = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expired.token, email: targetEmail, password: 'Aa!23456' }),
    }));
    expect(expiredResponse.status).toBe(410);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id, contaId } })).resolves.toBe(0);
    await expect(prisma.colaborador.findUnique({ where: { id: fixtureColaboradorIds[0] }, select: { usuarioId: true, temAcesso: true } }))
      .resolves.toEqual({ usuarioId: null, temAcesso: false });
    await expect(prisma.invite.findUnique({ where: { id: expired.id }, select: { status: true, acceptedByUserId: true } }))
      .resolves.toEqual({ status: 'EXPIRED', acceptedByUserId: null });

    const serviceExpiredEmail = 'invite-flow-collaborator@example.com';
    await prisma.colaborador.create({
      data: { id: fixtureColaboradorIds[1], contaId, nome: 'Outro colaborador', email: serviceExpiredEmail, cargo: 'RECEPCAO', status: 'ATIVO' },
    });
    const serviceExpired = await createInvite(serviceExpiredEmail, Role.RECEPCAO, admin.id, contaId, {
      target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[1] },
    });
    await prisma.invite.update({ where: { id: serviceExpired.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(acceptWithVerifiedContext(serviceExpired.token, serviceExpiredEmail, identity.id)).rejects.toBeInstanceOf(ExpiredInviteError);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id, contaId } })).resolves.toBe(0);
    await expect(prisma.colaborador.findUnique({ where: { id: fixtureColaboradorIds[1] }, select: { usuarioId: true, temAcesso: true } }))
      .resolves.toEqual({ usuarioId: null, temAcesso: false });
    await expect(prisma.invite.findUnique({ where: { id: serviceExpired.id }, select: { status: true, acceptedByUserId: true } }))
      .resolves.toEqual({ status: 'EXPIRED', acceptedByUserId: null });

    await prisma.invite.update({ where: { id: expired.id }, data: { status: 'REVOKED', expiresAt: new Date(Date.now() + 60_000) } });
    await expect(acceptWithVerifiedContext(expired.token, targetEmail, identity.id)).rejects.toBeInstanceOf(InvalidInviteError);
    const revokedResponse = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expired.token, email: targetEmail, password: 'Aa!23456' }),
    }));
    expect(revokedResponse.status).toBe(404);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id, contaId } })).resolves.toBe(0);
    await expect(prisma.colaborador.findUnique({ where: { id: fixtureColaboradorIds[0] }, select: { usuarioId: true, temAcesso: true } }))
      .resolves.toEqual({ usuarioId: null, temAcesso: false });
    await expect(prisma.invite.findUnique({ where: { id: expired.id }, select: { status: true, acceptedByUserId: true } }))
      .resolves.toEqual({ status: 'REVOKED', acceptedByUserId: null });
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

  it('lista convites com projeção segura sem token, metadata ou link', async () => {
    const contaId = 'invite-flow-list';
    const adminEmail = 'invite-flow-list-admin@example.com';
    await ensureConta(contaId, 'Escola listagem de convites');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: adminEmail, senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const invite = await createInvite('invite-list-target@example.test', Role.RECEPCAO, admin.id, contaId, { secret: 'not-for-list' });
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: admin.id, role: 'ADMIN', contaId },
    } as never);

    const response = await inviteGet(new Request('http://x/api/users/invite'));
    const json = await response.json();
    const listed = json.items.find((item: { id: string }) => item.id === invite.id);

    expect(response.status).toBe(200);
    expect(listed).toMatchObject({ id: invite.id, email: 'invite-list-target@example.test', status: 'PENDING' });
    expect(listed).not.toHaveProperty('token');
    expect(listed).not.toHaveProperty('metadata');
    expect(listed).not.toHaveProperty('inviteUrl');
  });

  it('cria convite para cadastro existente validado na Conta e bloqueia cadastro já ativo', async () => {
    const contaId = 'invite-flow-list';
    const adminEmail = 'invite-flow-list-admin@example.com';
    await ensureConta(contaId, 'Escola alvo de cadastro existente');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: adminEmail, senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    await prisma.colaborador.create({
      data: {
        id: fixtureColaboradorIds[0], contaId, nome: 'Funcionário existente',
        email: 'existing-record-target@example.test', cargo: 'ADMINISTRATIVO', status: 'ATIVO',
      },
    });
    await prisma.colaborador.create({
      data: {
        id: fixtureColaboradorIds[1], contaId, nome: 'Funcionário já ativo',
        email: adminEmail, usuarioId: admin.id, cargo: 'ADMINISTRATIVO', status: 'ATIVO',
      },
    });
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId } } as never);

    const created = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: {
        kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[0], role: 'RECEPCAO',
      } }),
    }));
    const createdJson = await created.json();
    const createdInvite = await prisma.invite.findUnique({ where: { token: new URL(createdJson.invite.inviteUrl).searchParams.get('token')! } });

    expect(created.status).toBe(201);
    expect(createdInvite?.email).toBe('existing-record-target@example.test');
    expect(createdInvite?.metadata).toEqual({
      target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[0] },
    });

    const activeTarget = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: {
        kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[1], role: 'RECEPCAO',
      } }),
    }));
    expect(activeTarget.status).toBe(409);
  });

  it('adapta seleção legada para um responsável único e cria convite sem email nem envio', async () => {
    const contaId = 'invite-flow-responsible-target';
    await ensureConta(contaId, 'Conta alvo responsável');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-responsible-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const student = await prisma.aluno.create({
      data: { id: fixtureStudentIds[0], contaId, nome: 'Aluno vinculado', dataNasc: new Date('2015-01-01T00:00:00.000Z') },
    });
    await prisma.responsavel.create({
      data: { id: fixtureResponsavelIds[0], contaId, nome: 'Responsável sem e-mail', cpf: '52998224725', email: '   ', telefone: '11999999999' },
    });
    await prisma.alunoResponsavel.create({
      data: { contaId, alunoId: student.id, responsavelId: fixtureResponsavelIds[0], tipoVinculo: 'RESPONSAVEL' },
    });
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId } } as never);

    const response = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'RESPONSAVEL', alunosIds: [student.id] }),
    }));
    const json = await response.json();
    const token = new URL(json.invite.inviteUrl).searchParams.get('token');
    const stored = await prisma.invite.findUnique({ where: { token: token! } });

    expect(response.status).toBe(201);
    expect(json.emailDelivery).toBe('not_applicable');
    expect(json.invite.email).toBeNull();
    expect(stored?.email).toBeNull();
    expect(stored?.metadata).toEqual({
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: fixtureResponsavelIds[0] },
      alunosIds: [student.id],
    });

    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const firstAcceptance = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email: 'guardian.identity@example.com', name: 'Responsável', password: 'Aa!23456' }),
    }));
    const firstJson = await firstAcceptance.json();
    expect(firstAcceptance.status, JSON.stringify(firstJson)).toBe(200);
    expect(firstJson).toMatchObject({ verificationRequired: false, user: { email: 'guardian.identity@example.com', contaId, emailVerified: true } });
    const identity = await prisma.usuario.findUniqueOrThrow({ where: { email: 'guardian.identity@example.com' } });
    expect(identity.contaId).toBeNull();
    expect(identity.emailVerifiedAt).toBeNull();
    await expect(prisma.authCredential.findUnique({
      where: { uq_auth_credential_context_user: { context: 'PORTAL', userId: identity.id } },
      select: { emailVerifiedAt: true },
    })).resolves.toMatchObject({ emailVerifiedAt: expect.any(Date) });
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id } })).resolves.toBe(1);
    await expect(prisma.responsavel.findUnique({ where: { id: fixtureResponsavelIds[0] }, select: { usuarioId: true } })).resolves.toEqual({ usuarioId: identity.id });
    await expect(prisma.alunoResponsavel.count({ where: { contaId, alunoId: student.id, responsavelId: fixtureResponsavelIds[0] } })).resolves.toBe(1);
    await expect(prisma.invite.findUnique({ where: { token: token! }, select: { status: true } })).resolves.toEqual({ status: 'ACCEPTED' });
    await expect(prisma.usuarioConta.findUnique({ where: { usuarioId_contaId: { usuarioId: identity.id, contaId } }, select: { role: true, status: true } }))
      .resolves.toEqual({ role: Role.RESPONSAVEL, status: 'ATIVO' });
    const replay = await acceptPost(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email: 'guardian.identity@example.com', password: 'Aa!23456' }),
    }));
    expect(replay.status).toBe(200);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id, contaId } })).resolves.toBe(1);
    await expect(prisma.alunoResponsavel.count({ where: { contaId, alunoId: student.id, responsavelId: fixtureResponsavelIds[0] } })).resolves.toBe(1);
  });

  it('permite novo convite e aceite após remover o vínculo da identidade anterior sem perder perfil ou aluno', async () => {
    const contaId = 'invite-flow-responsible-target';
    await ensureConta(contaId, 'Conta alvo responsável');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-responsible-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const student = await prisma.aluno.create({
      data: { id: fixtureStudentIds[0], contaId, nome: 'Aluno preservado', dataNasc: new Date('2015-01-01T00:00:00.000Z') },
    });
    const originalIdentity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Identidade anterior', email: 'guardian.identity@example.com', senhaHash: 'test', role: Role.RESPONSAVEL, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    const guardian = await prisma.responsavel.create({
      data: { id: fixtureResponsavelIds[0], contaId, nome: 'Responsável preservado', cpf: '52998224725', email: 'guardian-profile@example.test', telefone: '11999999999', usuarioId: originalIdentity.id },
    });
    await prisma.alunoResponsavel.create({
      data: { contaId, alunoId: student.id, responsavelId: guardian.id, tipoVinculo: 'RESPONSAVEL' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: originalIdentity.id, contaId, role: Role.RESPONSAVEL, status: 'ATIVO' } });

    await expect(removeManagedUserAccess({ userId: originalIdentity.id, contaId, actorId: admin.id }))
      .resolves.toMatchObject({ id: originalIdentity.id, hard: true });
    await expect(prisma.responsavel.findUnique({ where: { id: guardian.id }, select: { usuarioId: true, nome: true, email: true } }))
      .resolves.toEqual({ usuarioId: null, nome: 'Responsável preservado', email: 'guardian-profile@example.test' });
    await expect(prisma.aluno.findUnique({ where: { id: student.id }, select: { id: true, nome: true } }))
      .resolves.toEqual({ id: student.id, nome: 'Aluno preservado' });
    await expect(prisma.alunoResponsavel.count({ where: { contaId, alunoId: student.id, responsavelId: guardian.id } })).resolves.toBe(1);

    const replacementIdentity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Nova identidade', email: 'guardian.new-identity@example.com', senhaHash: 'test', role: Role.RESPONSAVEL, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    const invite = await createInvite(replacementIdentity.email, Role.RESPONSAVEL, admin.id, contaId, {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: guardian.id },
      alunosIds: [student.id],
    });

    await expect(acceptWithVerifiedContext(invite.token, replacementIdentity.email, replacementIdentity.id))
      .resolves.toMatchObject({ id: replacementIdentity.id, contaId, role: Role.RESPONSAVEL });
    await expect(prisma.responsavel.findUnique({ where: { id: guardian.id }, select: { usuarioId: true } }))
      .resolves.toEqual({ usuarioId: replacementIdentity.id });
    await expect(prisma.aluno.findUnique({ where: { id: student.id }, select: { id: true } })).resolves.toEqual({ id: student.id });
    await expect(prisma.alunoResponsavel.count({ where: { contaId, alunoId: student.id, responsavelId: guardian.id } })).resolves.toBe(1);
    await expect(prisma.usuarioConta.findUnique({ where: { usuarioId_contaId: { usuarioId: replacementIdentity.id, contaId } }, select: { role: true, status: true } }))
      .resolves.toEqual({ role: Role.RESPONSAVEL, status: 'ATIVO' });
  });

  it('aceita identidade substituta quando o perfil aponta para identidade sem membership nesta conta', async () => {
    const { contaId, guardian, student, replacementIdentity, invite } = await createStaleGuardianInviteFixture();

    await expect(prisma.usuarioConta.count({ where: { contaId } })).resolves.toBe(1);
    await expect(acceptWithVerifiedContext(invite.token, replacementIdentity.email, replacementIdentity.id))
      .resolves.toMatchObject({ id: replacementIdentity.id, contaId, role: Role.RESPONSAVEL });
    await expect(prisma.responsavel.findUnique({ where: { id: guardian.id }, select: { usuarioId: true } }))
      .resolves.toEqual({ usuarioId: replacementIdentity.id });
    await expect(prisma.aluno.findUnique({ where: { id: student.id }, select: { id: true } })).resolves.toEqual({ id: student.id });
    await expect(prisma.alunoResponsavel.count({ where: { contaId, alunoId: student.id, responsavelId: guardian.id } })).resolves.toBe(1);
  });

  it.each(['ATIVO', 'INATIVO'] as const)('bloqueia substituição quando a identidade anterior ainda tem membership %s na conta', async (status) => {
    const { contaId, guardian, previousIdentity, replacementIdentity, invite } = await createStaleGuardianInviteFixture(status);

    await expect(acceptWithVerifiedContext(invite.token, replacementIdentity.email, replacementIdentity.id))
      .rejects.toBeInstanceOf(GuardianProfileConflictError);
    await expect(prisma.responsavel.findUnique({ where: { id: guardian.id }, select: { usuarioId: true } }))
      .resolves.toEqual({ usuarioId: previousIdentity.id });
    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: previousIdentity.id, contaId } }, select: { status: true },
    })).resolves.toEqual({ status });
  });

  it('nega aceite quando metadata do convite A aponta para responsável e aluno de B', async () => {
    const contaA = 'invite-flow-responsible-target';
    const contaB = 'invite-flow-responsible-foreign';
    await Promise.all([ensureConta(contaA, 'Conta A'), ensureConta(contaB, 'Conta B')]);
    const admin = await prisma.usuario.create({
      data: { contaId: contaA, nome: 'Admin A', email: 'invite-flow-responsible-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId: contaA, role: Role.ADMIN, status: 'ATIVO' } });
    const identity = await prisma.usuario.create({
      data: { contaId: null, nome: 'Responsável', email: 'guardian.foreign@example.com', senhaHash: 'test', role: Role.RESPONSAVEL, status: 'ATIVO', emailVerifiedAt: new Date() },
    });
    const student = await prisma.aluno.create({
      data: { id: fixtureStudentIds[1], contaId: contaB, nome: 'Aluno B', dataNasc: new Date('2015-01-01T00:00:00.000Z') },
    });
    await prisma.responsavel.create({
      data: { id: fixtureResponsavelIds[1], contaId: contaB, nome: 'Responsável B', cpf: '11144477735', email: 'responsavel-b@example.com', telefone: '11999999998' },
    });
    await prisma.alunoResponsavel.create({
      data: { contaId: contaB, alunoId: student.id, responsavelId: fixtureResponsavelIds[1], tipoVinculo: 'RESPONSAVEL' },
    });
    const invite = await prisma.invite.create({
      data: {
        contaId: contaA, role: Role.RESPONSAVEL, email: null, token: randomUUID(), invitedById: admin.id,
        status: 'PENDING', expiresAt: new Date(Date.now() + 60_000),
        metadata: { target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: fixtureResponsavelIds[1] }, alunosIds: [student.id] },
      },
    });

    await expect(acceptWithVerifiedContext(invite.token, identity.email, identity.id)).rejects.toBeInstanceOf(InvalidInviteTargetError);
    await expect(prisma.usuarioConta.count({ where: { usuarioId: identity.id } })).resolves.toBe(0);
    await expect(prisma.responsavel.findUnique({ where: { id: fixtureResponsavelIds[1] }, select: { usuarioId: true } })).resolves.toEqual({ usuarioId: null });
    await expect(prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true } })).resolves.toEqual({ status: 'PENDING' });
  });

  it('responde 404 sem mutações para seleção legada com alunos de outra escola, isolados ou mistos', async () => {
    const contaA = 'invite-flow-responsible-target';
    const contaB = 'invite-flow-responsible-foreign';
    await Promise.all([ensureConta(contaA, 'Conta A'), ensureConta(contaB, 'Conta B')]);
    const admin = await prisma.usuario.create({
      data: { contaId: contaA, nome: 'Admin A', email: 'invite-flow-responsible-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId: contaA, role: Role.ADMIN, status: 'ATIVO' } });
    const [studentA, studentB] = await Promise.all([
      prisma.aluno.create({ data: { id: fixtureStudentIds[0], contaId: contaA, nome: 'Aluno A', dataNasc: new Date('2015-01-01T00:00:00.000Z') } }),
      prisma.aluno.create({ data: { id: fixtureStudentIds[1], contaId: contaB, nome: 'Aluno B', dataNasc: new Date('2015-01-01T00:00:00.000Z') } }),
    ]);
    await Promise.all([
      prisma.responsavel.create({ data: { id: fixtureResponsavelIds[0], conta: { connect: { id: contaA } }, nome: 'Responsável A', cpf: '52998224725', email: '   ', telefone: '11999999999' } }),
      prisma.responsavel.create({ data: { id: fixtureResponsavelIds[1], conta: { connect: { id: contaB } }, nome: 'Responsável B', cpf: '11144477735', email: '   ', telefone: '11999999998' } }),
    ]);
    await Promise.all([
      prisma.alunoResponsavel.create({ data: { contaId: contaA, alunoId: studentA.id, responsavelId: fixtureResponsavelIds[0], tipoVinculo: 'RESPONSAVEL' } }),
      prisma.alunoResponsavel.create({ data: { contaId: contaB, alunoId: studentB.id, responsavelId: fixtureResponsavelIds[1], tipoVinculo: 'RESPONSAVEL' } }),
    ]);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId: contaA } } as never);

    const postLegacySelection = (alunosIds: string[]) => invitePost(new Request('http://x/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'RESPONSAVEL', alunosIds }),
    }));
    const foreignOnly = await postLegacySelection([studentB.id]);
    const mixed = await postLegacySelection([studentA.id, studentB.id]);

    expect(foreignOnly.status).toBe(404);
    expect(mixed.status).toBe(404);
    expect(await foreignOnly.json()).toEqual(await mixed.json());
    await expect(prisma.invite.count({ where: { contaId: contaA } })).resolves.toBe(0);
    await expect(prisma.responsavel.findMany({ where: { id: { in: fixtureResponsavelIds } }, select: { id: true, usuarioId: true } }))
      .resolves.toEqual(expect.arrayContaining([
        { id: fixtureResponsavelIds[0], usuarioId: null },
        { id: fixtureResponsavelIds[1], usuarioId: null },
      ]));
    await expect(prisma.usuarioConta.count({ where: { usuarioId: admin.id, contaId: contaB } })).resolves.toBe(0);
  });

  it('recusa recordId de outra escola sem criar convite', async () => {
    const contaA = 'invite-flow-list';
    const contaB = 'invite-flow-record-foreign';
    await Promise.all([ensureConta(contaA, 'Conta A'), ensureConta(contaB, 'Conta B')]);
    const admin = await prisma.usuario.create({
      data: { contaId: contaA, nome: 'Admin A', email: 'invite-flow-list-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId: contaA, role: Role.ADMIN, status: 'ATIVO' } });
    await prisma.colaborador.create({
      data: { id: fixtureColaboradorIds[2], contaId: contaB, nome: 'Cadastro B', email: 'foreign-record@example.test', cargo: 'ADMINISTRATIVO' },
    });
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId: contaA } } as never);

    const response = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: {
        kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[2], role: 'RECEPCAO',
      } }),
    }));

    expect(response.status).toBe(404);
    await expect(prisma.invite.count({ where: { contaId: contaA } })).resolves.toBe(0);
  });

  it('mapeia identity global inativa para 409 ao convidar cadastro vinculado', async () => {
    const contaId = 'invite-flow-inactive-target';
    await ensureConta(contaId, 'Conta com usuário inativo');
    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin', email: 'invite-flow-inactive-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    const inactiveUser = await prisma.usuario.create({
      data: { contaId, nome: 'Inativo', email: 'invite-flow-inactive-target@example.com', senhaHash: 'test', role: Role.RECEPCAO, status: 'INATIVO' },
    });
    await prisma.usuarioConta.createMany({ data: [admin, inactiveUser].map((user) => ({ usuarioId: user.id, contaId, role: user.role, status: user.id === inactiveUser.id ? 'INATIVO' as const : 'ATIVO' as const })) });
    await prisma.colaborador.create({
      data: { id: fixtureColaboradorIds[3], contaId, nome: 'Perfil vinculado', email: inactiveUser.email, usuarioId: inactiveUser.id, cargo: 'ADMINISTRATIVO' },
    });
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId } } as never);

    const response = await invitePost(new Request('http://x/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: {
        kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixtureColaboradorIds[3], role: 'RECEPCAO',
      } }),
    }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe('ACCOUNT_INACTIVE');
  });

  it('revoga o convite somente dentro da conta solicitada e preserva seu histórico', async () => {
    const contaId = 'invite-flow-delete';
    const outraContaId = 'invite-flow-delete-other';
    await Promise.all([
      ensureConta(contaId, 'Conta com convite'),
      ensureConta(outraContaId, 'Outra conta'),
    ]);

    const admin = await prisma.usuario.create({
      data: { contaId, nome: 'Admin revoke', email: 'invite-flow-delete-admin@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const invite = await createInvite('invite-flow-delete-target@example.com', Role.RECEPCAO, admin.id, contaId);

    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId: outraContaId } } as never);
    const crossTenant = await inviteDelete(new Request(`http://x/api/users/invite/${invite.id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: invite.id }) });
    expect(crossTenant.status).toBe(404);
    await expect(prisma.invite.findUnique({ where: { id: invite.id } })).resolves.not.toBeNull();

    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId } } as never);
    const revoked = await inviteDelete(new Request(`http://x/api/users/invite/${invite.id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: invite.id }) });
    expect(revoked.status).toBe(200);
    await expect(prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true, revokedAt: true } }))
      .resolves.toMatchObject({ status: 'REVOKED', revokedAt: expect.any(Date) });
    await expect(revokeInviteById(invite.id, contaId, admin.id)).resolves.toBe('REVOKED');
  });

  it('reenvia com ledger idempotente, limita nova tentativa e impede recuperação entre contas', async () => {
    const contaA = 'invite-flow-resend-a';
    const contaB = 'invite-flow-resend-b';
    await Promise.all([ensureConta(contaA, 'Escola A'), ensureConta(contaB, 'Escola B')]);
    const [adminA, adminB] = await Promise.all([
      prisma.usuario.create({ data: { contaId: contaA, nome: 'Admin A', email: 'invite-flow-resend-admin-a@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' } }),
      prisma.usuario.create({ data: { contaId: contaB, nome: 'Admin B', email: 'invite-flow-resend-admin-b@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' } }),
    ]);
    await prisma.usuarioConta.createMany({ data: [
      { usuarioId: adminA.id, contaId: contaA, role: Role.ADMIN, status: 'ATIVO' },
      { usuarioId: adminB.id, contaId: contaB, role: Role.ADMIN, status: 'ATIVO' },
    ] });
    const inviteA = await createInvite('resend-target-a@example.com', Role.RECEPCAO, adminA.id, contaA);
    const inviteB = await createInvite('resend-target-b@example.com', Role.RECEPCAO, adminB.id, contaB);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: adminA.id, role: 'ADMIN', contaId: contaA, name: 'Admin A' } } as never);

    const postResend = (id: string, key: string) => inviteResend(
      new Request(`http://x/api/users/invite/${id}`, { method: 'POST', headers: { 'Idempotency-Key': key } }),
      { params: Promise.resolve({ id }) },
    );
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: adminA.id, role: 'RECEPCAO', contaId: contaA } } as never);
    expect((await postResend(inviteA.id, 'request-key-denied-01')).status).toBe(403);
    await expect(prisma.inviteResendRequest.count({ where: { inviteId: inviteA.id } })).resolves.toBe(0);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: adminA.id, role: 'ADMIN', contaId: contaA, name: 'Admin A' } } as never);
    let finishDelivery!: (_value: Awaited<ReturnType<typeof sendInviteEmail>>) => void;
    const deliveryPromise = new Promise<Awaited<ReturnType<typeof sendInviteEmail>>>((resolve) => { finishDelivery = resolve; });
    vi.mocked(sendInviteEmail).mockImplementationOnce(() => deliveryPromise);
    const firstPromise = postResend(inviteA.id, 'request-key-a-0001');
    for (let attempt = 0; attempt < 30 && vi.mocked(sendInviteEmail).mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledTimes(1);
    const concurrent = await postResend(inviteA.id, 'request-key-a-0001');
    const inFlightRevoke = await inviteDelete(
      new Request(`http://x/api/users/invite/${inviteA.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: inviteA.id }) },
    );
    expect(inFlightRevoke.status).toBe(409);
    expect(await inFlightRevoke.json()).toMatchObject({ code: 'DELIVERY_IN_PROGRESS' });
    await expect(prisma.invite.findUnique({ where: { id: inviteA.id }, select: { status: true } })).resolves.toEqual({ status: 'PENDING' });
    expect((await postResend(inviteA.id, 'request-key-a-other')).status).toBe(429);
    expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledTimes(1);
    finishDelivery({ delivery: 'sent', emailId: 'provider-email-id' });
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(concurrent.status).toBe(200);
    const firstBody = await first.json();
    const concurrentBody = await concurrent.json();
    expect(firstBody).toMatchObject({ ok: true });
    expect(firstBody).toMatchObject({ deliveryStatus: 'SENT' });
    expect(concurrentBody).toMatchObject({ ok: true, deliveryStatus: 'PENDING', replayed: true });
    expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendInviteEmail).mock.calls[0]?.[0].idempotencyKey).toContain(`/resend/`);

    const replay = await postResend(inviteA.id, 'request-key-a-0001');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ deliveryStatus: 'SENT', replayed: true });
    expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledTimes(1);

    const cooldown = await postResend(inviteA.id, 'request-key-a-0002');
    expect(cooldown.status).toBe(429);
    const foreign = await postResend(inviteB.id, 'request-key-b-0001');
    expect(foreign.status).toBe(404);
    expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledTimes(1);
    await expect(prisma.invite.findUnique({ where: { id: inviteB.id }, select: { status: true, deliveryAttempts: true } }))
      .resolves.toEqual({ status: 'PENDING', deliveryAttempts: 0 });
    await expect(prisma.inviteResendRequest.count({ where: { inviteId: inviteA.id } })).resolves.toBe(1);
    await expect(prisma.inviteResendRequest.findFirst({ where: { inviteId: inviteA.id }, select: { status: true, requestKeyFingerprint: true } }))
      .resolves.toMatchObject({ status: 'SENT', requestKeyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const revokedAfterDelivery = await inviteDelete(
      new Request(`http://x/api/users/invite/${inviteA.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: inviteA.id }) },
    );
    expect(revokedAfterDelivery.status).toBe(200);
    await expect(prisma.invite.findUnique({ where: { id: inviteA.id }, select: { status: true, emailDeliveryStatus: true } }))
      .resolves.toEqual({ status: 'REVOKED', emailDeliveryStatus: 'SENT' });
  });

  it('marca falha de envio sem consumir convite e recupera link manual sem enviar email', async () => {
    const contaId = 'invite-flow-resend-a';
    await ensureConta(contaId, 'Escola A');
    const admin = await prisma.usuario.create({ data: { contaId, nome: 'Admin', email: 'invite-flow-resend-admin-a@example.com', senhaHash: 'test', role: Role.ADMIN, status: 'ATIVO' } });
    await prisma.usuarioConta.create({ data: { usuarioId: admin.id, contaId, role: Role.ADMIN, status: 'ATIVO' } });
    const emailInvite = await createInvite('resend-failure@example.com', Role.RECEPCAO, admin.id, contaId);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id, role: 'ADMIN', contaId } } as never);
    vi.mocked(sendInviteEmail).mockRejectedValueOnce(new Error('provider detail with secret URL'));
    const request = (inviteId: string, key: string) => inviteResend(
      new Request(`http://x/api/users/invite/${inviteId}`, { method: 'POST', headers: { 'Idempotency-Key': key } }),
      { params: Promise.resolve({ id: inviteId }) },
    );

    const failed = await request(emailInvite.id, 'request-key-fail-001');
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ deliveryStatus: 'FAILED', deliveryErrorCode: 'DELIVERY_FAILED' });
    await expect(prisma.invite.findUnique({ where: { id: emailInvite.id }, select: { status: true, emailDeliveryStatus: true } }))
      .resolves.toEqual({ status: 'PENDING', emailDeliveryStatus: 'FAILED' });

    const manualInvite = await createInvite(null, Role.RESPONSAVEL, admin.id, contaId, { alunosIds: ['manual-student-id'] });
    vi.mocked(sendInviteEmail).mockClear();
    const manual = await request(manualInvite.id, 'request-key-manual-01');
    expect(manual.status).toBe(200);
    const manualBody = await manual.json();
    expect(manualBody).toMatchObject({ deliveryStatus: 'NOT_APPLICABLE', replayed: false });
    expect(new URL(manualBody.inviteUrl).searchParams.get('token')).toBe(manualInvite.token);
    expect(vi.mocked(sendInviteEmail)).not.toHaveBeenCalled();

    await prisma.invite.update({ where: { id: emailInvite.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    const expired = await request(emailInvite.id, 'request-key-expired-1');
    expect(expired.status).toBe(410);
    await expect(prisma.invite.findUnique({ where: { id: emailInvite.id }, select: { status: true } })).resolves.toEqual({ status: 'EXPIRED' });

    const revokedInvite = await createInvite('resend-revoked@example.com', Role.RECEPCAO, admin.id, contaId);
    await prisma.invite.update({ where: { id: revokedInvite.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    expect((await request(revokedInvite.id, 'request-key-revoked-1')).status).toBe(409);
    const acceptedInvite = await createInvite('resend-accepted@example.com', Role.RECEPCAO, admin.id, contaId);
    await prisma.invite.update({ where: { id: acceptedInvite.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    expect((await request(acceptedInvite.id, 'request-key-accepted-1')).status).toBe(409);

    const staleInvite = await createInvite('resend-stale@example.com', Role.RECEPCAO, admin.id, contaId);
    const staleReservation = await reserveInviteResend({
      id: staleInvite.id, contaId, actorUserId: admin.id, idempotencyKey: 'request-key-stale-01',
    });
    expect(staleReservation.kind).toBe('RESERVED');
    if (staleReservation.kind !== 'RESERVED') throw new Error('Esperava reserva de email para o caso de lease expirado.');
    await prisma.inviteResendRequest.update({
      where: { id: staleReservation.attemptId },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    });
    await prisma.invite.update({ where: { id: staleInvite.id }, data: { resendAvailableAt: new Date(Date.now() - 1) } });
    const staleLeaseRevoke = await inviteDelete(
      new Request(`http://x/api/users/invite/${staleInvite.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: staleInvite.id }) },
    );
    expect(staleLeaseRevoke.status).toBe(200);
    await expect(prisma.invite.findUnique({ where: { id: staleInvite.id }, select: { status: true, emailDeliveryStatus: true } }))
      .resolves.toEqual({ status: 'REVOKED', emailDeliveryStatus: 'FAILED' });
    await expect(prisma.inviteResendRequest.findUnique({ where: { id: staleReservation.attemptId }, select: { status: true, deliveryErrorCode: true, leaseExpiresAt: true } }))
      .resolves.toEqual({ status: 'FAILED', deliveryErrorCode: 'DELIVERY_TIMEOUT', leaseExpiresAt: null });
    await expect(completeInviteResend({
      inviteId: staleInvite.id, contaId, attemptId: staleReservation.attemptId,
      leaseExpiresAt: staleReservation.leaseExpiresAt, delivery: 'SENT',
    })).resolves.toBe(false);

    const recoveryInvite = await createInvite('resend-recovery@example.com', Role.RECEPCAO, admin.id, contaId);
    const firstAttempt = await reserveInviteResend({
      id: recoveryInvite.id, contaId, actorUserId: admin.id, idempotencyKey: 'request-key-recovery-old',
    });
    if (firstAttempt.kind !== 'RESERVED') throw new Error('Esperava a primeira tentativa de reenvio.');
    await prisma.inviteResendRequest.update({ where: { id: firstAttempt.attemptId }, data: { leaseExpiresAt: new Date(Date.now() - 1) } });
    await prisma.invite.update({ where: { id: recoveryInvite.id }, data: { resendAvailableAt: new Date(Date.now() - 1) } });
    const secondAttempt = await reserveInviteResend({
      id: recoveryInvite.id, contaId, actorUserId: admin.id, idempotencyKey: 'request-key-recovery-new',
    });
    if (secondAttempt.kind !== 'RESERVED') throw new Error('Esperava nova tentativa após expiração do lease.');
    await expect(prisma.inviteResendRequest.findUnique({ where: { id: firstAttempt.attemptId }, select: { status: true, deliveryErrorCode: true } }))
      .resolves.toEqual({ status: 'FAILED', deliveryErrorCode: 'DELIVERY_TIMEOUT' });
    await expect(completeInviteResend({
      inviteId: recoveryInvite.id, contaId, attemptId: secondAttempt.attemptId,
      leaseExpiresAt: secondAttempt.leaseExpiresAt, delivery: 'LOGGED',
    })).resolves.toBe(true);
    await expect(prisma.invite.findUnique({ where: { id: recoveryInvite.id }, select: { deliveryAttempts: true, emailDeliveryStatus: true } }))
      .resolves.toEqual({ deliveryAttempts: 2, emailDeliveryStatus: 'LOGGED' });
  });
});
