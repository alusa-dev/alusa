import { test, expect } from '@playwright/test';

test('home loads', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /sua escola pode ser mais simples de administrar/i }),
  ).toBeVisible();
});
