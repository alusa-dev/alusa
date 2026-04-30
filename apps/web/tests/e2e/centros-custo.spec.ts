import { test } from '@playwright/test';

// Este fluxo requer sessão autenticada e dados reais; manter skip para não quebrar CI sem ambiente.
test.describe.skip('Centros de Custo (fluxo completo)', () => {
  test('criar, editar e inativar centro; usar em lançamento', async ({ page }) => {
    await page.goto('/financeiro/centros-custo');
    await page.getByTestId('centro-novo').click();
    await page.getByTestId('centro-nome').fill('Centro E2E');
    await page.getByText('Misto').click();
    await page.getByTestId('centro-salvar').click();

    await page.getByTestId('centro-editar').first().click();
    await page.getByTestId('centro-nome').fill('Centro E2E Editado');
    await page.getByTestId('centro-salvar').click();

    await page.getByTestId('centro-inativar').first().click();

    // Extrato é read-only, não há mais "Novo lançamento" na tela
    await page.goto('/financeiro/extrato');
  });
});
