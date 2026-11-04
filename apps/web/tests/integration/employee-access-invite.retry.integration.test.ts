import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';
import prisma from '@/lib/prisma';

const { sendInviteEmailMock } = vi.hoisted(() => ({ sendInviteEmailMock: vi.fn() }));
vi.mock('@/lib/auth-email-flow', () => ({ sendInviteEmail: sendInviteEmailMock }));

import { getInviteBaseUrl } from '@/lib/app-url';
import { inviteEmployeeAccess } from '@/src/server/employees/employee-access-invite.service';
import { createInvite } from '@alusa/lib/server/services/invite-user-service';

const fixture = {
  a: {
    contaId: 'employee-access-retry-contract-school-a',
    userEmail: 'employee-access-retry-admin-a@example.test',
    colaboradorId: 'employee-access-retry-target-a',
    colaboradorEmail: 'employee-access-retry-target-a@example.test',
  },
  b: {
    contaId: 'employee-access-retry-contract-school-b',
    userEmail: 'employee-access-retry-admin-b@example.test',
    colaboradorId: 'employee-access-retry-target-b',
    colaboradorEmail: 'employee-access-retry-target-b@example.test',
  },
};

async function ensureTenantFixture(scope: typeof fixture.a | typeof fixture.b) {
  await prisma.conta.upsert({
    where: { id: scope.contaId },
    update: { nome: 'Invite retry contract school', status: 'ATIVO', deletedAt: null },
    create: { id: scope.contaId, nome: 'Invite retry contract school', status: 'ATIVO' },
  });
  const admin = await prisma.usuario.upsert({
    where: { email: scope.userEmail },
    update: { nome: 'Invite Retry Admin', status: 'ATIVO', role: Role.ADMIN, contaId: scope.contaId },
    create: {
      contaId: scope.contaId,
      nome: 'Invite Retry Admin',
      email: scope.userEmail,
      senhaHash: 'test-only-hash',
      role: Role.ADMIN,
      status: 'ATIVO',
    },
    select: { id: true },
  });
  await prisma.usuarioConta.upsert({
    where: { usuarioId_contaId: { usuarioId: admin.id, contaId: scope.contaId } },
    update: { role: Role.ADMIN, status: 'ATIVO' },
    create: { usuarioId: admin.id, contaId: scope.contaId, role: Role.ADMIN, status: 'ATIVO' },
  });
  await prisma.colaborador.upsert({
    where: { id: scope.colaboradorId },
    update: {
      contaId: scope.contaId,
      nome: 'Invite Retry Colaborador',
      email: scope.colaboradorEmail,
      cargo: 'RECEPCAO',
      status: 'ATIVO',
      temAcesso: true,
      usuarioId: null,
    },
    create: {
      id: scope.colaboradorId,
      contaId: scope.contaId,
      nome: 'Invite Retry Colaborador',
      email: scope.colaboradorEmail,
      cargo: 'RECEPCAO',
      status: 'ATIVO',
      temAcesso: true,
    },
  });
}

async function cleanupFixtureChildren() {
  for (const scope of [fixture.a, fixture.b]) {
    await prisma.invite.deleteMany({
      where: {
        contaId: scope.contaId,
        metadata: { path: ['target', 'recordId'], equals: scope.colaboradorId },
      },
    });
    await prisma.colaborador.deleteMany({ where: { id: scope.colaboradorId, contaId: scope.contaId } });
    await prisma.usuarioConta.deleteMany({ where: { contaId: scope.contaId, usuario: { email: scope.userEmail } } });
    await prisma.usuario.deleteMany({ where: { email: scope.userEmail } });
  }
}

describe('employee invite retry with database persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupFixtureChildren();
    await Promise.all([ensureTenantFixture(fixture.a), ensureTenantFixture(fixture.b)]);
  });

  afterEach(async () => {
    await cleanupFixtureChildren();
  });

  it('persists one invite and returns its same token link after email delivery failure', async () => {
    sendInviteEmailMock.mockResolvedValueOnce({ delivery: 'failed' });
    const input = {
      contaId: fixture.a.contaId,
      invitedById: (await prisma.usuario.findUniqueOrThrow({ where: { email: fixture.a.userEmail }, select: { id: true } })).id,
      recordId: fixture.a.colaboradorId,
      email: fixture.a.colaboradorEmail,
      role: 'RECEPCAO' as const,
    };

    const first = await inviteEmployeeAccess(input);
    const createdRows = await prisma.invite.findMany({
      where: { contaId: fixture.a.contaId, email: fixture.a.colaboradorEmail },
      select: { id: true, token: true, role: true, status: true, metadata: true },
    });
    const retry = await inviteEmployeeAccess(input);
    const rowsAfterRetry = await prisma.invite.findMany({
      where: { contaId: fixture.a.contaId, email: fixture.a.colaboradorEmail },
      select: { id: true, token: true, role: true, status: true, metadata: true },
    });
    const expectedLink = new URL('/auth/register', `${getInviteBaseUrl()}/`);
    expectedLink.searchParams.set('token', createdRows[0]?.token ?? '');

    expect(first.status).toBe('failed');
    expect(first.inviteUrl).toBe(expectedLink.toString());
    expect(retry).toMatchObject({ status: 'pending', inviteUrl: expectedLink.toString() });
    expect(rowsAfterRetry).toHaveLength(1);
    expect(rowsAfterRetry[0]).toMatchObject({
      id: createdRows[0]?.id,
      token: createdRows[0]?.token,
      role: Role.RECEPCAO,
      status: 'PENDING',
      metadata: { target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixture.a.colaboradorId } },
    });
    expect(sendInviteEmailMock).toHaveBeenCalledTimes(1);
  });

  it('does not reveal or mutate tenant B invite when helper is called in tenant A', async () => {
    const adminB = await prisma.usuario.findUniqueOrThrow({
      where: { email: fixture.b.userEmail },
      select: { id: true },
    });
    const inviteB = await createInvite(
      fixture.b.colaboradorEmail,
      Role.RECEPCAO,
      adminB.id,
      fixture.b.contaId,
      { target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixture.b.colaboradorId } },
    );

    const result = await inviteEmployeeAccess({
      contaId: fixture.a.contaId,
      invitedById: (await prisma.usuario.findUniqueOrThrow({
        where: { email: fixture.a.userEmail }, select: { id: true },
      })).id,
      recordId: fixture.b.colaboradorId,
      email: fixture.b.colaboradorEmail,
      role: 'RECEPCAO',
    });
    const inviteBAfter = await prisma.invite.findUniqueOrThrow({ where: { id: inviteB.id } });

    expect(result.status).toBe('failed');
    expect(result.inviteUrl).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(inviteB.token);
    expect(inviteBAfter).toMatchObject({
      id: inviteB.id,
      token: inviteB.token,
      contaId: fixture.b.contaId,
      status: 'PENDING',
      role: Role.RECEPCAO,
      metadata: { target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: fixture.b.colaboradorId } },
    });
    expect(sendInviteEmailMock).not.toHaveBeenCalled();
  });
});
