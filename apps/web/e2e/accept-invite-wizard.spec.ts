import { test, expect, request as pwRequest } from '@playwright/test';

async function acceptLegalTerms(page: import('@playwright/test').Page) {
  await page.getByTestId('register-termos-checkbox').click();
  await expect(page.getByTestId('legal-acceptance-inner-checkbox')).toBeVisible();
  await page.getByTestId('legal-acceptance-inner-checkbox').click();
  await page.getByTestId('legal-acceptance-confirm').click();
}

test('aceite de convite no cadastro consolidado', async ({ page, baseURL }) => {
  // Cria um convite via rota de teste
  const r = await pwRequest.newContext();
  const uniqueEmail = `novo.user+e2e.${Date.now()}@example.com`;
  const res = await r.post(`${baseURL}/api/test/create-invite`, {
    data: { email: uniqueEmail, role: 'RECEPCAO' },
  });
  expect(res.ok()).toBeTruthy();
  const { token } = await res.json();

  // A rota compatível /accept valida o token e redireciona para o cadastro.
  await page.goto(`/accept?token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId('register-form')).toBeVisible();
  const errorMsg = page.getByTestId('accept-error');
  if (await errorMsg.isVisible()) {
    const err = await errorMsg.textContent();
    throw new Error(`Falha na validação do convite: ${err || '(sem mensagem)'}`);
  }

  await page.getByTestId('register-nome-first').fill('Novo');
  await page.getByTestId('register-nome-last').fill('User');
  await page.getByTestId('register-senha').fill('Aa!23456');
  await page.getByTestId('register-senha-confirmar').fill('Aa!23456');
  await acceptLegalTerms(page);
  await page.getByTestId('register-submit').click();

  // O link pessoal do convite confirma o e-mail vinculado e concede acesso
  // assim que a pessoa define a senha do contexto convidado.
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
});
