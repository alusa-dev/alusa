import { expect, test } from '@playwright/test';
import {
  advanceThroughOptionalSteps,
  clickConcluir,
  clickWizardNext,
  expectAlunoInList,
  fillEnderecoAluno,
  fillIdentificacao,
  openAlunoWizard,
  setupAlunoWizardTest,
  VALID_CPF,
  waitForAlunoCreateResponse,
} from './helpers/aluno-wizard';

test('cadastro de alunos pelo fluxo canônico', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  await setupAlunoWizardTest(page);
  await openAlunoWizard(page);

  await fillIdentificacao(page, {
    nome: 'Aluno E2E',
    dataNasc: '01/01/2000',
    cpf: VALID_CPF,
    email: `alunoe2e+${suffix}@e2e.test`,
    telefone: '11999998888',
  });
  await clickWizardNext(page);
  await expect(page.getByRole('heading', { name: 'Endereço' })).toBeVisible();
  await fillEnderecoAluno(page, { numero: '10' });
  await advanceThroughOptionalSteps(page);
  await expect(page.getByRole('heading', { name: 'Confirmar dados' })).toBeVisible();

  await clickConcluir(page);
  const { status } = await waitForAlunoCreateResponse(page);
  expect(status).toBe(201);
  await expectAlunoInList(page, 'Aluno E2E');
});
