import { test, expect } from '@playwright/test';
import { seedAdminAndAuthenticate } from './utils/auth';

test.describe('Wizard Colaborador - fluxo completo', () => {
  test('cria colaborador via modal e lista na tabela', async ({ page }) => {
    const now = Date.now();
    const nome = `Teste E2E Colab ${now}`;
    const email = `colab+${now}@example.com`;
    const telefone = '(11) 98123-8125';
    const cep = '01311-000';

    await seedAdminAndAuthenticate(page, { email: `colaborador-modal-${now}@e2e.test` });
    await page.goto('/colaboradores');

    await page.getByRole('button', { name: 'Cadastrar colaborador' }).click();
    await expect(page.getByTestId('colaborador-wizard')).toBeVisible();

    // Etapa Identificação
    await page.fill('#colab-nome', nome);
    await page.fill('#colab-data-nasc', '30/12/1995');
    await page.fill('#colab-cpf', '111.444.777-35');
    await page.fill('#colab-email', email);
    await page.fill('#colab-telefone1', telefone);
    await page.getByTestId('wizard-next').click();

    // Etapa Endereço (CEP obrigatório)
    await page.fill('#colab-cep', cep);
    await page.fill('#colab-numero', '100');
    await expect(page.locator('#colab-uf')).toHaveValue('SP', { timeout: 10000 });
    await page.locator('#colab-uf').blur();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText('Etapa 3 de 5')).toBeVisible();

    // Avança pelas etapas restantes de forma determinística, aguardando a
    // transição do wizard antes de interagir novamente.
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText('Etapa 4 de 5')).toBeVisible();
    await page.getByTestId('wizard-next').click();

    // Etapa Confirmar (aguarda seção e botão ficarem visíveis)
    await expect(page.getByText('Etapa 5 de 5')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('wizard-confirmar')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('wizard-submit')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('wizard-submit').click();

    // Deve fechar modal e listar novo colaborador na tabela
    await expect(page.getByTestId('colaborador-wizard')).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(nome)).toBeVisible({ timeout: 20000 });
  });
});
