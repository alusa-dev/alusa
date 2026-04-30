import { test, expect, type Page } from '@playwright/test';

// E2E básico: login e navegação até /financeiro/pagamentos

test.describe('Financeiro - Pagamentos', () => {
  test('lista de pagamentos renderiza elementos principais', async ({ page }) => {
    await registerAndLogin(page);
    await page.goto('/financeiro/pagamentos');
    await expect(page.getByRole('heading', { name: 'Pagamentos' })).toBeVisible();
    await expect(page.getByPlaceholder('Buscar por nome do aluno...')).toBeVisible();
    await expect(page.getByText('Nenhum aluno com pagamentos encontrado')).toBeVisible();
  });
});

async function registerAndLogin(page: Page) {
  await page.goto('/auth/register');
  await expect(page.getByTestId('register-form')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('register-nome-first').fill('Admin');
  await page.getByTestId('register-nome-last').fill('E2E');
  const uniqueEmail = `admin-e2e+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.getByTestId('register-email').fill(uniqueEmail);
  await page.getByTestId('register-senha').fill('SenhaFort3!');
  await page.getByTestId('register-senha-confirmar').fill('SenhaFort3!');
  await page.locator('input[type="checkbox"]').first().check();
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 15000 }),
    page.getByTestId('register-submit').click(),
  ]);

  const sessionOk = await hasSession(page);
  if (!sessionOk) {
    await loginWith(page, uniqueEmail, 'SenhaFort3!');
  }
}

async function loginWith(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 15000 }),
    page.getByTestId('login-button').click(),
  ]);
}

async function hasSession(page: Page) {
  const resp = await page.request.get('/api/auth/session');
  if (!resp.ok()) return false;
  const data = (await resp.json().catch(() => null)) as { user?: { email?: string } } | null;
  return Boolean(data?.user?.email);
}
