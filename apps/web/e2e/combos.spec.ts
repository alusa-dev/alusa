import { test, expect } from '@playwright/test';

// Placeholder: ajustar seletores após estabilizar UI.
test.skip('fluxo básico de combos (create/edit/delete)', async ({ page }) => {
  await page.goto('/login');
  // Assumindo helper de login test user
  // await login(page);
  await page.goto('/combos');
  await expect(page.getByRole('heading', { name: 'Combos' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo combo' }).click();
  await page.getByLabel('Nome').fill('Combo Teste');
  await page.getByLabel('Valor mensal (R$)').fill('100');
  await page.getByRole('button', { name: 'Salvar combo' }).click();
  await expect(page.getByText('Combo Teste')).toBeVisible();
});
