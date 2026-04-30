import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin123!';

async function login(page: Page) {
  await page.goto('/auth/login');
  await page.getByTestId('email').fill(ADMIN_EMAIL);
  await page.getByTestId('password').fill(ADMIN_PASSWORD);
  await page.getByTestId('login-button').click();
  await page.waitForURL('**/dashboard');
}

test.describe('Planos wizard', () => {
  test.skip('should create and list a new plano', async ({ page }) => {
    await login(page);

    await page.goto('/planos');
    await expect(page.getByRole('heading', { name: 'Planos' })).toBeVisible();

    const planName = `Plano Playwright ${Date.now()}`;

    await page.getByRole('button', { name: 'Novo plano' }).click();
    await expect(page.getByRole('dialog', { name: 'Novo plano' })).toBeVisible();

    await page.getByLabel('Nome do plano').fill(planName);
    await page.getByLabel('Descrição (opcional)').fill('Criado via e2e');
    await page.getByRole('combobox', { name: 'Periodicidade' }).click();
    await page.getByRole('option', { name: 'Mensal' }).click();
    await page.getByLabel('Valor (R$)').fill('123,45');
    await page.getByRole('button', { name: 'Próximo' }).click();
    await page.getByRole('button', { name: 'Próximo' }).click();
    await page.getByRole('button', { name: 'Salvar' }).click();

    await expect(page.getByText('Plano criado')).toBeVisible();
    await expect(page.getByRole('cell', { name: planName })).toBeVisible();
  });
});
