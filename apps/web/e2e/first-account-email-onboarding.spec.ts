import { expect, test } from '@playwright/test';

test.describe('cadastro público durante o piloto assistido', () => {
  test('encaminha acesso sem convite para a lista de espera', async ({ page }) => {
    await page.goto('/auth/register');

    await expect(page).toHaveURL(/\/lista-de-espera$/);
    await expect(page.getByRole('heading', { name: /lista de espera/i })).toBeVisible();
  });
});
