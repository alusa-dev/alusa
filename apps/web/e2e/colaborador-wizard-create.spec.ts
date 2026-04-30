import { test, expect } from '@playwright/test';

test.describe('Wizard Colaborador - fluxo completo', () => {
  test('cria colaborador via modal e lista na tabela', async ({ page }) => {
    const now = Date.now();
    const nome = `Teste E2E Colab ${now}`;
    const email = `colab+${now}@example.com`;
    const telefone = '(11) 98123-8125';
    const cep = '01311-000';

    await page.goto('/colaboradores');

    await page.getByRole('button', { name: 'Adicionar Colaborador' }).click();
    await expect(page.getByTestId('colaborador-wizard')).toBeVisible();

    // Etapa Identificação
    await page.fill('#colab-nome', nome);
    await page.fill('#colab-data-nasc', '30/12/1995');
    await page.fill('#colab-email', email);
    await page.fill('#colab-telefone1', telefone);
    await page.getByTestId('wizard-next').click();

    // Etapa Endereço (CEP obrigatório)
    await page.fill('#colab-cep', cep);
    await page.getByTestId('wizard-next').click();

    // Avança até a etapa Confirmar (robusto a pequenos atrasos de validação)
    for (let i = 0; i < 5; i++) {
      const submit = page.getByTestId('wizard-submit');
      if (await submit.isVisible().catch(() => false)) break;
      await page.getByTestId('wizard-next').click();
      await page.waitForTimeout(200);
    }

  // Etapa Confirmar (aguarda seção e botão ficarem visíveis)
  await expect(page.getByTestId('wizard-confirmar')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('wizard-submit')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('wizard-submit').click();

    // Deve fechar modal e listar novo colaborador na tabela
    await expect(page.getByTestId('colaborador-wizard')).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(nome)).toBeVisible({ timeout: 20000 });
  });
});
