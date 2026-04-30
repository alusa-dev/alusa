import { test, expect } from '@playwright/test';

// Pré-condição: servidor em execução e usuário autenticado (se auth ativa). Caso contrário, adaptar com fluxo de login.

test('Fluxo criar turma via wizard e aparecer na lista', async ({ page }) => {
  await page.goto('/turmas');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /Nova turma/i }).click();
  // Step 1 básicos
  await page.getByLabel(/Nome/i).fill('Turma E2E');
  // Selecionar primeira modalidade
  const modalidadeTrigger = page.locator('div').filter({ hasText: 'Modalidade' }).locator('button');
  if (await modalidadeTrigger.count()) {
    await modalidadeTrigger.first().click();
    const item = page.locator('[role="option"]').first();
    if (await item.count()) await item.click();
  }
  // Sala
  const salaTrigger = page.locator('div').filter({ hasText: 'Sala' }).locator('button');
  if (await salaTrigger.count()) {
    await salaTrigger.first().click();
    const itemSala = page.locator('[role="option"]').first();
    if (await itemSala.count()) await itemSala.click();
  }
  await page.getByRole('button', { name: /Próximo/i }).click();
  // Step agenda - selecionar dias (inclui domingo)
  await page.getByRole('button', { name: 'SEG' }).click();
  await page.getByRole('button', { name: 'DOM' }).click();
  const horaInicio = page.getByPlaceholder('08:00');
  await horaInicio.fill('14:00');
  const horaFim = page.getByPlaceholder('09:00');
  await horaFim.fill('15:00');
  await page.getByRole('button', { name: /Próximo/i }).click();
  // Step restrições
  await page.getByRole('button', { name: /Próximo/i }).click();
  // Step professores (opcional)
  await page.getByRole('button', { name: /Próximo/i }).click();
  // Resumo -> concluir
  await page.getByRole('button', { name: /Concluir/i }).click();
  // Fechou dialog -> esperar recarregar
  await page.waitForTimeout(1500);
  // Verificar presença na lista e atributo de conta
  await expect(page.locator('text=Turma E2E')).toBeVisible();
  const contaAttr = await page.locator('[data-conta]').first().getAttribute('data-conta');
  expect(contaAttr).toBeTruthy();
});
