import { expect, test } from '@playwright/test';

test('the legacy public registration alias routes visitors to the waitlist', async ({ page }) => {
  await page.goto('/register');

  await expect(page).toHaveURL(/\/lista-de-espera$/);
  await expect(page.getByRole('heading', { name: /lista de espera/i })).toBeVisible();
});
