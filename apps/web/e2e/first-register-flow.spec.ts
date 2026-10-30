import { expect, test } from '@playwright/test';

test.describe('public self-service acquisition links', () => {
  test('public CTAs open signup and product links stay on the landing page', async ({ page }) => {
    await page.goto('/');

    const signupLinks = page.getByRole('link', { name: 'Teste grátis por 14 dias' });
    await expect(signupLinks.first()).toHaveAttribute('href', '/auth/register');
    await expect(page.getByRole('link', { name: 'Conhecer a Alusa' }).nth(0)).toHaveAttribute('href', '#modulos');
    await expect(page.getByRole('link', { name: 'Conhecer a Alusa' }).nth(1)).toHaveAttribute('href', '#modulos');
    await expect(page.getByRole('link', { name: 'Conhecer a Alusa' }).nth(2)).toHaveAttribute('href', '#financeiro');
  });

  test('login links unaffiliated visitors to public registration', async ({ page }) => {
    await page.goto('/auth/login');

    await expect(page.getByRole('heading', { name: 'Bem-vindo de volta!' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clique aqui' })).toHaveAttribute('href', '/auth/register');
  });
});
