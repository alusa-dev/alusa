import { expect, test } from '@playwright/test';

test('the public registration route loads the school account creation form', async ({ page }) => {
  await page.goto('/register');

  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'Crie sua conta Alusa' })).toBeVisible();
  await expect(page.getByTestId('register-form')).toBeVisible();
  await expect(page.getByTestId('register-nome-first')).toBeVisible();
  await expect(page.getByTestId('register-nome-last')).toBeVisible();
  await expect(page.getByTestId('register-email')).toBeVisible();
  await expect(page.getByTestId('register-senha')).toBeVisible();
  await expect(page.getByTestId('register-senha-confirmar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar conta' })).toBeVisible();
});
