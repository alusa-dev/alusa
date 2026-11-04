import { expect, test } from '@playwright/test';
import { PrismaClient, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

test('aluno e responsável entram no Portal com o próprio vínculo escolar', async ({ page }) => {
  await resetDb(prisma);
  const suffix = randomUUID();
  const studentSchool = await prisma.conta.create({ data: { nome: `Escola do aluno ${suffix}`, status: 'ATIVO' }, select: { id: true } });
  const guardianSchool = await prisma.conta.create({ data: { nome: `Escola da responsável ${suffix}`, status: 'ATIVO' }, select: { id: true } });
  const unrelatedSchool = await prisma.conta.create({ data: { nome: `Escola sem vínculo ${suffix}`, status: 'ATIVO' }, select: { id: true } });
  const bcrypt = (await import('bcryptjs')).default;

  const studentEmail = `aluno-${suffix}@e2e.test`;
  const studentPassword = 'Aluno!23456';
  const studentUser = await prisma.usuario.create({
    data: { nome: 'Aluno Portal', email: studentEmail, senhaHash: 'legacy-unused', role: Role.RESPONSAVEL, status: 'ATIVO' },
    select: { id: true },
  });
  await prisma.aluno.create({
    data: {
      contaId: studentSchool.id,
      nome: 'Aluno Portal',
      dataNasc: new Date('2014-01-01T12:00:00.000Z'),
      usuarioId: studentUser.id,
      status: 'ATIVO',
    },
  });
  await prisma.authCredential.create({
    data: {
      context: 'PORTAL', normalizedEmail: studentEmail, userId: studentUser.id,
      passwordHash: await bcrypt.hash(studentPassword, 10), emailVerifiedAt: new Date(),
    },
  });

  const guardianEmail = `responsavel-${suffix}@e2e.test`;
  const guardianPassword = 'Responsavel!23456';
  const guardianUser = await prisma.usuario.create({
    data: { nome: 'Responsável Portal', email: guardianEmail, senhaHash: 'legacy-unused', role: Role.RESPONSAVEL, status: 'ATIVO' },
    select: { id: true },
  });
  await prisma.responsavel.create({
    data: {
      contaId: guardianSchool.id,
      nome: 'Responsável Portal',
      cpf: '52998224725',
      email: guardianEmail,
      telefone: '11999999999',
      usuarioId: guardianUser.id,
    },
  });
  await prisma.authCredential.create({
    data: {
      context: 'PORTAL', normalizedEmail: guardianEmail, userId: guardianUser.id,
      passwordHash: await bcrypt.hash(guardianPassword, 10), emailVerifiedAt: new Date(),
    },
  });

  const validateLogin = (email: string, password: string) => page.request.post('/api/auth/login/validate', {
    data: { email, password, authContext: 'PORTAL' },
  });
  const [studentLogin, guardianLogin, wrongPassword] = await Promise.all([
    validateLogin(studentEmail, studentPassword),
    validateLogin(guardianEmail, guardianPassword),
    validateLogin(guardianEmail, studentPassword),
  ]);
  expect(studentLogin.status()).toBe(200);
  expect(guardianLogin.status()).toBe(200);
  expect(wrongPassword.status()).toBe(401);
  const studentResult = await studentLogin.json();
  const guardianResult = await guardianLogin.json();
  expect(studentResult.accounts).toEqual([{ id: studentSchool.id, name: expect.any(String), role: 'ALUNO' }]);
  expect(guardianResult.accounts).toEqual([{ id: guardianSchool.id, name: expect.any(String), role: 'RESPONSAVEL' }]);
  expect(studentResult.accounts.map((account: { id: string }) => account.id)).not.toContain(unrelatedSchool.id);
  expect(guardianResult.accounts.map((account: { id: string }) => account.id)).not.toContain(unrelatedSchool.id);
});
