import { test, expect } from '@playwright/test';
import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test.afterAll(async () => { await prisma.$disconnect(); });

// Testa fluxo de login e proteção das rotas públicas quando autenticado

test('login -> dashboard e bloqueio de retorno ao /login', async ({ page }) => {
  await resetDb(prisma);
  await seedAdminAndAuthenticate(page, { email: 'login-redirect@example.com' });
  await page.goto('/dashboard');
  await expect(page.getByText('Que bom ter você por aqui!')).toBeVisible();
  // tentar voltar para login
  await page.goto('/auth/login');
  // Deve redirecionar de novo para dashboard (guard SSR faz redirect server-side)
  await expect(page).toHaveURL(/\/dashboard$/);
});
