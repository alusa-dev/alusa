import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetDb } from './utils/reset-db';

async function waitSession(page: Page) {
  await expect.poll(async () => {
    const resp = await page.request.get('/api/auth/session');
    if (!resp.ok()) return false;
    const json = await resp.json();
    return Boolean(json?.user?.email);
  }, { timeout: 10_000 }).toBe(true);
}

test.describe('First Register', () => {
  test.beforeEach(async () => {
    resetDb();
  });

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
    const header = page.locator('[data-testid="dashboard-header"]');
    await expect(header).toContainText('Primeiro Admin');
    await expect(header).toContainText('ADMIN');
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
    // signOut limpando cookies
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
    // criar primeiro admin
  await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola First');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Primeiro Admin');
    await page.fill('[data-testid="register-email"]', 'primeiro@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    await waitSession(page);
    // tentar segundo
    await page.context().clearCookies();
  await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Outra Escola');
    await page.fill('[data-testid="register-cpfCnpj"]', '98765432100');
    await page.fill('[data-testid="register-nome"]', 'Segundo');
    await page.fill('[data-testid="register-email"]', 'segundo@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    // Como backend redireciona para login (409) tratamos exibindo erro - precisamos de mensagem; fallback: redireciono
  await page.waitForURL('**/login');
  });
});
