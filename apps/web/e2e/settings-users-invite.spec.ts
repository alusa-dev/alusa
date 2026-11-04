import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { seedAdminAndAuthenticate } from './utils/auth';

test.describe('Configurações - Usuários e Convites', () => {
  test('fluxo básico de convite (smoke)', async ({ page }) => {
    await seedAdminAndAuthenticate(page, { email: `invite-settings-${randomUUID()}@e2e.test` });
    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/admin\/settings\/users/);

    await expect(page.getByRole('heading', { name: 'Usuários e Convites' })).toBeVisible();

    const inviteEmail = `john-${randomUUID()}@example.test`;
    await page.getByRole('button', { name: 'Não encontrou? Convidar por e-mail' }).click();
    await page.getByRole('textbox', { name: 'E-mail do convidado' }).fill(inviteEmail);
    await page.getByRole('button', { name: 'Gerar convite' }).click();

    await expect(page.getByRole('heading', { name: 'Convite criado' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'link de convite' })).toHaveValue(/token=/);
    await page.getByRole('button', { name: 'fechar modal' }).click();
    await page.getByRole('tab', { name: 'Pendentes' }).click();
    await expect(page.getByText(inviteEmail)).toBeVisible();
  });
});
