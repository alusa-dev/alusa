import type { Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';

const prisma = new PrismaClient();

function uniqueCpfCnpj(): string {
  const last14 = String(Date.now()).slice(-14);
  return last14.padStart(14, '0');
}

export async function seedAdminAndAuthenticate(page: Page, params: { email: string }) {
  const conta = await prisma.conta.create({
    data: {
      id: randomUUID(),
      nome: 'Escola E2E',
      cpfCnpj: uniqueCpfCnpj(),
    },
    select: { id: true },
  });

  // The application enforces platform-billing access for write capabilities.
  // Keep the generic tenant fixture in a valid, non-expired trial state so
  // business-flow tests exercise their own behavior instead of being stopped
  // by the commercial access gate.
  await prisma.platformBillingAccount.create({
    data: {
      contaId: conta.id,
      environment: 'TEST',
      status: 'TRIALING',
      planCode: 'STARTER',
      accessStatus: 'ACTIVE',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      paymentMethodStatus: 'UNKNOWN',
    },
  });

  const user = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Admin E2E',
      email: params.email,
      senhaHash: 'hash_nao_usado_no_e2e',
      role: 'ADMIN',
      status: 'ATIVO',
    },
    select: { id: true },
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

  await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: user.id } });

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente no ambiente de teste');

  const token = await encode({
    secret,
    token: {
      id: user.id,
      email: params.email,
      name: 'Admin E2E',
      role: 'ADMIN',
      contaId: conta.id,
      sessionVersion: 0,
    },
  });

  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await page.goto('/api/auth/session');

  // Warm the billing policy endpoint before navigating to a feature page. This
  // keeps the fixture's commercial access state explicit and avoids making
  // feature assertions depend on the first read-model request.
  const billingResponse = await page.request.get('/api/platform-billing/summary');
  if (!billingResponse.ok()) {
    throw new Error(`Falha ao preparar billing E2E: HTTP ${billingResponse.status()}`);
  }

  return { contaId: conta.id };
}
