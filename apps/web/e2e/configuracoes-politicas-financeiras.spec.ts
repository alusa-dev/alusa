import { expect, test } from '@playwright/test';
import { seedAdminAndAuthenticate } from './utils/auth';

type PolicyResponse = {
  preset: 'FLEXIVEL' | 'CONTROLADA' | 'RESTRITIVA';
  debtScope: 'QUALQUER_COBRANCA_EM_ABERTO' | 'APENAS_VENCIDAS';
  overrideRoles: Array<'ADMIN' | 'FINANCEIRO' | 'RECEPCAO'>;
  summary: string;
  updatedAt: string | null;
};

const basePolicy: PolicyResponse = {
  preset: 'FLEXIVEL',
  debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
  overrideRoles: [],
  summary: 'Permite a rematrícula com alerta quando houver qualquer cobrança em aberto.',
  updatedAt: null,
};

async function openPoliciesPage(page: import('@playwright/test').Page, policy: PolicyResponse) {
  await seedAdminAndAuthenticate(page, {
    email: `financeiro-politicas-${Date.now()}@alusa.test`,
  });

  let currentPolicy = { ...policy };
  const putPayloads: Array<Omit<PolicyResponse, 'summary' | 'updatedAt'> & Partial<Pick<PolicyResponse, 'summary' | 'updatedAt'>>> = [];

  await page.route('**/api/configuracoes/politicas/financeiro', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ policy: currentPolicy }),
      });
      return;
    }

    if (method === 'PUT') {
      const incoming = (await route.request().postDataJSON()) as Omit<PolicyResponse, 'summary' | 'updatedAt'>;
      putPayloads.push(incoming);
      currentPolicy = {
        ...incoming,
        summary:
          incoming.preset === 'CONTROLADA'
            ? 'Exige autorização quando houver cobranças vencidas.'
            : incoming.preset === 'RESTRITIVA'
              ? 'Bloqueia a rematrícula quando houver cobranças vencidas ou situação financeira inconclusiva.'
              : 'Permite a rematrícula com alerta quando houver qualquer cobrança em aberto.',
        updatedAt: currentPolicy.updatedAt,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ policy: currentPolicy }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/admin/configuracoes/politicas');
  await expect(page.getByText('Políticas')).toBeVisible();

  return { putPayloads };
}

test.describe('Configurações > Políticas', () => {
  test('exibe a seção de rematrícula e atualiza o resumo conforme o preset', async ({ page }) => {
    await openPoliciesPage(page, basePolicy);

    await expect(page.getByTestId('policy-section-rematricula-trigger')).toBeVisible();
    await expect(page.getByTestId('financial-policy-live-summary')).toContainText('qualquer cobrança em aberto');

    await page.getByTestId('financial-policy-preset-restritiva').click();
    await expect(page.getByTestId('financial-policy-live-summary')).toContainText('situação financeira inconclusiva');
  });

  test('mostra autorizadores somente no preset controlado e salva o novo shape', async ({ page }) => {
    const { putPayloads } = await openPoliciesPage(page, basePolicy);

    await page.getByTestId('financial-policy-preset-controlada').click();
    await expect(page.getByTestId('financial-policy-override-role-admin')).toBeVisible();
    await page.getByTestId('financial-policy-override-role-admin').click();
    await page.getByRole('button', { name: 'Salvar regra' }).click();

    await expect.poll(() => putPayloads.length).toBe(1);
    await expect(putPayloads[0]).toMatchObject({
      preset: 'CONTROLADA',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
      overrideRoles: ['ADMIN'],
    });
  });

  test('oculta autorizadores fora do preset controlado', async ({ page }) => {
    await openPoliciesPage(page, {
      ...basePolicy,
      preset: 'CONTROLADA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: ['ADMIN', 'FINANCEIRO'],
      summary: 'Exige autorização quando houver cobranças vencidas.',
    });

    await expect(page.getByTestId('financial-policy-override-role-admin')).toBeVisible();
    await page.getByTestId('financial-policy-preset-flexivel').click();
    await expect(page.getByTestId('financial-policy-override-role-admin')).toBeHidden();
  });
});
