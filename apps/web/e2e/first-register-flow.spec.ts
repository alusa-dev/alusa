import { expect, test } from '@playwright/test';

test.describe('public pilot acquisition links', () => {
  test('acquisition CTAs open the waitlist and product links stay on the landing page', async ({ page }) => {
    await page.goto('/');

    const waitlistLinks = page.getByRole('link', { name: 'Entre na lista de espera' });
    await expect(waitlistLinks.first()).toHaveAttribute('href', '/lista-de-espera');
    await expect(page.getByRole('link', { name: 'Conhecer a Alusa' }).nth(0)).toHaveAttribute('href', '#modulos');
    await expect(page.getByRole('link', { name: 'Conhecer a Alusa' }).nth(1)).toHaveAttribute('href', '#modulos');
    await expect(page.getByRole('link', { name: 'Conhecer a Alusa' }).nth(2)).toHaveAttribute('href', '#financeiro');
  });

  test('login offers contact instead of public registration', async ({ page }) => {
    await page.goto('/auth/login');

    await expect(page.getByRole('heading', { name: 'Bem-vindo de volta!' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fale conosco' })).toHaveAttribute('href', 'mailto:gestao.alusa@gmail.com');
  });
});
