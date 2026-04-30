import { test, expect, request as pwRequest } from '@playwright/test';

test('wizard de aceite de convite - duas etapas', async ({ page, baseURL }) => {
  // Cria um convite via rota de teste
  const r = await pwRequest.newContext();
  const uniqueEmail = `novo.user+e2e.${Date.now()}@example.com`;
  const res = await r.post(`${baseURL}/api/test/create-invite`, {
    data: { email: uniqueEmail, role: 'RECEPCAO' },
  });
  expect(res.ok()).toBeTruthy();
  const { token } = await res.json();

  // Abre página de aceite com token
  await page.goto(`/accept?token=${encodeURIComponent(token)}`);
  // Aguarda a validação do token: ou formulário de etapa 1, ou mensagem de erro
  const nameInput = page.getByTestId('accept-name');
  const errorMsg = page.getByTestId('accept-error');
  await Promise.race([
    nameInput.waitFor({ state: 'visible', timeout: 15000 }),
    errorMsg.waitFor({ state: 'visible', timeout: 15000 }),
  ]);
  if (await errorMsg.isVisible()) {
    const err = await errorMsg.textContent();
    throw new Error(`Falha na validação do convite: ${err || '(sem mensagem)'}`);
  }

  // Etapa 1: preencher nome e senha
  await page.getByTestId('accept-name').fill('Novo User');
  await page.getByTestId('accept-password').fill('Aa!23456');
  await page.getByTestId('accept-confirm').fill('Aa!23456');
  await page.getByTestId('accept-next').click();

  // Etapa 2: confirmação visível
  await expect(page.getByTestId('accept-confirm-step')).toBeVisible();

  // Confirmar e criar acesso
  await page.getByTestId('accept-submit').click();

  // Deve redirecionar para complete-profile
  await page.waitForURL('**/complete-profile');
  await expect(page.locator('[data-layer="form complete-profile"]')).toBeVisible();
});
