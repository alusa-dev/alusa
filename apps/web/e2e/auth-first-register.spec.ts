import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

async function acceptLegalTerms(page: Page) {
  await page.getByTestId('register-termos-checkbox').click();
  await page.getByTestId('legal-acceptance-inner-checkbox').click();
  await page.getByTestId('legal-acceptance-confirm').click();
}

async function registerAccount(page: Page, input: { email: string; firstName: string; lastName: string }) {
  await page.goto('/register');
  await page.getByTestId('register-nome-first').fill(input.firstName);
  await page.getByTestId('register-nome-last').fill(input.lastName);
  await page.getByTestId('register-email').fill(input.email);
  await page.getByTestId('register-senha').fill('SenhaFort3!');
  await page.getByTestId('register-senha-confirmar').fill('SenhaFort3!');
  await acceptLegalTerms(page);
  await page.getByTestId('register-submit').click();
  await page.waitForURL('**/auth/confirm-email?callbackUrl=%2Ffinance%2Fwizard');
}

test.describe('First Register', () => {
  test.beforeEach(async () => { await resetDb(prisma); });

  test.afterAll(async () => { await prisma.$disconnect(); });

  test('Primeiro registro cria um ADMIN e inicia a confirmação de e-mail', async ({ page }) => {
    const email = 'primeiro@example.com';
    await registerAccount(page, { email, firstName: 'Primeiro', lastName: 'Admin' });

    const user = await prisma.usuario.findFirst({
      where: { email },
      select: { nome: true, role: true },
    });
    expect(user).toEqual({ nome: 'Primeiro Admin', role: 'ADMIN' });
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
  });

  test('Login subsequente exige confirmação de e-mail', async ({ page }) => {
    await registerAccount(page, { email: 'primeiro@example.com', firstName: 'Primeiro', lastName: 'Admin' });
    await page.context().clearCookies();
    await page.goto('/auth/login');
    await page.getByTestId('email').fill('primeiro@example.com');
    await page.getByTestId('password').fill('SenhaFort3!');
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('Novo cadastro usa o fluxo público atual e cria outra conta', async ({ page }) => {
    await registerAccount(page, { email: 'primeiro@example.com', firstName: 'Primeiro', lastName: 'Admin' });
    await page.context().clearCookies();
    await registerAccount(page, { email: 'segundo@example.com', firstName: 'Segundo', lastName: 'Admin' });

    const users = await prisma.usuario.findMany({
      where: { email: { in: ['primeiro@example.com', 'segundo@example.com'] } },
      select: { email: true, role: true },
      orderBy: { email: 'asc' },
    });
    expect(users).toEqual([
      { email: 'primeiro@example.com', role: 'ADMIN' },
      { email: 'segundo@example.com', role: 'ADMIN' },
    ]);
  });
});
