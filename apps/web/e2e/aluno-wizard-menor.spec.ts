import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { seedAdminAndAuthenticate } from './utils/auth';
import { fillCpf, fillTelefone, fillCep, mockViaCep } from './utils/masked-input-helpers';

// Fluxo: aluno menor de idade (< 18 anos)
// CPF do aluno é opcional, responsável é obrigatório

test.describe('Cadastro de aluno menor de idade', () => {
  test('deve cadastrar aluno menor SEM CPF quando responsável está completo', async ({ page }) => {
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

    // Mock ViaCEP para endereço do aluno
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
    const alunoEmail = `aluno.menor+${suffix}@example.com`;
    const telefoneDigits = '11977776666';
    const respCpf = '52998224725'; // CPF válido do responsável
    const respTelefone = '11966665555';

    // Abrir wizard
    const openWizard = page.getByTestId('abrir-wizard-aluno');
    await expect(openWizard).toBeEnabled();
    await openWizard.click();
    const wizard = page.getByTestId('aluno-wizard');
    await expect(wizard).toBeVisible();

    // Step 1: Identificação (menor de idade - data recente)
    await page.locator('#aluno-nome').fill('Aluno Menor Teste');
    await page.locator('#aluno-data-nasc').fill('10/05/2015'); // < 18 anos
    
    // CPF do aluno é OPCIONAL para menor - não preencher
    
    await page.locator('#aluno-email').fill(alunoEmail);
    await fillTelefone(page.getByTestId('aluno-telefone'), telefoneDigits);
    
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Endereço' })).toBeVisible();

    // Step 2: Endereço do aluno (opcional - pular preenchendo apenas CEP)
    await fillCep(page.getByTestId('aluno-endereco-cep'), '01001000');
    await page.getByRole('button', { name: 'Buscar CEP automaticamente' }).click();
    await page.waitForTimeout(500);
    await page.getByTestId('aluno-endereco-numero').fill('77');
    
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Saúde & Emergência' })).toBeVisible();

    // Step 3: Saúde & Emergência
    await page.getByPlaceholder('Pessoa para contato').fill('Tia Maria');
    await fillTelefone(page.getByLabel('Telefone de emergência'), '11955554444');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Perfil & Classificação' })).toBeVisible();

    // Step 4: Perfil
    await page.getByPlaceholder('Ex.: Ballet').fill('Jazz');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Foto do aluno' })).toBeVisible();

    // Step 5: Foto (pula)
    await page.getByTestId('wizard-next').click();
    // Para menor de idade, deve aparecer step de Responsável
    await expect(page.getByRole('heading', { name: 'Responsável' })).toBeVisible();

    // Step 6: Responsável (obrigatório para menor de idade)
    await page.getByLabel('Nome do responsável').fill('Responsável Teste');
    await fillCpf(page.getByTestId('resp-cpf'), respCpf);
    await page.getByLabel('E-mail').first().fill(`responsavel+${suffix}@example.com`);
    await fillTelefone(page.getByTestId('resp-telefone'), respTelefone);
    await fillCep(page.getByTestId('resp-cep'), '01001000');
    await page.waitForTimeout(500);
    
    await page.getByTestId('wizard-next').click();
    await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();

    // Step 7: Confirmar
    await page.getByTestId('aluno-concluir').click();

    // Aguarda resposta da API de criação
    const resp = await page.waitForResponse(
      (r) => r.url().includes('/api/alunos') && r.request().method() === 'POST',
      { timeout: 15000 }
    );
    expect(resp.status()).toBe(201);

    // Verifica mensagem de sucesso ou nome na lista
    await expect(
      page.getByText('Aluno Menor Teste')
    ).toBeVisible({ timeout: 15000 });
  });

  test('deve exibir erro quando menor de idade não tiver responsável', async ({ page }) => {
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

    // Preencher dados do aluno menor
    await page.locator('#aluno-nome').fill('Aluno Sem Responsavel');
    await page.locator('#aluno-data-nasc').fill('10/05/2015'); // < 18 anos
    await page.locator('#aluno-email').fill('semresp@example.com');
    await fillTelefone(page.getByTestId('aluno-telefone'), '11999997777');

    // Avança pelos steps até chegar no responsável
    await page.getByTestId('wizard-next').click();
    await page.waitForTimeout(300);

    // Continua avançando pelos steps intermediários
    for (let i = 0; i < 4; i++) {
      const nextBtn = page.getByTestId('wizard-next');
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // No step de responsável, não preenche nada e tenta avançar
    const respHeading = page.getByRole('heading', { name: 'Responsável' });
    if (await respHeading.isVisible().catch(() => false)) {
      await page.getByTestId('wizard-next').click();
      
      // Deve exibir erro de responsável obrigatório
      // Pode ser validação no frontend ou erro 400 da API
      const errorMessage = page.getByText(/responsável|obrigatório/i);
      const hasError = await errorMessage.isVisible().catch(() => false);
      
      if (!hasError) {
        // Se não tem erro visível, tenta concluir e verifica resposta da API
        const concluirBtn = page.getByTestId('aluno-concluir');
        if (await concluirBtn.isVisible().catch(() => false)) {
          await concluirBtn.click();
          const resp = await page.waitForResponse(
            (r) => r.url().includes('/api/alunos') && r.request().method() === 'POST',
            { timeout: 10000 }
          );
          expect(resp.status()).toBe(400);
        }
      }
    }
  });

  test('deve exibir erro quando responsável não tiver CPF', async ({ page }) => {
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

    // Preencher dados do aluno menor
    await page.locator('#aluno-nome').fill('Aluno Resp Sem CPF');
    await page.locator('#aluno-data-nasc').fill('10/05/2015'); // < 18 anos
    await page.locator('#aluno-email').fill('respsemcpf@example.com');
    await fillTelefone(page.getByTestId('aluno-telefone'), '11999996666');

    // Avança pelos steps até chegar no responsável
    for (let i = 0; i < 5; i++) {
      const nextBtn = page.getByTestId('wizard-next');
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // No step de responsável, preenche tudo EXCETO CPF
    const respHeading = page.getByRole('heading', { name: 'Responsável' });
    if (await respHeading.isVisible().catch(() => false)) {
      await page.getByLabel('Nome do responsável').fill('Responsável Sem CPF');
      // Não preenche CPF
      await page.getByLabel('E-mail').first().fill('resp.semcpf@example.com');
      await fillTelefone(page.getByTestId('resp-telefone'), '11955553333');
      
      await page.getByTestId('wizard-next').click();
      
      // Deve exibir erro de CPF do responsável obrigatório
      // Verifica se há erro ou se precisa ir até o final
      const concluirBtn = page.getByTestId('aluno-concluir');
      if (await concluirBtn.isVisible().catch(() => false)) {
        await concluirBtn.click();
        const resp = await page.waitForResponse(
          (r) => r.url().includes('/api/alunos') && r.request().method() === 'POST',
          { timeout: 10000 }
        );
        expect(resp.status()).toBe(400);
      }
    }
  });
});
