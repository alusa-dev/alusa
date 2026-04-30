import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetDb } from './utils/reset-db';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function waitSession(page: Page) {
  await expect.poll(async () => {
    const resp = await page.request.get('/api/auth/session');
    if (!resp.ok()) return false;
  const json = (await resp.json()) as { user?: { email?: string } };
  return Boolean(json.user?.email);
  }, { timeout: 10_000 }).toBe(true);
}

test.describe('First Register', () => {
  test.beforeEach(async () => { await resetDb(prisma); });

  test('Primeiro registro cria Admin', async ({ page }) => {
  await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola First');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Primeiro Admin');
    await page.fill('[data-testid="register-email"]', 'primeiro@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    await waitSession(page);
    await expect(page.locator('[data-testid="dashboard-header"]')).toContainText('Primeiro Admin');
    await expect(page.locator('[data-testid="dashboard-header"]')).toContainText('ADMIN');
  });

  test('Login subsequente com mesmo Admin', async ({ page }) => {
    // seed via registro
  await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola First');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Primeiro Admin');
    await page.fill('[data-testid="register-email"]', 'primeiro@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    await waitSession(page);
    await page.context().clearCookies();
  await page.goto('/login');
    await page.fill('[data-testid="login-email"]', 'primeiro@example.com');
    await page.fill('[data-testid="login-password"]', 'SenhaFort3!');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard');
    await waitSession(page);
    await expect(page.locator('[data-testid="dashboard-header"]')).toContainText('Primeiro Admin');
  });

  test('Tentativa de segundo registro bloqueada', async ({ page }) => {
    // criar primeiro
  await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola First');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Primeiro Admin');
    await page.fill('[data-testid="register-email"]', 'primeiro@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    await waitSession(page);
    await page.context().clearCookies();
    // segundo
  await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Outra Escola');
    await page.fill('[data-testid="register-cpfCnpj"]', '98765432100');
    await page.fill('[data-testid="register-nome"]', 'Segundo');
    await page.fill('[data-testid="register-email"]', 'segundo@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await expect(page.locator('[data-testid="register-error"]')).toContainText('Registro desabilitado, use convite');
  });

  test('Senha inválida mostra erro de política', async ({ page }) => {
  await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola Weak');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Primeiro Admin');
    await page.fill('[data-testid="register-email"]', 'primeiro@example.com');
    // senha sem especial
    await page.fill('[data-testid="register-senha"]', 'SenhaFraca1');
    await page.click('[data-testid="register-submit"]');
    await expect(page.locator('[data-testid="password-error"]')).toContainText('Senha deve ter no mínimo 8 caracteres');
  });
});
