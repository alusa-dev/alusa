import { expect, test, type Page } from '@playwright/test';
import { PrismaClient, Role } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import { randomUUID } from 'node:crypto';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import { resetDb } from './utils/reset-db';
import { seedAdminAndAuthenticate } from './utils/auth';

const prisma = new PrismaClient();

async function installSession(
  page: Page,
  user: { id: string; email: string; name: string; role: Role; contaId: string },
  emailVerified = true,
  refreshSession = true,
) {
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
      emailVerifiedAt: emailVerified ? new Date() : null,
    },
    update: { emailVerifiedAt: emailVerified ? new Date() : null },
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
      emailVerified,
      accountActive: true,
      sessionVersion: 0,
    },
  });
  await page.context().addCookies([{
    name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }]);
  if (refreshSession) await page.goto('/api/auth/session');
}

async function createStudent(contaId: string, nome: string) {
  return prisma.aluno.create({
    data: { contaId, nome, dataNasc: new Date('2015-01-01T12:00:00.000Z'), status: 'ATIVO' },
    select: { id: true },
  });
}

async function createReceptionist(contaId: string) {
  const user = await prisma.usuario.create({
    data: {
      contaId,
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
    data: { usuarioId: user.id, contaId, role: Role.RECEPCAO, status: 'ATIVO' },
  });
  await prisma.authCredential.create({
    data: {
      context: 'COLLABORATOR',
      normalizedEmail: user.email.toLowerCase(),
      userId: user.id,
      passwordHash: 'not-used-in-e2e',
      emailVerifiedAt: new Date(),
    },
  });
  return user;
}

async function postJson(page: Page, path: string, body: unknown) {
  const response = await page.request.post(new URL(path, page.url()).toString(), { data: body });
  return { response, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

function inviteFrom(body: Record<string, unknown>) {
  const invite = body.invite;
  if (!invite || typeof invite !== 'object') throw new Error('Resposta não contém invite');
  const record = invite as { id: string; email?: string; inviteUrl?: string };
  if (!record.inviteUrl) throw new Error('Resposta não contém link do convite');
  const token = new URL(record.inviteUrl).searchParams.get('token');
  if (!token) throw new Error('Link do convite não contém token');
  return { ...record, token };
}

test.describe('convites — validação ponta a ponta complementar', () => {
  test.beforeEach(async () => resetDb(prisma));

  test('valida seleção obrigatória, permissões e criação de convite de colaborador', async ({ page }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const noStudents = await postJson(page, '/api/users/invite', { role: 'RESPONSAVEL', alunosIds: [] });
    expect(noStudents.response.status()).toBe(400);

    const employeeEmail = `secretaria-${randomUUID()}@e2e.test`;
    const created = await postJson(page, '/api/users/invite', { email: employeeEmail, role: 'RECEPCAO' });
    expect(created.response.status(), JSON.stringify(created.body)).toBe(201);
    const invite = inviteFrom(created.body);
    const inviteId = invite.id;
    const persistedInvite = await prisma.invite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(persistedInvite).toMatchObject({ contaId: school.contaId, email: employeeEmail, role: Role.RECEPCAO, status: 'PENDING' });
    expect(String(invite.inviteUrl)).toContain('/auth/register?token=');

    const receptionist = await createReceptionist(school.contaId);
    await installSession(page, { ...receptionist, role: Role.RECEPCAO, contaId: school.contaId });
    const forbidden = await postJson(page, '/api/users/invite', { email: `other-${randomUUID()}@e2e.test`, role: 'RECEPCAO' });
    expect(forbidden.response.status()).toBe(403);
    expect(forbidden.body.error).toBeTruthy();
  });

  test('convite com e-mail fixo rejeita outra identidade e preserva convite pendente', async ({ page, browser }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const inviteEmail = `colaborador-${randomUUID()}@e2e.test`;
    const created = await postJson(page, '/api/users/invite', { email: inviteEmail, role: 'RECEPCAO' });
    expect(created.response.status()).toBe(201);
    const token = inviteFrom(created.body).token;

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto('/');
    const missingCredentials = await postJson(guestPage, '/api/users/accept', { token });
    expect(missingCredentials.response.status()).toBe(400);

    await guestPage.goto(`/auth/register?token=${encodeURIComponent(token)}`);
    await expect(guestPage.getByTestId('register-email')).toHaveValue(inviteEmail);
    await expect(guestPage.getByTestId('register-email')).toHaveAttribute('readonly', '');

    const wrongEmail = await postJson(page, '/api/users/accept', {
      token,
      email: `different-${randomUUID()}@e2e.test`,
      name: 'Pessoa Diferente',
      password: 'Aa!23456',
    });
    expect(wrongEmail.response.status()).toBe(403);
    expect(await prisma.invite.findUniqueOrThrow({ where: { token } })).toMatchObject({ status: 'PENDING', contaId: school.contaId });
    await guestContext.close();
  });

  test('convite expirado, revogado, aceito e link repetido não concedem acesso', async ({ page, browser }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const expired = await postJson(page, '/api/users/invite', { email: `expired-${randomUUID()}@e2e.test`, role: 'RECEPCAO' });
    const revoked = await postJson(page, '/api/users/invite', { email: `revoked-${randomUUID()}@e2e.test`, role: 'RECEPCAO' });
    const accepted = await postJson(page, '/api/users/invite', { email: `accepted-${randomUUID()}@e2e.test`, role: 'RECEPCAO' });
    for (const result of [expired, revoked, accepted]) expect(result.response.status()).toBe(201);

    const expiredInvite = inviteFrom(expired.body);
    const revokedInvite = inviteFrom(revoked.body);
    const acceptedInvite = inviteFrom(accepted.body) as { id: string; token: string; email: string };
    const bcrypt = (await import('bcryptjs')).default;
    await prisma.usuario.create({
      data: {
        nome: 'Identidade confirmada', email: acceptedInvite.email,
        senhaHash: await bcrypt.hash('Aa!23456', 10), role: Role.RECEPCAO,
        status: 'ATIVO', emailVerifiedAt: new Date(),
      },
    });
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto('/');
    await prisma.invite.update({ where: { id: expiredInvite.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await prisma.invite.update({ where: { id: revokedInvite.id }, data: { status: 'REVOKED' } });

    for (const token of [expiredInvite.token, revokedInvite.token]) {
      const validation = await guestPage.request.get(new URL(`/api/users/accept?token=${encodeURIComponent(token)}`, guestPage.url()).toString());
      expect([404, 410]).toContain(validation.status());
      const accept = await postJson(guestPage, '/api/users/accept', { token, name: 'Pessoa Teste', password: 'Aa!23456' });
      expect([404, 410]).toContain(accept.response.status());
    }

    const firstAccept = await postJson(guestPage, '/api/users/accept', {
      token: acceptedInvite.token, name: 'Colaborador Aceito', email: acceptedInvite.email, password: 'Aa!23456',
    });
    expect(firstAccept.response.status(), JSON.stringify(firstAccept.body)).toBe(200);
    const replay = await postJson(guestPage, '/api/users/accept', {
      token: acceptedInvite.token, name: 'Colaborador Aceito', email: acceptedInvite.email, password: 'Aa!23456',
    });
    expect(replay.response.status()).toBe(200);
    await guestPage.goto(`/auth/register?token=${encodeURIComponent(acceptedInvite.token)}`);
    await expect(guestPage).toHaveURL(/\/auth\/login\?error=invalid_token/);
    expect(await prisma.usuario.count({ where: { email: acceptedInvite.email } })).toBe(1);
    expect(await prisma.usuarioConta.count({ where: { contaId: school.contaId } })).toBe(2);
    await guestContext.close();
  });

  test('duas aceitações concorrentes do mesmo convite criam apenas uma identidade e um vínculo', async ({ page, browser }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const student = await createStudent(school.contaId, 'Aluno concorrência');
    const guardian = await prisma.responsavel.create({
      data: { contaId: school.contaId, nome: 'Responsável concorrente', cpf: '52998224725', email: ' ', telefone: '11999999999' },
      select: { id: true },
    });
    await prisma.alunoResponsavel.create({ data: { contaId: school.contaId, alunoId: student.id, responsavelId: guardian.id, tipoVinculo: 'RESPONSAVEL' } });
    const created = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: guardian.id, role: 'RESPONSAVEL' },
    });
    expect(created.response.status()).toBe(201);
    const token = inviteFrom(created.body).token;
    const email = `guardian-race-${randomUUID()}@e2e.test`;
    const payload = {
      token, name: 'Responsável Concorrente', email, password: 'Aa!23456',
    };
    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto('/');
    const [acceptOne, acceptTwo] = await Promise.all([
      postJson(guest, '/api/users/accept', payload),
      postJson(guest, '/api/users/accept', payload),
    ]);
    const acceptStatuses = [acceptOne.response.status(), acceptTwo.response.status()];
    expect(acceptStatuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
    expect(acceptStatuses.every((status) => [200, 409].includes(status)), JSON.stringify({ acceptStatuses, bodies: [acceptOne.body, acceptTwo.body] })).toBe(true);
    const user = await prisma.usuario.findUniqueOrThrow({ where: { email } });
    expect(await prisma.usuarioConta.count({ where: { usuarioId: user.id } })).toBe(1);
    expect(await prisma.authCredential.findUnique({
      where: { uq_auth_credential_context_user: { context: 'PORTAL', userId: user.id } },
      select: { emailVerifiedAt: true },
    })).toMatchObject({ emailVerifiedAt: expect.any(Date) });
    const completedReplay = await postJson(guest, '/api/users/accept', payload);
    expect(completedReplay.response.status(), JSON.stringify(completedReplay.body)).toBe(200);
    expect(await prisma.usuario.count({ where: { email } })).toBe(1);
    expect(await prisma.usuarioConta.count({ where: { contaId: school.contaId, role: Role.RESPONSAVEL } })).toBe(1);
    expect(await prisma.alunoResponsavel.count({ where: { contaId: school.contaId, alunoId: student.id } })).toBe(1);
    expect(await prisma.invite.count({ where: { token, status: 'ACCEPTED' } })).toBe(1);
    await context.close();
  });

  test('login válido e inválido; um tenant sem vínculo é recusado pelo servidor', async ({ page }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const schoolB = await prisma.conta.create({ data: { nome: 'Escola fora do vínculo', status: 'ATIVO' }, select: { id: true } });
    const receptionist = await createReceptionist(schoolA.contaId);
    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default;
    const password = 'Aa!23456';
    await prisma.authCredential.update({
      where: { uq_auth_credential_context_user: { context: 'COLLABORATOR', userId: receptionist.id } },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    await page.context().clearCookies();
    await page.goto('/auth/login');
    await page.getByTestId('email').fill(receptionist.email);
    await page.getByTestId('password').fill('SenhaErrada1!');
    await page.getByTestId('login-button').click();
    await expect(page.getByText('E-mail ou senha inválidos, ou acesso indisponível.')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('password').fill(password);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL(/\/dashboard|\/portal/, { timeout: 10_000 });

    await installSession(page, { ...receptionist, role: Role.RECEPCAO, contaId: schoolB.id }, true, false);
    const unauthorizedTenant = await page.request.get(new URL('/api/auth/account-access', page.url()).toString());
    expect(unauthorizedTenant.status()).toBe(403);
    expect(await unauthorizedTenant.json()).toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    expect(schoolB.id).not.toBe(schoolA.contaId);
  });

  test('remover acesso de uma escola preserva a mesma conta e o vínculo em outra escola', async ({ page, browser }) => {
    const schoolA = await seedAdminAndAuthenticate(page, { email: `admin-a-${randomUUID()}@e2e.test` });
    const schoolBPage = await browser.newPage();
    try {
      const schoolB = await seedAdminAndAuthenticate(schoolBPage, { email: `admin-b-${randomUUID()}@e2e.test` });
      const inviteeEmail = `shared-${randomUUID()}@e2e.test`;
      const createdUser = await prisma.usuario.create({
        data: { contaId: schoolB.contaId, nome: 'Usuário Multi-escola', email: inviteeEmail, senhaHash: 'not-used', role: Role.ADMIN, status: 'ATIVO', emailVerifiedAt: new Date() },
        select: { id: true, nome: true, email: true },
      });
      await prisma.usuarioConta.create({ data: { usuarioId: createdUser.id, contaId: schoolB.contaId, role: Role.ADMIN, status: 'ATIVO' } });
      await installSession(schoolBPage, { ...createdUser, role: Role.RECEPCAO, contaId: schoolB.contaId });
      const invited = await postJson(page, '/api/users/invite', { email: inviteeEmail, role: 'RECEPCAO' });
      expect(invited.response.status()).toBe(201);
      const accepted = await postJson(schoolBPage, '/api/users/accept', { token: inviteFrom(invited.body).token });
      expect(accepted.response.status()).toBe(200);

      const removalResponse = await page.request.delete(new URL(`/api/users/${createdUser.id}`, page.url()).toString(), { data: { reason: 'Teste de isolamento E2E' } });
      expect(removalResponse.status(), await removalResponse.text()).toBe(200);
      expect(await prisma.usuario.findUnique({ where: { id: createdUser.id } })).not.toBeNull();
      expect(await prisma.usuarioConta.findUnique({ where: { usuarioId_contaId: { usuarioId: createdUser.id, contaId: schoolA.contaId } } })).toBeNull();
      expect(await prisma.usuarioConta.findUnique({ where: { usuarioId_contaId: { usuarioId: createdUser.id, contaId: schoolB.contaId } } })).toMatchObject({ status: 'ATIVO', role: Role.ADMIN });

      await installSession(schoolBPage, { ...createdUser, role: Role.RECEPCAO, contaId: schoolA.contaId }, true, false);
      const removedAccess = await schoolBPage.request.get(new URL('/api/auth/account-access', schoolBPage.url()).toString());
      expect(removedAccess.status()).toBe(403);
      expect(await removedAccess.json()).toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });

      await installSession(schoolBPage, { ...createdUser, role: Role.RECEPCAO, contaId: schoolB.contaId });
      const stillAllowed = await schoolBPage.request.get(new URL('/api/auth/account-access', schoolBPage.url()).toString());
      expect(stillAllowed.status()).toBe(200);
    } finally {
      await schoolBPage.close();
    }
  });

  test('confirmação e reenvio verificam o estado da conta e consomem o link uma única vez', async ({ page }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const user = await prisma.usuario.create({
      data: { contaId: school.contaId, nome: 'Conta A Confirmar', email: `verify-${randomUUID()}@e2e.test`, senhaHash: 'not-used', role: Role.RECEPCAO, status: 'ATIVO' },
      select: { id: true, email: true, nome: true },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: user.id, contaId: school.contaId, role: Role.RECEPCAO, status: 'ATIVO' } });
    await installSession(page, { ...user, role: Role.RECEPCAO, contaId: school.contaId }, false);

    const resendBefore = await prisma.authActionToken.count({ where: { userId: user.id, type: 'VERIFY_EMAIL' } });
    const resend = await page.request.post(new URL('/api/auth/verify-email/resend', page.url()).toString(), { data: { callbackUrl: '/dashboard' } });
    expect(resend.status(), await resend.text()).toBe(200);
    expect(await prisma.authActionToken.count({ where: { userId: user.id, type: 'VERIFY_EMAIL' } })).toBe(resendBefore + 1);

    const generated = await sendEmailVerificationForUser(user.id, { ip: '127.0.0.1', userAgent: 'playwright' }, { callbackUrl: '/dashboard' });
    const confirmationUrl = new URL(generated.actionUrl);
    const confirmationToken = confirmationUrl.searchParams.get('token');
    expect(confirmationToken).toBeTruthy();
    await page.goto(`/auth/verify-email?token=${encodeURIComponent(confirmationToken!)}&callbackUrl=%2Fdashboard`);
    await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible({ timeout: 10_000 });
    expect(await prisma.usuario.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ emailVerifiedAt: expect.any(Date) });

    const replay = await page.request.post(new URL('/api/auth/verify-email', page.url()).toString(), { data: { token: confirmationToken } });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, email: user.email });
  });

  test('aceitar convite sem os termos bloqueia a submissão e a conta não é criada', async ({ page }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const email = `terms-${randomUUID()}@e2e.test`;
    const created = await postJson(page, '/api/users/invite', { email, role: 'RECEPCAO' });
    expect(created.response.status()).toBe(201);
    await page.context().clearCookies();
    await page.goto(`/auth/register?token=${encodeURIComponent(inviteFrom(created.body).token)}`);
    await page.getByTestId('register-nome-first').fill('Conta');
    await page.getByTestId('register-nome-last').fill('Sem Termos');
    await page.getByTestId('register-senha').fill('Aa!23456');
    await page.getByTestId('register-senha-confirmar').fill('Aa!23456');
    const submit = page.getByTestId('register-submit');
    await expect(submit).toBeDisabled();
    await expect(page.getByTestId('register-email')).toHaveValue(email);
    await expect(page.getByTestId('register-email')).toHaveAttribute('readonly', '');
    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
    expect(await prisma.invite.count({ where: { contaId: school.contaId, email, status: 'PENDING' } })).toBe(1);
  });

  test('não oferece novo convite para responsável com acesso ativo', async ({ page }) => {
    const school = await seedAdminAndAuthenticate(page, { email: `admin-${randomUUID()}@e2e.test` });
    const student = await createStudent(school.contaId, 'Aluno conta já vinculada');
    const guardian = await prisma.responsavel.create({
      data: { contaId: school.contaId, nome: 'Responsável já vinculado', cpf: '52998224725', email: ' ', telefone: '11999999999' },
      select: { id: true },
    });
    await prisma.alunoResponsavel.create({ data: { contaId: school.contaId, alunoId: student.id, responsavelId: guardian.id, tipoVinculo: 'RESPONSAVEL' } });
    const existingEmail = `guardian-linked-${randomUUID()}@e2e.test`;
    const bcrypt = (await import('bcryptjs')).default;
    const existingUser = await prisma.usuario.create({
      data: { nome: 'Responsável já vinculado', email: existingEmail, senhaHash: await bcrypt.hash('Aa!23456', 10), role: Role.RESPONSAVEL, status: 'ATIVO', emailVerifiedAt: new Date() },
      select: { id: true },
    });
    await prisma.usuarioConta.create({ data: { usuarioId: existingUser.id, contaId: school.contaId, role: Role.RESPONSAVEL, status: 'ATIVO' } });
    await prisma.responsavel.update({ where: { id: guardian.id }, data: { usuarioId: existingUser.id } });
    const candidatesResponse = await page.request.get(new URL('/api/users/invite/candidates?recordType=RESPONSAVEL', page.url()).toString());
    expect(candidatesResponse.status()).toBe(200);
    const candidates = await candidatesResponse.json() as { items: Array<{ recordId: string; accessStatus: string; canInvite: boolean }> };
    expect(candidates.items.find((item) => item.recordId === guardian.id)).toMatchObject({ accessStatus: 'ACTIVE', canInvite: false });
    const created = await postJson(page, '/api/users/invite', {
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: guardian.id, role: 'RESPONSAVEL' },
    });
    expect(created.response.status()).toBe(409);
    expect(await prisma.invite.count({ where: { contaId: school.contaId, metadata: { path: ['target', 'recordId'], equals: guardian.id } } })).toBe(0);
  });
});
