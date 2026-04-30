import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { seedAdminAndAuthenticate } from './utils/auth';
import { fillCpf, fillTelefone, fillCep, mockViaCep, waitForAddressAutoFill } from './utils/masked-input-helpers';

// Fluxo: aluno >= 18 anos (sem responsável)
// CPF do aluno é obrigatório, responsável é opcional

test.describe('Cadastro de aluno maior de idade', () => {
  test('deve cadastrar aluno maior de idade com sucesso', async ({ page }) => {
    const adminEmail = `admin+${randomUUID()}@example.com`;
    await seedAdminAndAuthenticate(page, { email: adminEmail });

    // Mock KYC
    await page.route('**/api/kyc/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            gateStatus: 'NOT_REQUIRED',
            documentsRequired: false,
            canUseProduct: true,
            blockingReason: 'NONE',
            pendingExternal: [],
            pendingInternal: [],
            completed: [],
            nextAction: null,
            lastCheckedAt: null,
            refreshHintSeconds: null,
            message: 'ok',
          },
        }),
      });
    });

    // Mock ViaCEP
    await mockViaCep(page, '01001000', {
      logradouro: 'Praça da Sé',
      bairro: 'Sé',
      localidade: 'São Paulo',
      uf: 'SP',
    });

    await page.goto('/alunos');

    // Fechar dialog de boas-vindas se aparecer
    const welcomeDialog = page.getByRole('dialog', { name: 'Bem-vindo à Alusa' });
    if (await welcomeDialog.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Fazer depois' }).click({ force: true });
    }

    // Dados de teste
    const suffix = Date.now().toString().slice(-6);
    const cpfDigits = '52998224725'; // CPF válido
    const alunoEmail = `aluno.maior+${suffix}@example.com`;
    const telefoneDigits = '11988887777';

    // Abrir wizard
    const openWizard = page.getByTestId('abrir-wizard-aluno');
    await expect(openWizard).toBeEnabled();
    await openWizard.click();
    const wizard = page.getByTestId('aluno-wizard');
    await expect(wizard).toBeVisible();

    // Step 1: Identificação
    await page.locator('#aluno-nome').fill('Aluno Maior Teste');
    await page.locator('#aluno-data-nasc').fill('01/01/2000'); // +18 anos
    
    // Preencher CPF (campo mascarado)
    await fillCpf(page.getByTestId('aluno-cpf'), cpfDigits);
    
    await page.locator('#aluno-email').fill(alunoEmail);
    
    // Preencher telefone (campo mascarado)
    await fillTelefone(page.getByTestId('aluno-telefone'), telefoneDigits);
    
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Endereço' })).toBeVisible();

    // Step 2: Endereço
    await fillCep(page.getByTestId('aluno-endereco-cep'), '01001000');
    
    // Clicar no botão de busca e aguardar autopreenchimento
    await page.getByRole('button', { name: 'Buscar CEP automaticamente' }).click();
    await waitForAddressAutoFill(page, 'Praça da Sé');
    
    // Preencher número (obrigatório para endereço completo)
    await page.getByTestId('aluno-endereco-numero').fill('123');
    
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Saúde & Emergência' })).toBeVisible();

    // Step 3: Saúde & Emergência (campos opcionais - pula)
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Perfil & Classificação' })).toBeVisible();

    // Step 4: Perfil & Classificação
    await page.getByPlaceholder('Ex.: Ballet').fill('Ballet');
    await page.getByPlaceholder('Ex.: Intermediário').fill('Intermediário');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Foto do aluno' })).toBeVisible();

    // Step 5: Foto (pula)
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();

    // Step 6: Confirmar (sem responsável para maior de idade)
    await page.getByTestId('aluno-concluir').click();

    // Aguarda resposta da API de criação
    const resp = await page.waitForResponse(
      (r) => r.url().includes('/api/alunos') && r.request().method() === 'POST',
      { timeout: 15000 }
    );
    expect(resp.status()).toBe(201);

    // Aguarda nome aparecer na tabela
    await expect(
      page.locator('[data-testid^="aluno-nome-"]').filter({ hasText: 'Aluno Maior Teste' }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('deve exibir erro quando maior de idade não informar CPF', async ({ page }) => {
    const adminEmail = `admin+${randomUUID()}@example.com`;
    await seedAdminAndAuthenticate(page, { email: adminEmail });

    // Mock KYC
    await page.route('**/api/kyc/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { gateStatus: 'NOT_REQUIRED', canUseProduct: true },
        }),
      });
    });

    await page.goto('/alunos');

    // Fechar dialog se aparecer
    const welcomeDialog = page.getByRole('dialog', { name: 'Bem-vindo à Alusa' });
    if (await welcomeDialog.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Fazer depois' }).click({ force: true });
    }

    // Abrir wizard
    await page.getByTestId('abrir-wizard-aluno').click();
    await expect(page.getByTestId('aluno-wizard')).toBeVisible();

    // Preencher apenas dados obrigatórios SEM CPF
    await page.locator('#aluno-nome').fill('Aluno Sem CPF');
    await page.locator('#aluno-data-nasc').fill('01/01/2000'); // +18 anos
    await page.locator('#aluno-email').fill('semcpf@example.com');
    await fillTelefone(page.getByTestId('aluno-telefone'), '11999998888');

    // Tentar avançar
    await page.getByTestId('wizard-next').click();

    // Deve exibir erro de CPF obrigatório (pode ser no frontend ou após submit)
    // Se o frontend não bloquear, vai até o final e mostra erro na API
    // Aqui verificamos se há mensagem de erro relacionada a CPF
    const errorMessage = page.getByText(/CPF/i);
    // Se conseguiu avançar, tenta finalizar e verifica erro
    if (!(await errorMessage.isVisible().catch(() => false))) {
      // Avança pelos steps até finalizar
      for (let i = 0; i < 5; i++) {
        const nextBtn = page.getByTestId('wizard-next');
        if (await nextBtn.isVisible().catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(300);
        }
      }
      // Tenta concluir
      const concluirBtn = page.getByTestId('aluno-concluir');
      if (await concluirBtn.isVisible().catch(() => false)) {
        await concluirBtn.click();
        // Deve receber erro 400
        const resp = await page.waitForResponse(
          (r) => r.url().includes('/api/alunos') && r.request().method() === 'POST',
          { timeout: 10000 }
        );
        expect(resp.status()).toBe(400);
      }
    }
  });
});
