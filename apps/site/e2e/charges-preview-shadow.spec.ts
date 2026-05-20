import { expect, test } from '@playwright/test';

test('charges preview card uses layered shadow on financeiro section', async ({ page }) => {
  await page.goto('/#financeiro');
  const card = page.getByTestId('charges-preview-card');
  await expect(card).toBeVisible();

  const boxShadow = await card.evaluate((node) => getComputedStyle(node).boxShadow);
  expect(boxShadow).toContain('rgba(0, 0, 0, 0.07) 0px 1px 1px');
  expect(boxShadow).toContain('rgba(0, 0, 0, 0.07) 0px 16px 16px');
});
