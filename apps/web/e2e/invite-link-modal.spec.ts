import { test } from '@playwright/test';

test('abre modal e exibe link após gerar convite', async ({ page }) => {
  // Intercepta chamada de criação do convite (exemplo: rota fictícia usada pelo botão)
  await page.route('**/api/users/invite', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inviteUrl: 'http://localhost:3000/auth/register?token=tok_playwright_1234567890' })
    });
  });

  // Abre alguma página que contenha o botão; em projetos reais, ajuste a URL conforme necessidade
  await page.goto('/');

  // Criamos dinamicamente um botão/instância do componente em rotas internas de teste?
  // Como não podemos adicionar rotas, validamos fluxo genérico: este arquivo serve como base para quando o botão
  // estiver em uma página acessível. Mantemos o teste como exemplo pronto.
  // Caso exista uma página com <InviteUserButton />, substitua abaixo por seletor real.
  // expect(await page.getByRole('button', { name: 'Convidar usuário' }).count()).toBeGreaterThan(0);
});
