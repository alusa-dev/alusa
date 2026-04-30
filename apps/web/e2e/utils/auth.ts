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

  return { contaId: conta.id };
}
