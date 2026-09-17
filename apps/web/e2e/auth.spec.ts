import { test, expect } from '@playwright/test';

test('tela de autenticação usa o contrato atual', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta!' })).toBeVisible();
  await expect(page.getByTestId('email')).toBeVisible();
  await expect(page.getByTestId('password')).toBeVisible();
  await expect(page.getByTestId('login-button')).toBeVisible();
});
