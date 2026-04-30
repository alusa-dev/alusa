import { expect, type Page } from '@playwright/test';

export async function login(page: Page, email = 'aluno@example.com', password = 'senha123') {
  await page.goto('/auth/login');
  await expect(page.getByTestId('email')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 15000 }),
    page.getByTestId('login-button').click(),
  ]);
}
