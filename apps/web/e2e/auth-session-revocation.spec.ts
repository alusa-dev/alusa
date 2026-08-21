import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';

const prisma = new PrismaClient();

async function authenticate(context: import('@playwright/test').BrowserContext, user: {
  id: string;
  email: string;
  contaId: string;
}) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente no ambiente E2E');

  const token = await encode({
    secret,
    token: {
      id: user.id,
      email: user.email,
      name: 'Auth E2E',
      role: 'ADMIN',
      contaId: user.contaId,
      sessionVersion: 0,
    },
  });

  await context.addCookies({
    name: 'next-auth.session-token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  });
}

test('separa logout individual de revogação global entre dois dispositivos', async ({ browser }) => {
  const suffix = randomUUID();
  const conta = await prisma.conta.create({
    data: {
      id: randomUUID(),
      nome: `Conta auth ${suffix}`,
      cpfCnpj: `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-14),
    },
    select: { id: true },
  });
  const user = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Usuário Auth E2E',
      email: `auth-${suffix}@example.com`,
      senhaHash: 'hash-nao-usado-no-e2e',
      role: 'ADMIN',
      status: 'ATIVO',
    },
    select: { id: true, email: true, contaId: true },
  });

  await prisma.usuarioConta.create({
    data: {
      usuarioId: user.id,
      contaId: conta.id,
      role: 'ADMIN',
      status: 'ATIVO',
      lastAccessedAt: new Date(),
    },
  });

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();

  try {
    await authenticate(contextA, user);
    await authenticate(contextB, user);
    await authenticate(contextC, user);

    const originHeaders = {
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000/dashboard',
    };

    const logoutResponse = await contextA.request.post('/api/auth/logout', { headers: originHeaders });
    expect(logoutResponse.status()).toBe(200);

    const versionAfterIndividualLogout = await prisma.usuario.findUniqueOrThrow({
      where: { id: user.id },
      select: { sessionVersion: true },
    });
    expect(versionAfterIndividualLogout.sessionVersion).toBe(0);

    await expect((await contextA.request.get('/api/auth/account-access')).status()).toBe(401);
    await expect((await contextB.request.get('/api/auth/account-access')).status()).toBe(200);

    const revokeResponse = await contextB.request.post('/api/auth/revoke-all-sessions', {
      headers: originHeaders,
    });
    expect(revokeResponse.status()).toBe(200);

    const versionAfterGlobalRevocation = await prisma.usuario.findUniqueOrThrow({
      where: { id: user.id },
      select: { sessionVersion: true },
    });
    expect(versionAfterGlobalRevocation.sessionVersion).toBe(1);

    await expect((await contextC.request.get('/api/auth/account-access')).status()).toBe(403);
    await expect((await contextB.request.get('/api/auth/account-access')).status()).toBe(401);
  } finally {
    await Promise.all([contextA.close(), contextB.close(), contextC.close()]);
    await prisma.conta.delete({ where: { id: conta.id } });
  }
});
