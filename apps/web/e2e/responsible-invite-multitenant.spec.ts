import { expect, test, type Page } from '@playwright/test';
import { PrismaClient, Role } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import { randomUUID } from 'node:crypto';
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

test.describe('convite de responsável — aceite e isolamento multi-tenant', () => {
  test.beforeEach(async () => resetDb(prisma));

  test('cartão de aceite autenticado fica centralizado na viewport', async ({ browser, page }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const student = await createStudent(schoolA.contaId, 'Aluno para aceite centralizado');
    const invite = await postJson(page, '/api/users/invite', { role: 'RESPONSAVEL', alunosIds: [student.id] });
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
      const token = (invite.body.invite as { token: string }).token;
      await pageB.goto(`/auth/register?token=${encodeURIComponent(token)}`);

      const card = pageB.getByTestId('invite-acceptance-card');
      await expect(card).toBeVisible();
      const cpfInput = pageB.getByTestId('invite-guardian-cpf');
      const phoneInput = pageB.getByTestId('invite-guardian-phone');
      await cpfInput.fill('04104352645');
      await phoneInput.fill('11999999999');
      await expect(cpfInput).toHaveValue('041.043.526-45');
      await expect(phoneInput).toHaveValue('(11) 99999-9999');
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

  test('recepção convida apenas alunos disponíveis da escola ativa', async ({ page }) => {
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
    await prisma.responsavel.create({
      data: {
        contaId: schoolA.contaId,
        nome: 'Responsável existente',
        cpf: '52998224725',
        email: `responsavel-existente-${randomUUID()}@e2e.test`,
        telefone: '11999999999',
      },
    }).then(async (guardian) => {
      await prisma.alunoResponsavel.create({
        data: {
          contaId: schoolA.contaId,
          alunoId: linkedStudent.id,
          responsavelId: guardian.id,
          tipoVinculo: 'RESPONSAVEL',
        },
      });
    });

    await useAccountSession(page, { ...receptionist, role: Role.RECEPCAO, contaId: schoolA.contaId });
    const available = await page.request.get('/api/alunos/list-for-responsavel');
    expect(available.ok()).toBeTruthy();
    const availableBody = await available.json();
    expect(availableBody.alunos.map((student: { id: string }) => student.id)).toContain(freeStudent.id);
    expect(availableBody.alunos.map((student: { id: string }) => student.id)).not.toContain(linkedStudent.id);
    expect(availableBody.alunos.map((student: { id: string }) => student.id)).not.toContain(foreignStudent.id);

    const invite = await postJson(page, '/api/users/invite', { role: 'RESPONSAVEL', alunosIds: [freeStudent.id] });
    expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);
    const inviteDetails = invite.body.invite as { email: string | null; token: string };
    expect(inviteDetails.email).toBeNull();
    expect(inviteDetails.token).toBeTruthy();

    const linkedConflict = await postJson(page, '/api/users/invite', { role: 'RESPONSAVEL', alunosIds: [linkedStudent.id] });
    expect(linkedConflict.response.status()).toBe(409);
    expect(linkedConflict.body.code).toBe('STUDENT_ALREADY_LINKED');

    const crossTenant = await postJson(page, '/api/users/invite', { role: 'RESPONSAVEL', alunosIds: [foreignStudent.id] });
    expect(crossTenant.response.status()).toBe(404);
  });

  test('responsável escolhe e confirma o e-mail no aceite, criando o perfil e vínculo sem reutilizar aluno', async ({ page, browser }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const student = await createStudent(school.contaId, 'Aluno do convite');
    const invite = await postJson(page, '/api/users/invite', { role: 'RESPONSAVEL', alunosIds: [student.id] });
    expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);
    const token = String((invite.body.invite as { token: string }).token);

    const guestContext = await browser.newContext();
    let acceptedEmail = '';
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto(new URL(`/auth/register?token=${encodeURIComponent(token)}`, page.url()).toString());
      await expect(guestPage.getByTestId('register-email')).toBeEditable();
      await expect(guestPage.getByTestId('register-guardian-cpf')).toBeVisible();
      await expect(guestPage.getByTestId('register-guardian-phone')).toBeVisible();
      await guestPage.getByTestId('register-nome-first').fill('Patrícia');
      await guestPage.getByTestId('register-nome-last').fill('Responsável');
      await guestPage.getByTestId('register-email').fill(`guardian-${randomUUID()}@e2e.test`);
      acceptedEmail = await guestPage.getByTestId('register-email').inputValue();
      await guestPage.getByTestId('register-guardian-cpf').fill('529.982.247-25');
      await guestPage.getByTestId('register-guardian-phone').fill('(11) 99999-9999');
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
      expect(acceptResponse.status()).toBe(200);
      await guestPage.waitForURL('**/auth/confirm-email?callbackUrl=%2Fdashboard', { timeout: 10_000 });
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
    expect(user.emailVerifiedAt).toBeNull();
    expect(membership).toMatchObject({ role: Role.RESPONSAVEL, status: 'ATIVO' });
    expect(guardian).toMatchObject({ cpf: '52998224725', email: acceptedEmail, telefone: '11999999999' });
    expect(studentLink).not.toBeNull();

    const duplicateTarget = await postJson(page, '/api/users/invite', { role: 'RESPONSAVEL', alunosIds: [student.id] });
    expect(duplicateTarget.response.status()).toBe(409);
  });

  test('uma conta administradora existente aceita acesso de recepção em outra escola sem duplicar login', async ({ page, browser }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const invitedEmail = `admin-b-${randomUUID()}@e2e.test`;
    const pageB = await browser.newPage();
    try {
      const schoolB = await seedAdminAndAuthenticate(pageB, { email: invitedEmail });
      const studentA = await createStudent(schoolA.contaId, 'Aluno escola A');
      const studentB = await createStudent(schoolB.contaId, 'Aluno escola B');
      const invite = await postJson(page, '/api/users/invite', { email: invitedEmail, role: 'RECEPCAO' });
      expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);

      const token = (invite.body.invite as { token: string }).token;
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
        expect(existingAccount.response.status()).toBe(409);
        expect(existingAccount.body.code).toBe('ACCOUNT_EXISTS');
      } finally {
        await anonymousContext.close();
      }

      const accepted = await postJson(pageB, '/api/users/accept', { token });
      expect(accepted.response.status(), JSON.stringify(accepted.body)).toBe(200);
      expect(await prisma.usuario.count({ where: { email: invitedEmail } })).toBe(1);
      const invitedUser = await prisma.usuario.update({
        where: { email: invitedEmail }, data: { emailVerifiedAt: new Date() },
      });
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
