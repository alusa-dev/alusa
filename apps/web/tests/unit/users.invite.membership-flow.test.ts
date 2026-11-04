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
import { GET as inviteGet, POST as invitePost } from '@/app/api/users/invite/route';
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
  ];
  const fixtureColaboradorIds = ['invite-flow-existing-record-collaborator', 'invite-flow-active-collaborator', 'invite-flow-foreign-collaborator', 'invite-flow-inactive-collaborator'];
  const fixtureResponsavelIds = ['invite-flow-responsavel-record', 'invite-flow-responsavel-foreign-record'];
  const fixtureStudentIds = ['invite-flow-responsavel-student', 'invite-flow-responsavel-foreign-student'];

  async function cleanupFixtures() {
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
