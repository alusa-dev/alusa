import { expect, test, type Page } from '@playwright/test';
import { PrismaClient, Role } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import { randomUUID } from 'node:crypto';
import { resetDb } from './utils/reset-db';
import { seedAdminAndAuthenticate } from './utils/auth';
import { requiredRegisterLegalDocuments } from '@/lib/privacy/legal-versions';

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
  const authContext = user.role === Role.RESPONSAVEL
    ? 'PORTAL'
    : user.role === Role.ADMIN
      ? 'OWNER'
      : 'COLLABORATOR';
  await prisma.authCredential.upsert({
    where: { uq_auth_credential_context_user: { context: authContext, userId: user.id } },
    create: {
      context: authContext,
      normalizedEmail: user.email.trim().toLowerCase(),
      userId: user.id,
      passwordHash: 'not-used-in-e2e',
      emailVerifiedAt: new Date(),
    },
    update: { emailVerifiedAt: new Date() },
  });
  const token = await encode({
    secret,
    token: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      contaId: user.contaId,
      authContext,
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

  test('cartão de aceite de uma sessão do portal fica centralizado na viewport', async ({ browser, page }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const schoolB = await prisma.conta.create({ data: { nome: 'Escola com responsável ativo', status: 'ATIVO' }, select: { id: true } });
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

    const pageB = await browser.newPage();
    try {
      const portalUser = await prisma.usuario.create({
        data: {
          contaId: schoolB.id,
          nome: 'Responsável Portal E2E',
          email: `portal-${randomUUID()}@e2e.test`,
          senhaHash: 'not-used',
          role: Role.RESPONSAVEL,
          status: 'ATIVO',
        },
        select: { id: true, email: true, nome: true },
      });
      const portalStudent = await createStudent(schoolB.id, 'Aluno do portal existente');
      const portalGuardian = await prisma.responsavel.create({
        data: {
          contaId: schoolB.id,
          nome: portalUser.nome,
          cpf: '40630299883',
          email: portalUser.email,
          telefone: '11999999999',
          usuarioId: portalUser.id,
        },
        select: { id: true },
      });
      await prisma.alunoResponsavel.create({
        data: { contaId: schoolB.id, alunoId: portalStudent.id, responsavelId: portalGuardian.id, tipoVinculo: 'RESPONSAVEL' },
      });
      await useAccountSession(pageB, { ...portalUser, role: Role.RESPONSAVEL, contaId: schoolB.id });
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
    await prisma.authCredential.create({
      data: {
        context: 'COLLABORATOR',
        normalizedEmail: receptionist.email.toLowerCase(),
        userId: receptionist.id,
        passwordHash: 'not-used-in-e2e',
        emailVerifiedAt: new Date(),
      },
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

  test('responsável define o próprio e-mail e entra pelo link sem etapa extra de confirmação', async ({ page, browser }) => {
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
    const acceptedEmail = `guardian-${randomUUID()}@e2e.test`;
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto(new URL(`/auth/register?token=${encodeURIComponent(token)}`, page.url()).toString());
      await expect(guestPage.getByTestId('register-email')).toBeEditable();
      await expect(guestPage.getByTestId('register-guardian-cpf')).toHaveCount(0);
      await expect(guestPage.getByTestId('register-guardian-phone')).toHaveCount(0);
      await guestPage.getByTestId('register-nome-first').fill('Patrícia');
      await guestPage.getByTestId('register-nome-last').fill('Responsável');
      await guestPage.getByTestId('register-email').fill(acceptedEmail);
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
      await guestPage.waitForURL('**/dashboard', { timeout: 15_000 });

      const pendingUser = await prisma.usuario.findUniqueOrThrow({ where: { email: acceptedEmail } });
      expect(pendingUser.emailVerifiedAt).toBeNull();
      await expect(prisma.usuarioConta.count({ where: { usuarioId: pendingUser.id } })).resolves.toBe(1);
      await expect(prisma.responsavel.findUnique({ where: { id: targetGuardian.id }, select: { usuarioId: true } })).resolves.toEqual({ usuarioId: pendingUser.id });
      await expect(prisma.invite.findUnique({ where: { token }, select: { status: true } })).resolves.toEqual({ status: 'ACCEPTED' });
      await expect(prisma.authCredential.findUnique({
        where: { uq_auth_credential_context_user: { context: 'PORTAL', userId: pendingUser.id } },
        select: { emailVerifiedAt: true },
      })).resolves.toMatchObject({ emailVerifiedAt: expect.any(Date) });
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
    expect(guardian).toMatchObject({ id: targetGuardian.id, cpf: '52998224725', email: ' ', telefone: '11999999999', usuarioId: user.id });
    expect(studentLink).not.toBeNull();

    const duplicateTarget = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: targetGuardian.id, role: 'RESPONSAVEL' },
    });
    expect(duplicateTarget.response.status()).toBe(409);
  });

  test('e-mail já usado como proprietário pode aceitar convite com credencial independente de colaborador', async ({ page, browser }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const invitedEmail = `admin-b-${randomUUID()}@e2e.test`;
    const pageB = await browser.newPage();
    try {
      const schoolB = await seedAdminAndAuthenticate(pageB, { email: invitedEmail });
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
        await anonymousPage.goto(`/auth/register?token=${encodeURIComponent(token)}`);
        await expect(anonymousPage.getByTestId('register-email')).toHaveValue(invitedEmail);
        await expect(anonymousPage.getByTestId('register-email')).toHaveAttribute('readonly', '');
        await anonymousPage.getByTestId('register-nome-first').fill('Colaborador');
        await anonymousPage.getByTestId('register-nome-last').fill('E2E');
        await anonymousPage.getByTestId('register-senha').fill('Bb!98765');
        await anonymousPage.getByTestId('register-senha-confirmar').fill('Bb!98765');
        await anonymousPage.getByTestId('register-termos-checkbox').click();
        await anonymousPage.getByTestId('legal-acceptance-inner-checkbox').click();
        await anonymousPage.getByTestId('legal-acceptance-confirm').click();
        await anonymousPage.getByTestId('register-submit').click();
        await anonymousPage.waitForURL('**/dashboard', { timeout: 15_000 });

        const acceptedUser = await prisma.usuario.findUniqueOrThrow({ where: { email: invitedEmail } });
        expect(await prisma.usuario.count({ where: { email: invitedEmail } })).toBe(1);
        expect(acceptedUser.id).toBeTruthy();
        const credentials = await prisma.authCredential.findMany({
          where: { userId: acceptedUser.id },
          select: { context: true, passwordHash: true, emailVerifiedAt: true },
        });
        expect(credentials.map((credential) => credential.context)).toEqual(expect.arrayContaining(['OWNER', 'COLLABORATOR']));
        expect(credentials.find((credential) => credential.context === 'OWNER')?.passwordHash)
          .not.toBe(credentials.find((credential) => credential.context === 'COLLABORATOR')?.passwordHash);
        expect(credentials.find((credential) => credential.context === 'COLLABORATOR')?.emailVerifiedAt).toBeInstanceOf(Date);
        await expect(prisma.usuarioConta.findUnique({
          where: { usuarioId_contaId: { usuarioId: acceptedUser.id, contaId: schoolA.contaId } },
        })).resolves.toMatchObject({ role: Role.RECEPCAO, status: 'ATIVO' });
        await expect(prisma.usuarioConta.findUnique({
          where: { usuarioId_contaId: { usuarioId: acceptedUser.id, contaId: schoolB.contaId } },
        })).resolves.toMatchObject({ role: Role.ADMIN, status: 'ATIVO' });

        const collaboratorAccountsResponse = await anonymousPage.request.get('/api/users/accounts');
        const collaboratorAccounts = await collaboratorAccountsResponse.json();
        expect(collaboratorAccounts.accounts.map((account: { id: string }) => account.id)).toContain(schoolA.contaId);
        expect(collaboratorAccounts.accounts.map((account: { id: string }) => account.id)).not.toContain(schoolB.contaId);
        const schoolAStudents = await anonymousPage.request.get('/api/alunos/list-for-responsavel');
        const schoolAStudentIds = (await schoolAStudents.json()).alunos.map((student: { id: string }) => student.id);
        expect(schoolAStudentIds).toContain(studentA.id);
        expect(schoolAStudentIds).not.toContain(studentB.id);
      } finally {
        await anonymousContext.close();
      }
      const ownerAccountsResponse = await pageB.request.get('/api/users/accounts');
      const ownerAccounts = await ownerAccountsResponse.json();
      expect(ownerAccounts.accounts.map((account: { id: string }) => account.id)).toContain(schoolB.contaId);
      expect(ownerAccounts.accounts.map((account: { id: string }) => account.id)).not.toContain(schoolA.contaId);
    } finally {
      await pageB.close();
    }
  });

  test('colaborador convidado pode criar a própria escola depois com o mesmo e-mail e senha independente', async ({ page, browser }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const sharedEmail = `joao-${randomUUID()}@e2e.test`;
    const invite = await postJson(page, '/api/users/invite', { email: sharedEmail, role: 'RECEPCAO' });
    expect(invite.response.status(), JSON.stringify(invite.body)).toBe(201);

    const anonymousContext = await browser.newContext();
    const anonymousPage = await anonymousContext.newPage();
    try {
      await anonymousPage.goto('/');
      const accepted = await postJson(anonymousPage, '/api/users/accept', {
        token: inviteTokenFrom(invite.body),
        name: 'João Convidado',
        email: sharedEmail,
        password: 'Colab!23456',
      });
      expect(accepted.response.status(), JSON.stringify(accepted.body)).toBe(200);
      expect(accepted.body).toMatchObject({ verificationRequired: false, user: { email: sharedEmail, emailVerified: true } });

      const ownerRegistration = await postJson(anonymousPage, '/api/users/first-register', {
      escolaNome: 'Escola nova do João',
      nome: 'João Proprietário',
      email: sharedEmail,
      senha: 'Owner!98765',
      financeIntegrationMode: 'WHITELABEL_BAAS',
      legalAcceptance: {
        accepted: true,
        locale: 'pt-BR',
        source: 'REGISTER',
        documents: requiredRegisterLegalDocuments().map((document) => ({
          documentType: document.type,
          documentVersion: document.version,
        })),
      },
      });
      expect(ownerRegistration.response.status(), JSON.stringify(ownerRegistration.body)).toBe(201);
      expect(ownerRegistration.body).toMatchObject({ verificationRequired: true, user: { email: sharedEmail, emailVerified: false } });

    const sameIdentity = await prisma.usuario.findUniqueOrThrow({ where: { email: sharedEmail } });
    expect(await prisma.usuario.count({ where: { email: sharedEmail } })).toBe(1);
    const credentials = await prisma.authCredential.findMany({
      where: { userId: sameIdentity.id },
      select: { context: true, passwordHash: true, emailVerifiedAt: true },
    });
    const ownerCredential = credentials.find((credential) => credential.context === 'OWNER');
    const collaboratorCredential = credentials.find((credential) => credential.context === 'COLLABORATOR');
    expect(ownerCredential).toBeTruthy();
    expect(collaboratorCredential?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(ownerCredential?.passwordHash).not.toBe(collaboratorCredential?.passwordHash);

    const ownerConta = await prisma.conta.findFirstOrThrow({ where: { ownerUserId: sameIdentity.id }, select: { id: true, nome: true } });
    expect(ownerConta.nome).toBe('Escola nova do João');
    await expect(prisma.usuarioConta.findUnique({
      where: { usuarioId_contaId: { usuarioId: sameIdentity.id, contaId: schoolA.contaId } },
    })).resolves.toMatchObject({ role: Role.RECEPCAO, status: 'ATIVO' });

      const checkLogin = async (authContext: 'OWNER' | 'COLLABORATOR', password: string) => postJson(anonymousPage, '/api/auth/login/validate', {
      email: sharedEmail,
      password,
      authContext,
    });
    const validOwner = await checkLogin('OWNER', 'Owner!98765');
    const wrongOwner = await checkLogin('OWNER', 'Colab!23456');
    const validCollaborator = await checkLogin('COLLABORATOR', 'Colab!23456');
    const wrongCollaborator = await checkLogin('COLLABORATOR', 'Owner!98765');
    expect(validOwner.response.status()).toBe(200);
    expect(wrongOwner.response.status()).toBe(401);
    expect(validCollaborator.response.status()).toBe(200);
    expect(wrongCollaborator.response.status()).toBe(401);
    expect((validOwner.body.accounts as Array<{ id: string }>).map((account) => account.id)).toContain(ownerConta.id);
    expect((validOwner.body.accounts as Array<{ id: string }>).map((account) => account.id)).not.toContain(schoolA.contaId);
    expect((validCollaborator.body.accounts as Array<{ id: string }>).map((account) => account.id)).toContain(schoolA.contaId);
    expect((validCollaborator.body.accounts as Array<{ id: string }>).map((account) => account.id)).not.toContain(ownerConta.id);
    } finally {
      await anonymousContext.close();
    }
  });
});
