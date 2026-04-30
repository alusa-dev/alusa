import { test, expect } from '@playwright/test';

test.describe('Minha Conta', () => {
  test('editar nome e telefone e refletir no perfil', async ({ page, request }) => {
    // Em E2E com TEST_ROUTES_ENABLED=true o middleware não exige login e a API /api/users/me usa fallback admin
    // a) Ir direto para /conta
    await page.goto('/conta');
    await expect(page.getByRole('heading', { name: /minha conta/i })).toBeVisible();

  // c) Aguardar inputs carregarem e editar nome e telefone
    const novoNome = `Teste QA ${Date.now()}`;
    const novoTel = '(11) 98888-0000';
  const nomeInput = page.getByLabel('Nome');
  const telInput = page.getByLabel('Telefone');
  await expect(nomeInput).toBeVisible();
  await expect(telInput).toBeVisible();
  await nomeInput.click();
  await nomeInput.fill(novoNome);
  await telInput.click();
  await telInput.fill(novoTel);

    // d) Salvar e aguardar toast de sucesso
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/perfil atualizado/i)).toBeVisible();

    // e) Validar via GET /api/users/me com expect.poll
    await expect.poll(async () => {
      const res = await request.get('/api/users/me');
      const json = await res.json();
      return `${json.name}|${json.telefone}`;
    }, { intervals: [250, 500, 800], timeout: 5000 }).toBe(`${novoNome}|${novoTel.replace(/\D/g, '')}`);
  });
});
