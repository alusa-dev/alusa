import { test, expect, type Page } from '@playwright/test';
import prisma from './prisma';
import { resetDb } from './utils/reset-db';

async function acceptLegalTerms(page: Page) {
  await page.getByTestId('register-termos-checkbox').click();
  await page.getByTestId('legal-acceptance-inner-checkbox').click();
  await page.getByTestId('legal-acceptance-confirm').click();
}

async function register(page: Page, email: string, firstName: string, lastName: string) {
  await page.goto('/register');
  await page.getByTestId('register-nome-first').fill(firstName);
  await page.getByTestId('register-nome-last').fill(lastName);
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-senha').fill('SenhaFort3!');
  await page.getByTestId('register-senha-confirmar').fill('SenhaFort3!');
  await acceptLegalTerms(page);
  await page.getByTestId('register-submit').click();
  await page.waitForURL('**/auth/confirm-email?callbackUrl=%2Ffinance%2Fwizard');
}

test.describe('First User', () => {
  test.beforeEach(async () => { await resetDb(prisma); });

  test.afterAll(async () => { await prisma.$disconnect(); });

  test('Registro inicial cria ADMIN e inicia confirmação de e-mail', async ({ page }) => {
    await register(page, 'admin-first@example.com', 'Admin', 'Root');
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    await expect(prisma.usuario.findFirst({
      where: { email: 'admin-first@example.com' },
      select: { nome: true, role: true },
    })).resolves.toEqual({ nome: 'Admin Root', role: 'ADMIN' });
  });

  test('Erro de e-mail duplicado preserva a mensagem do contrato atual', async ({ page }) => {
    await register(page, 'admin-duplicate@example.com', 'Admin', 'Root');
    await page.context().clearCookies();
    await page.goto('/register');
    await page.getByTestId('register-nome-first').fill('Outro');
    await page.getByTestId('register-nome-last').fill('Admin');
    await page.getByTestId('register-email').fill('admin-duplicate@example.com');
    await page.getByTestId('register-senha').fill('SenhaFort3!');
    await page.getByTestId('register-senha-confirmar').fill('SenhaFort3!');
    await acceptLegalTerms(page);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-error')).toContainText('E-mail já está em uso.');
  });
});
