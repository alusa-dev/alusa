import { test, expect } from '@playwright/test';

test.describe('Configurações - Usuários e Convites', () => {
  test('fluxo básico de convite (smoke)', async ({ page }) => {
    // Pré-condição: usuário já autenticado (dependendo do projeto, trocar por helper de login)
    // Aqui navegamos direto para a rota de settings
    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/admin\/settings\/account/);

    await page.goto('/admin/settings/users');
    await expect(page.getByText('Usuários e Convites')).toBeVisible();

    await page.getByTestId('open-invite-modal').click();
    await page.getByTestId('invite-email').fill('john@example.com');
    await page.getByTestId('invite-role').selectOption('RECEPCAO');
    await page.getByTestId('invite-submit').click();

    // O toast pode ser checado conforme a lib em uso; aqui validamos presença na lista após um tempo
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('invite-list')).toBeVisible();
  });
});
