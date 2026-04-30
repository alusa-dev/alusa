import { test, expect } from '@playwright/test';

// Testa fluxo de login e proteção das rotas públicas quando autenticado

test('login -> dashboard e bloqueio de retorno ao /login', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Digite seu E-mail').fill(process.env.E2E_EMAIL || 'admin@example.com');
  await page.getByPlaceholder('Digite sua senha').fill(process.env.E2E_PASSWORD || 'SenhaFort3!');
  await page.getByRole('button', { name: /fazer login/i }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.locator('[data-testid="dashboard-header"]')).toContainText('Olá');
  // tentar voltar para login
  await page.goto('/login');
  // Deve redirecionar de novo para dashboard (guard SSR faz redirect server-side)
  await expect(page).toHaveURL(/\/dashboard$/);
});
