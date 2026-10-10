import { test, expect } from '@playwright/test';

test('tela de autenticação usa o contrato atual', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta!' })).toBeVisible();
  await expect(page.getByTestId('email')).toBeVisible();
  await expect(page.getByTestId('password')).toBeVisible();
  await expect(page.getByTestId('login-button')).toBeVisible();
});

test('navega entre páginas pelo App Router sem falha no fetch RSC', async ({ page }) => {
  const failedRscFetches: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error' && /Failed to fetch(?: RSC payload)?/i.test(message.text())) {
      failedRscFetches.push(message.text());
    }
  });

  await page.goto('/auth/login');
  await page.getByRole('link', { name: 'Cadastre-se' }).click();

  await expect(page).toHaveURL(/\/auth\/register$/);
  await expect(page.getByRole('heading', { name: 'Crie sua conta Alusa' })).toBeVisible();
  expect(failedRscFetches).toEqual([]);
});
