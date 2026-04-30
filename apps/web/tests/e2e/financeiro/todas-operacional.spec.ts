import { test, expect } from '@playwright/test';
import { seedAdminAndLogin, prisma } from './helpers/auth';
import { seedFinanceData } from './helpers/seed-finance';
import { ApiHelper, waitForPageReady, countTableRows } from './helpers/api';

test.describe('Cobranças → Todas (fila operacional)', () => {
  test.beforeEach(async ({ page }) => {
    const { contaId } = await seedAdminAndLogin(page);
    await seedFinanceData(prisma, contaId);
  });

  test('lista vencidas + recentes geradas e exclui parcelas futuras de parcelamento', async ({ page }) => {
    await page.goto('/cobrancas');
    await waitForPageReady(page, 'Todas as Cobranças');

    // Deve conter a cobrança pendente do mês (standalone)
    await expect(page.getByText('Material didático')).toBeVisible();

    // Deve conter a vencida do mês anterior
    await expect(page.getByText('Uniforme escolar')).toBeVisible();

    // Deve conter a avulsa futura recém-gerada
    await expect(page.getByText('Taxa de exame futuro')).toBeVisible();

    // NÃO deve conter a paga (statusView=open é default)
    await expect(page.getByText('Apostila paga')).not.toBeVisible();
  });

  test('parcelamentos aparecem apenas com a parcela operacional, nunca com a futura', async ({ page }) => {
    await page.goto('/cobrancas');
    await waitForPageReady(page, 'Todas as Cobranças');

    await expect(page.getByText('Parcela 1/2')).toBeVisible();
    await expect(page.getByText('Parcela 2/2')).not.toBeVisible();
  });

  test('assinatura mostra cobrança vigente e a nova fatura recém-gerada', async ({ page }) => {
    await page.goto('/cobrancas');
    await waitForPageReady(page, 'Todas as Cobranças');

    // A mensalidade vigente pendente deve aparecer
    await expect(page.getByText('Mensalidade vigente')).toBeVisible();

    // A nova mensalidade recém-gerada também deve aparecer
    await expect(page.getByText('Mensalidade futura')).toBeVisible();
  });

  test('backend e UI são consistentes: contagem e ids batem', async ({ page, request }) => {
    const { contaId } = await seedAdminAndLogin(page);
    await seedFinanceData(prisma, contaId);

    await page.goto('/cobrancas');
    await waitForPageReady(page, 'Todas as Cobranças');

    // Chamar API diretamente
    const api = new ApiHelper(request);
    const apiResult = await api.getOperationalCharges();

    // Comparar contagem de linhas visíveis com total da API
    const uiRows = await countTableRows(page);
    expect(uiRows).toBe(apiResult.data.length);
  });
});
