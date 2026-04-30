import { test, expect } from '@playwright/test';

test('Fluxo visual de rematrícula', async ({ page }) => {
  await page.goto('http://localhost:3001/rematriculas');
  // Aguarda a lista de matrículas elegíveis
  await expect(page.getByText('Rematricular')).toBeVisible();

  // Abre o dialog de rematrícula
  await page.getByText('Rematricular').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Preenche campos obrigatórios
  await page.getByLabel('Data de início').fill('2025-12-01');
  await page.getByLabel('Término do contrato').fill('2026-12-01');
  await page.getByLabel('Dia de vencimento').fill('5');
  await page.getByLabel('Valor da taxa (R$)').fill('100');
  await page.getByLabel('Multa (%)').fill('2');
  await page.getByLabel('Juros mensais (%)').fill('1');
  await page.getByLabel('Desconto (%)').fill('10');
  await page.getByLabel('Dias antes do vencimento').fill('5');

  // Confirma rematrícula
  await page.getByRole('button', { name: 'Confirmar rematrícula' }).click();

  // Valida toast de sucesso
  await expect(page.getByText('Rematrícula criada')).toBeVisible();
});
