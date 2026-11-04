import { expect, test, type Page } from '@playwright/test';
import { PrismaClient, Role } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import { randomUUID } from 'node:crypto';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import { resetDb } from './utils/reset-db';
import { seedAdminAndAuthenticate } from './utils/auth';

const prisma = new PrismaClient();

async function createStudent(contaId: string, name: string) {
  return prisma.aluno.create({
    data: { contaId, nome: name, dataNasc: new Date('2015-01-01T12:00:00.000Z'), status: 'ATIVO' },
    select: { id: true },
  });
}

async function useAccountSession(page: Page, user: { id: string; email: string; name: string; role: Role; contaId: string }) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente no ambiente de teste');
  const token = await encode({
    secret,
    token: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      contaId: user.contaId,
      emailVerified: true,
      accountActive: true,
      sessionVersion: 0,
    },
  });
  await page.context().addCookies([{
    name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }]);
  await page.goto('/api/auth/session');
}

async function postJson(page: Page, path: string, body: unknown) {
  const response = await page.request.post(new URL(path, page.url()).toString(), { data: body });
  return { response, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

function inviteTokenFrom(body: Record<string, unknown>) {
  const invite = body.invite as { inviteUrl?: string } | undefined;
  if (!invite?.inviteUrl) throw new Error('Resposta não contém link do convite');
  const token = new URL(invite.inviteUrl).searchParams.get('token');
  if (!token) throw new Error('Link do convite não contém token');
  return token;
}

test.describe('convite de responsável — aceite e isolamento multi-tenant', () => {
  test.beforeEach(async () => resetDb(prisma));

  test('cartão de aceite autenticado fica centralizado na viewport', async ({ browser, page }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const student = await createStudent(schoolA.contaId, 'Aluno para aceite centralizado');
    const targetGuardian = await prisma.responsavel.create({
      data: { contaId: schoolA.contaId, nome: 'Responsável centralizado', cpf: '52998224725', email: ' ', telefone: '11999999999' },
      select: { id: true },
    });
    await prisma.alunoResponsavel.create({ data: { contaId: schoolA.contaId, alunoId: student.id, responsavelId: targetGuardian.id, tipoVinculo: 'RESPONSAVEL' } });
    const invite = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: targetGuardian.id, role: 'RESPONSAVEL' },
    });
    expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);

    const inviteeEmail = `admin-b-${randomUUID()}@e2e.test`;
    const pageB = await browser.newPage();
    try {
      const schoolB = await seedAdminAndAuthenticate(pageB, { email: inviteeEmail });
      const user = await prisma.usuario.update({
        where: { email: inviteeEmail },
        data: { emailVerifiedAt: new Date() },
        select: { id: true, email: true, nome: true },
      });
      await useAccountSession(pageB, {
        ...user,
        role: Role.ADMIN,
        contaId: schoolB.contaId,
      });
      const token = inviteTokenFrom(invite.body);
      await pageB.goto(`/auth/register?token=${encodeURIComponent(token)}`);

      const card = pageB.getByTestId('invite-acceptance-card');
      await expect(card).toBeVisible();
      await expect(pageB.getByTestId('invite-guardian-cpf')).toHaveCount(0);
      await expect(pageB.getByTestId('invite-guardian-phone')).toHaveCount(0);
      const bounds = await card.boundingBox();
      const viewport = pageB.viewportSize();
      expect(bounds).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport!.width / 2)).toBeLessThan(2);
      expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport!.height / 2)).toBeLessThan(2);
    } finally {
      await pageB.close();
    }
  });

  test('recepção compartilha convite apenas para responsável cadastrado na escola ativa', async ({ page }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const schoolB = await prisma.conta.create({ data: { nome: 'Escola B', status: 'ATIVO' }, select: { id: true } });
    const freeStudent = await createStudent(schoolA.contaId, 'Aluno disponível');
    const linkedStudent = await createStudent(schoolA.contaId, 'Aluno já vinculado');
    const foreignStudent = await createStudent(schoolB.id, 'Aluno de outra escola');

    const receptionist = await prisma.usuario.create({
      data: {
        contaId: schoolA.contaId,
        nome: 'Recepção E2E',
        email: `recepcao-${randomUUID()}@e2e.test`,
        senhaHash: 'not-used',
        role: Role.RECEPCAO,
        status: 'ATIVO',
        emailVerifiedAt: new Date(),
      },
      select: { id: true, nome: true, email: true },
    });
    await prisma.usuarioConta.create({
      data: { usuarioId: receptionist.id, contaId: schoolA.contaId, role: Role.RECEPCAO, status: 'ATIVO' },
    });
    const localGuardian = await prisma.responsavel.create({
      data: {
        contaId: schoolA.contaId,
        nome: 'Responsável existente',
        cpf: '52998224725',
        email: `responsavel-existente-${randomUUID()}@e2e.test`,
        telefone: '11999999999',
      },
      select: { id: true },
    });
    await prisma.alunoResponsavel.create({
      data: { contaId: schoolA.contaId, alunoId: linkedStudent.id, responsavelId: localGuardian.id, tipoVinculo: 'RESPONSAVEL' },
    });
    const foreignGuardian = await prisma.responsavel.create({
      data: { contaId: schoolB.id, nome: 'Responsável Escola B', cpf: '40630299883', email: `responsavel-b-${randomUUID()}@e2e.test`, telefone: '11999999999' },
      select: { id: true },
    });
    await prisma.alunoResponsavel.create({
      data: { contaId: schoolB.id, alunoId: foreignStudent.id, responsavelId: foreignGuardian.id, tipoVinculo: 'RESPONSAVEL' },
    });

    await useAccountSession(page, { ...receptionist, role: Role.RECEPCAO, contaId: schoolA.contaId });
    const available = await page.request.get('/api/alunos/list-for-responsavel');
    expect(available.ok()).toBeTruthy();
    const availableBody = await available.json();
    expect(availableBody.alunos.map((student: { id: string }) => student.id)).toContain(freeStudent.id);
    expect(availableBody.alunos.map((student: { id: string }) => student.id)).not.toContain(linkedStudent.id);
    expect(availableBody.alunos.map((student: { id: string }) => student.id)).not.toContain(foreignStudent.id);

    const invite = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: localGuardian.id, role: 'RESPONSAVEL' },
    });
    expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);
    const inviteDetails = invite.body.invite as { email: string | null; inviteUrl?: string };
    expect(inviteDetails.email).toBeNull();
    expect(inviteTokenFrom(invite.body)).toBeTruthy();

    const crossTenant = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: foreignGuardian.id, role: 'RESPONSAVEL' },
    });
    expect(crossTenant.response.status()).toBe(404);
  });

  test('responsável aceita cadastro existente sem CPF/telefone somente após confirmar o e-mail', async ({ page, browser }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const student = await createStudent(school.contaId, 'Aluno do convite');
    const targetGuardian = await prisma.responsavel.create({
      data: { contaId: school.contaId, nome: 'Responsável existente', cpf: '52998224725', email: ' ', telefone: '11999999999' },
      select: { id: true },
    });
    await prisma.alunoResponsavel.create({ data: { contaId: school.contaId, alunoId: student.id, responsavelId: targetGuardian.id, tipoVinculo: 'RESPONSAVEL' } });
    const invite = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: targetGuardian.id, role: 'RESPONSAVEL' },
    });
    expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);
    const inviteInfo = invite.body.invite as { email: string | null };
    const token = inviteTokenFrom(invite.body);
    expect(inviteInfo.email).toBeNull();

    const guestContext = await browser.newContext();
    let acceptedEmail = '';
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto(new URL(`/auth/register?token=${encodeURIComponent(token)}`, page.url()).toString());
      await expect(guestPage.getByTestId('register-email')).toBeEditable();
      await expect(guestPage.getByTestId('register-guardian-cpf')).toHaveCount(0);
      await expect(guestPage.getByTestId('register-guardian-phone')).toHaveCount(0);
      await guestPage.getByTestId('register-nome-first').fill('Patrícia');
      await guestPage.getByTestId('register-nome-last').fill('Responsável');
      await guestPage.getByTestId('register-email').fill(`guardian-${randomUUID()}@e2e.test`);
      acceptedEmail = await guestPage.getByTestId('register-email').inputValue();
      await guestPage.getByTestId('register-senha').fill('Aa!23456');
      await guestPage.getByTestId('register-senha-confirmar').fill('Aa!23456');
      await guestPage.getByTestId('register-termos-checkbox').click();
      await guestPage.getByTestId('legal-acceptance-inner-checkbox').click();
      await guestPage.getByTestId('legal-acceptance-confirm').click();
      const acceptResponsePromise = guestPage.waitForResponse((response) =>
        response.url().includes('/api/users/accept') && response.request().method() === 'POST',
      );
      await guestPage.getByTestId('register-submit').click();
      const acceptResponse = await acceptResponsePromise;
      expect(acceptResponse.status()).toBe(202);
      await expect(guestPage.getByText(new RegExp(`Enviamos uma confirmação para ${acceptedEmail}`))).toBeVisible();

      const pendingUser = await prisma.usuario.findUniqueOrThrow({ where: { email: acceptedEmail } });
      expect(pendingUser.emailVerifiedAt).toBeNull();
      await expect(prisma.usuarioConta.count({ where: { usuarioId: pendingUser.id } })).resolves.toBe(0);
      await expect(prisma.responsavel.findUnique({ where: { id: targetGuardian.id }, select: { usuarioId: true } })).resolves.toEqual({ usuarioId: null });
      await expect(prisma.invite.findUnique({ where: { token }, select: { status: true } })).resolves.toEqual({ status: 'PENDING' });

      const verification = await sendEmailVerificationForUser(pendingUser.id, { ip: '127.0.0.1', userAgent: 'playwright' }, {
        callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(`/auth/register?token=${encodeURIComponent(token)}`)}`,
      });
      const verificationToken = new URL(verification.actionUrl).searchParams.get('token');
      expect(verificationToken).toBeTruthy();
      await guestPage.goto(`/auth/verify-email?token=${encodeURIComponent(verificationToken!)}`);
      await expect(guestPage.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible({ timeout: 10_000 });
      const completed = await guestPage.request.post(new URL('/api/users/accept', guestPage.url()).toString(), {
        data: { token, email: acceptedEmail, password: 'Aa!23456' },
      });
      expect(completed.status(), await completed.text()).toBe(200);
    } finally {
      await guestContext.close();
    }

    const user = await prisma.usuario.findUniqueOrThrow({ where: { email: acceptedEmail } });
    const membership = await prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: user.id, contaId: school.contaId } },
    });
    const guardian = await prisma.responsavel.findFirst({ where: { contaId: school.contaId, usuarioId: user.id } });
    const studentLink = guardian && await prisma.alunoResponsavel.findUnique({
      where: { uq_aluno_responsavel_conta_aluno_responsavel: { contaId: school.contaId, alunoId: student.id, responsavelId: guardian.id } },
    });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(membership).toMatchObject({ role: Role.RESPONSAVEL, status: 'ATIVO' });
    expect(guardian).toMatchObject({ id: targetGuardian.id, cpf: '52998224725', email: ' ', telefone: '11999999999', usuarioId: user.id });
    expect(studentLink).not.toBeNull();

    const duplicateTarget = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: targetGuardian.id, role: 'RESPONSAVEL' },
    });
    expect(duplicateTarget.response.status()).toBe(409);
  });

  test('uma conta administradora existente aceita acesso de recepção em outra escola sem duplicar login', async ({ page, browser }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const invitedEmail = `admin-b-${randomUUID()}@e2e.test`;
    const pageB = await browser.newPage();
    try {
      const schoolB = await seedAdminAndAuthenticate(pageB, { email: invitedEmail });
      const existingUser = await prisma.usuario.update({
        where: { email: invitedEmail },
        data: { emailVerifiedAt: new Date() },
        select: { id: true, nome: true, email: true },
      });
      await useAccountSession(pageB, { ...existingUser, role: Role.ADMIN, contaId: schoolB.contaId });
      const studentA = await createStudent(schoolA.contaId, 'Aluno escola A');
      const studentB = await createStudent(schoolB.contaId, 'Aluno escola B');
      const invite = await postJson(page, '/api/users/invite', { email: invitedEmail, role: 'RECEPCAO' });
      expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);

      const token = inviteTokenFrom(invite.body);
      const mismatch = await postJson(page, '/api/users/accept', { token });
      expect(mismatch.response.status()).toBe(403);

      const anonymousContext = await browser.newContext();
      try {
        const anonymousPage = await anonymousContext.newPage();
        await anonymousPage.goto('/');
        const existingAccount = await postJson(anonymousPage, '/api/users/accept', {
          token,
          name: 'Não deve criar duplicata',
          email: invitedEmail,
          password: 'Aa!23456',
        });
        expect(existingAccount.response.status()).toBe(401);
        expect(existingAccount.body.code).toBe('INVALID_CREDENTIALS');
      } finally {
        await anonymousContext.close();
      }

      const accepted = await postJson(pageB, '/api/users/accept', { token });
      expect(accepted.response.status(), JSON.stringify(accepted.body)).toBe(200);
      expect(await prisma.usuario.count({ where: { email: invitedEmail } })).toBe(1);
      const invitedUser = await prisma.usuario.findUniqueOrThrow({ where: { email: invitedEmail } });
      expect(invitedUser.emailVerifiedAt).toBeInstanceOf(Date);
      await expect(prisma.usuarioConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: invitedUser.id, contaId: schoolB.contaId } },
      })).resolves.toMatchObject({ role: Role.ADMIN, status: 'ATIVO' });
      await expect(prisma.usuarioConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: invitedUser.id, contaId: schoolA.contaId } },
      })).resolves.toMatchObject({ role: Role.RECEPCAO, status: 'ATIVO' });

      const accountsResponse = await pageB.request.get('/api/users/accounts');
      const accounts = await accountsResponse.json();
      expect(accounts.accounts.map((account: { id: string }) => account.id)).toEqual(expect.arrayContaining([schoolA.contaId, schoolB.contaId]));
      const schoolBStudents = await pageB.request.get('/api/alunos/list-for-responsavel');
      const schoolBStudentIds = (await schoolBStudents.json()).alunos.map((student: { id: string }) => student.id);
      expect(schoolBStudentIds).toContain(studentB.id);
      expect(schoolBStudentIds).not.toContain(studentA.id);

      await useAccountSession(pageB, {
        id: invitedUser.id,
        email: invitedEmail,
        name: invitedUser.nome,
        role: Role.ADMIN,
        contaId: schoolB.contaId,
      });
      await expect.poll(async () => {
        const sessionResponse = await pageB.request.get('/api/auth/session');
        const body = await sessionResponse.json();
        return body.user?.contaId;
      }).toBe(schoolB.contaId);

      // Simula uma troca de tenant autorizada pela associação persistida.
      // O cenário valida o limite de segurança no servidor, independente do dropdown visual.
      await useAccountSession(pageB, {
        id: invitedUser.id,
        email: invitedEmail,
        name: invitedUser.nome,
        role: Role.RECEPCAO,
        contaId: schoolA.contaId,
      });
      const switchedSession = await pageB.request.get('/api/auth/session');
      expect((await switchedSession.json()).user?.contaId).toBe(schoolA.contaId);
      const schoolAStudents = await pageB.request.get('/api/alunos/list-for-responsavel');
      const schoolAStudentIds = (await schoolAStudents.json()).alunos.map((student: { id: string }) => student.id);
      expect(schoolAStudentIds).toContain(studentA.id);
      expect(schoolAStudentIds).not.toContain(studentB.id);
    } finally {
      await pageB.close();
    }
  });
});
