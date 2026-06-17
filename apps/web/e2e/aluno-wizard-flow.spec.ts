import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import {
  VALID_CPF,
  DEFAULT_ADDRESS,
  DEFAULT_CEP,
  advanceThroughOptionalSteps,
  clickConcluir,
  clickWizardNext,
  dismissWelcomeWizard,
  expectAlunoInList,
  expectWizardProgress,
  fillEnderecoAluno,
  fillIdentificacao,
  fillNovoResponsavel,
  mockKycRefresh,
  openAlunoWizard,
  selectResponsavelExistente,
  setupAlunoWizardTest,
  waitForAlunoCreateResponse,
  seedResponsavelForConta,
} from './helpers/aluno-wizard';
import { seedAdminAndAuthenticate } from './utils/auth';
import { fillTelefone, mockViaCep } from './utils/masked-input-helpers';

const prisma = new PrismaClient();

/**
 * Fluxo E2E — Wizard de Cadastro de Aluno
 *
 * Regras cobertas (alunoSchema + AlunoWizardDialog):
 * - Maior (≥18): CPF, e-mail e telefone obrigatórios; sem etapa Responsável (6 etapas).
 * - Menor (<18): CPF/e-mail/telefone do aluno opcionais; etapa Responsável obrigatória (7 etapas).
 * - Menor: responsável novo exige nome, CPF, e-mail, telefone e CEP.
 * - Menor: pode vincular responsável existente (modo "Escolher responsável").
 * - Endereço: CEP obrigatório em todas as idades.
 * - Saúde, perfil e foto são opcionais (avanço permitido).
 */

test.describe('Wizard de Cadastro de Aluno — fluxo completo', () => {
  test.describe.configure({ timeout: 90_000 });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('maior de idade: cadastro completo com 6 etapas e CPF obrigatório', async ({ page }) => {
    const suffix = Date.now().toString().slice(-6);

    await test.step('Preparar sessão e abrir wizard', async () => {
      await setupAlunoWizardTest(page);
      await openAlunoWizard(page);
      await expectWizardProgress(page, 1, 6);
    });

    await test.step('Identificação — campos obrigatórios para maior', async () => {
      await fillIdentificacao(page, {
        nome: 'Aluno Maior E2E',
        dataNasc: '01/01/2000',
        cpf: VALID_CPF,
        email: `aluno.maior+${suffix}@e2e.test`,
        telefone: '11988887777',
      });

      await expect(page.getByTestId('aluno-cpf')).toBeVisible();
      await expect(page.locator('#aluno-email')).toBeVisible();
      await expect(page.getByTestId('aluno-telefone')).toBeVisible();

      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Endereço' })).toBeVisible();
      await expectWizardProgress(page, 2, 6);
    });

    await test.step('Endereço — CEP obrigatório com autopreenchimento', async () => {
      await fillEnderecoAluno(page, { numero: '123' });
      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Saúde & Emergência' })).toBeVisible();
    });

    await test.step('Etapas opcionais: saúde, perfil e foto', async () => {
      await page.getByPlaceholder('Ex.: Ballet').fill('Ballet');
      await page.getByPlaceholder('Ex.: Intermediário').fill('Intermediário');
      await advanceThroughOptionalSteps(page);
      await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();
      await expectWizardProgress(page, 6, 6);
    });

    await test.step('Concluir e validar persistência', async () => {
      await clickConcluir(page);
      const { status } = await waitForAlunoCreateResponse(page);
      expect(status).toBe(201);
      await expectAlunoInList(page, 'Aluno Maior E2E');
    });
  });

  test('maior de idade: bloqueia avanço sem CPF na identificação', async ({ page }) => {
    await setupAlunoWizardTest(page);
    await openAlunoWizard(page);

    await fillIdentificacao(page, {
      nome: 'Aluno Sem CPF',
      dataNasc: '01/01/2000',
      email: 'semcpf@e2e.test',
      telefone: '11999998888',
    });

    await clickWizardNext(page);

    await expect(page.getByRole('heading', { name: 'Identificação' })).toBeVisible();
    await expect(page.getByText(/CPF obrigatório para maior de idade/i)).toBeVisible();
  });

  test('menor de idade: cadastro sem CPF do aluno com responsável novo', async ({ page }) => {
    const suffix = Date.now().toString().slice(-6);

    await test.step('Preparar sessão e abrir wizard', async () => {
      await setupAlunoWizardTest(page);
      await openAlunoWizard(page);
      await expectWizardProgress(page, 1, 7);
    });

    await test.step('Identificação — menor com contato opcional', async () => {
      await fillIdentificacao(page, {
        nome: 'Aluno Menor E2E',
        dataNasc: '10/05/2015',
        email: `aluno.menor+${suffix}@e2e.test`,
        telefone: '11977776666',
      });

      await expect(
        page.getByText(/CPF, e-mail e telefone do aluno são opcionais/i),
      ).toBeVisible();

      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Endereço' })).toBeVisible();
    });

    await test.step('Endereço e etapas intermediárias', async () => {
      await fillEnderecoAluno(page, { numero: '77' });
      await clickWizardNext(page);

      await page.getByPlaceholder('Pessoa para contato').fill('Tia Maria');
      await fillTelefone(page.getByLabel('Telefone de emergência'), '11955554444');
      await clickWizardNext(page);

      await page.getByPlaceholder('Ex.: Ballet').fill('Jazz');
      await clickWizardNext(page);
      await clickWizardNext(page);

      await expect(page.getByRole('heading', { name: 'Responsável' })).toBeVisible();
      await expectWizardProgress(page, 6, 7);
    });

    await test.step('Responsável novo — campos obrigatórios', async () => {
      await fillNovoResponsavel(page, {
        nome: 'Responsável Menor E2E',
        cpf: VALID_CPF,
        email: `responsavel+${suffix}@e2e.test`,
        telefone: '11966665555',
      });

      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();
    });

    await test.step('Concluir e validar persistência', async () => {
      await clickConcluir(page);
      const { status } = await waitForAlunoCreateResponse(page);
      expect(status).toBe(201);
      await expectAlunoInList(page, 'Aluno Menor E2E');
    });
  });

  test('menor de idade: vincula responsável existente sem criar novo cadastro', async ({ page }) => {
    const suffix = Date.now().toString().slice(-6);
    const adminEmail = `admin+${randomUUID()}@e2e.test`;

    const { contaId } = await seedAdminAndAuthenticate(page, { email: adminEmail });
    const responsavel = await seedResponsavelForConta(prisma, contaId, {
      nome: `Resp Existente ${suffix}`,
      email: `resp.existente+${suffix}@e2e.test`,
    });

    await test.step('Abrir wizard para menor', async () => {
      await mockKycRefresh(page);
      await mockViaCep(page, DEFAULT_CEP, DEFAULT_ADDRESS);
      await page.goto('/alunos');
      await expect(page.getByText('Gestão de Alunos')).toBeVisible();
      await dismissWelcomeWizard(page);
      await openAlunoWizard(page);

      await fillIdentificacao(page, {
        nome: 'Aluno Menor Resp Existente',
        dataNasc: '10/05/2015',
      });
      await clickWizardNext(page);
      await fillEnderecoAluno(page, { numero: '50' });
      await clickWizardNext(page);
      await clickWizardNext(page);
      await clickWizardNext(page);
      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Responsável' })).toBeVisible();
    });

    await test.step('Selecionar responsável já cadastrado', async () => {
      await selectResponsavelExistente(page, responsavel.nome, responsavel.nome);
      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();
    });

    await test.step('Concluir cadastro', async () => {
      await clickConcluir(page);
      const { status } = await waitForAlunoCreateResponse(page);
      expect(status).toBe(201);
      await expectAlunoInList(page, 'Aluno Menor Resp Existente');
    });
  });

  test('menor de idade: bloqueia avanço sem responsável', async ({ page }) => {
    await setupAlunoWizardTest(page);
    await openAlunoWizard(page);

    await fillIdentificacao(page, {
      nome: 'Aluno Sem Responsavel',
      dataNasc: '10/05/2015',
      email: 'semresp@e2e.test',
      telefone: '11999997777',
    });
    await clickWizardNext(page);
    await fillEnderecoAluno(page, { numero: '10' });
    await clickWizardNext(page);
    await clickWizardNext(page);
    await clickWizardNext(page);
    await clickWizardNext(page);

    await expect(page.getByRole('heading', { name: 'Responsável' })).toBeVisible();

    await clickWizardNext(page);

    await expect(page.getByRole('heading', { name: 'Responsável' })).toBeVisible();
    const hasFrontendError = await page
      .getByText(/responsável|obrigatório|Selecione um responsável/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (!hasFrontendError) {
      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();
      await clickConcluir(page);
      const { status } = await waitForAlunoCreateResponse(page);
      expect(status).toBe(400);
      return;
    }

    expect(hasFrontendError).toBe(true);
  });

  test('menor de idade: bloqueia responsável novo sem CPF', async ({ page }) => {
    const suffix = Date.now().toString().slice(-6);

    await setupAlunoWizardTest(page);
    await openAlunoWizard(page);

    await fillIdentificacao(page, {
      nome: 'Aluno Resp Sem CPF',
      dataNasc: '10/05/2015',
      email: `respsemcpf+${suffix}@e2e.test`,
      telefone: '11999996666',
    });
    await clickWizardNext(page);
    await fillEnderecoAluno(page, { numero: '20' });
    await clickWizardNext(page);
    await clickWizardNext(page);
    await clickWizardNext(page);
    await clickWizardNext(page);

    await expect(page.getByRole('heading', { name: 'Responsável' })).toBeVisible();
    await page.getByRole('tab', { name: 'Criar responsável' }).click();
    await page.locator('#resp-nome').fill('Responsável Sem CPF');
    await page.locator('#resp-email').fill('resp.semcpf@e2e.test');
    await fillTelefone(page.getByTestId('resp-telefone'), '11955553333');

    await clickWizardNext(page);

    await expect(page.getByRole('heading', { name: 'Responsável' })).toBeVisible();
    const cpfErrorVisible = await page
      .getByText(/CPF do responsável obrigatório|CPF inválido/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (!cpfErrorVisible) {
      await clickWizardNext(page);
      await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();
      await clickConcluir(page);
      const { status } = await waitForAlunoCreateResponse(page);
      expect(status).toBe(400);
      return;
    }

    expect(cpfErrorVisible).toBe(true);
  });

  test('dinâmica de etapas: data de nascimento altera total de passos', async ({ page }) => {
    await setupAlunoWizardTest(page);
    await openAlunoWizard(page);
    await expectWizardProgress(page, 1, 6);

    await page.locator('#aluno-data-nasc').fill('10/05/2015');
    await expectWizardProgress(page, 1, 7);

    await page.locator('#aluno-data-nasc').fill('');
    await page.locator('#aluno-data-nasc').fill('01/01/2000');
    await expectWizardProgress(page, 1, 6);
  });
});
