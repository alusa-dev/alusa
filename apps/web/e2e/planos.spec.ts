import { test, expect } from '@playwright/test';
import { login } from './utils/login';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin123!';

test.describe('Planos - CRUD sem travamentos', () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshot = await page.screenshot({ fullPage: true });
      await testInfo.attach('planos-failure', {
        body: screenshot,
        contentType: 'image/png',
      });
    }
  });

  test('criar → editar → inativar sem travamentos', async ({ page }) => {
    const planoNome = `Plano E2E ${Date.now()}`;

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const cadastroGroup = page.getByTestId('sidebar-group-cadastro');
    await expect(cadastroGroup).toBeVisible({ timeout: 15000 });
    const isGroupOpen = await cadastroGroup.getAttribute('aria-expanded');
    if (isGroupOpen !== 'true') {
      await cadastroGroup.click();
    }

    await page.getByTestId('sidebar-planos').click();
    await expect(page).toHaveURL(/\/planos$/);

    await expect(page.getByTestId('planos-table')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('novo-plano')).toBeEnabled({ timeout: 15000 });

    // 1. CRIAR PLANO
    await page.getByTestId('novo-plano').click();

    const wizard = page.getByTestId('planos-wizard');
    await expect(wizard).toBeVisible();

    await page.getByTestId('plano-nome').fill(planoNome);
    await page
      .getByTestId('plano-descricao')
      .fill('Plano criado automaticamente pelos testes E2E.');
    await page.getByTestId('wizard-next').click();

    await page.getByTestId('plano-periodicidade-trigger').click();
    await page.getByTestId('plano-periodicidade-option-MENSAL').click();
    const valorInput = page.getByTestId('plano-valor');
    await valorInput.fill('');
    await valorInput.type('199.90');
    await page.getByTestId('wizard-next').click();

    await page.getByTestId('salvar-plano').click();

    await expect
      .poll(async () => page.getByTestId('toast-success').count(), {
        timeout: 15000,
        intervals: [250, 500, 750],
      })
      .toBeGreaterThan(0);

    // Verificar que o plano apareceu na tabela com key estável
    const planoRow = page.locator(`[data-plan-name="${planoNome}"]`);
    await expect
      .poll(async () => planoRow.count(), {
        timeout: 20000,
        intervals: [500, 750, 1000],
      })
      .toBeGreaterThan(0);

    // 2. EDITAR PLANO
    await planoRow.locator('button[aria-label="Editar plano"]').click();
    await expect(wizard).toBeVisible();

    await page.getByTestId('plano-descricao').fill('Editado via E2E test');
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('salvar-plano').click();

    // Verificar toast de sucesso na edição
    await expect
      .poll(async () => page.getByTestId('toast-success').count(), {
        timeout: 10000,
        intervals: [250, 500],
      })
      .toBeGreaterThan(0);

    // Verificar que ainda está na tabela
    await expect(planoRow).toBeVisible();

    // 3. INATIVAR PLANO
    await planoRow.locator('button[aria-label="Excluir plano"]').click();
    await expect(page.getByRole('dialog', { name: 'Inativar plano' })).toBeVisible();
    await page.getByRole('button', { name: 'Inativar' }).click();

    // Verificar toast de inativação
    await expect(page.getByText('Plano inativado')).toBeVisible({ timeout: 10000 });

    // Verificar que a página não travou - deve conseguir interagir normalmente
    await expect(page.getByTestId('novo-plano')).toBeEnabled();
  });
});
